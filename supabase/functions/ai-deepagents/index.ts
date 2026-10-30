// The ai app's LangChain Deep Agents (gondol/builtin/ai, provider "deepagents"): runs a Deep Agent
// (https://docs.langchain.com/oss/javascript/deepagents/overview) for the signed-in user on a chat
// model of an Ollama or an OpenAI-compatible API, and talks to the browser over a WebSocket, since an
// agent can work for minutes and asks the browser to run the apps' tools while it does.
//
// Connect with a WebSocket and send first (a browser can't set headers on one):
//   { type: "start", accessToken, body }
// body: { action: "models", backend: "ollama" | "openai", baseUrl? } | { action: "models", serviceId }
//       { action: "chat", backend, baseUrl? | serviceId, model, messages: [{ role, content }], tools?,
//         temperature?, numCtx?, maxSteps? }
// The function answers:
//   { type: "ready" }                        signed in, working on it
//   { type: "ping" }                         every few seconds, so no proxy closes the connection
//   { type: "token", text }                  a piece of the answer
//   { type: "status", status }               what the agent is doing (planning, notes, a sub-agent)
//   { type: "tool_call", id, name, arguments }  run one of `tools` and answer { type: "tool_result", id, content, ok }
//   { type: "done", models }                 (models) the models the backend serves
//   { type: "done", content, usage }         (chat) the whole answer and its token counts
//   (chat's body also takes `app` and `workspaceId`, whose AI credits it uses: _shared/aiCredits.ts;
//   out of credits is an error of kind "credits", status 402)
//   { type: "error", error, kind }           kind: config | forbidden | unreachable | http | invalid
// and closes. Send { type: "cancel" } (or close) to stop.
//
// The model's API: with `serviceId`, one of the user's ai_services (provider "deepagents") with its
// `options.backend`, address and key (from ai_service_keys, which only the service role reads); else
// `backend` and `baseUrl` as the client resolved them from the settings, with the user's own
// `ollama.apiKey`/`openai.apiKey` setting. An empty Ollama address is the OLLAMA_BASE_URL secret, an
// empty OpenAI one https://api.openai.com/v1. Only public hosts are called, unless the host is
// OLLAMA_BASE_URL's or listed in OLLAMA_ALLOWED_HOSTS / OPENAI_ALLOWED_HOSTS (or OLLAMA_ALLOW_PRIVATE /
// OPENAI_ALLOW_PRIVATE is true), as in ai-ollama and ai-openai.
//
// The gateway can't check the JWT (it comes in the first message): exempt this function from the
// JWT check (verify_jwt = false, or the self-hosted main router's list).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { assertCredits, chargeCredits, creditContext, estimateTokens } from "../_shared/aiCredits.ts";
import { createDeepAgent } from "npm:deepagents@1.15.1";
import { tool } from "npm:langchain@1.5.19";
import { ChatOllama } from "npm:@langchain/ollama@1.3.0";
import { ChatOpenAI } from "npm:@langchain/openai@1.7.0";

const deno = (globalThis as typeof globalThis & {
  Deno: {
    env: { get: (name: string) => string | undefined };
    resolveDns: (name: string, recordType: "A" | "AAAA") => Promise<string[]>;
    serve: (handler: (request: Request) => Response | Promise<Response>) => void;
    upgradeWebSocket: (request: Request, options?: { idleTimeout?: number }) => { socket: WebSocket; response: Response };
  };
}).Deno;

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-spacify-workspace",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const PING_MS = 10_000;
const START_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 20_000;
/** How long a tool the browser runs may take (the user may be asked first). */
const TOOL_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_STEPS = 100;
const MAX_STEPS = 1000;
const MAX_MESSAGES = 500;
const MAX_TOOLS = 128;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Backend = "ollama" | "openai";
type ErrorKind = "config" | "forbidden" | "unreachable" | "http" | "invalid";

class FunctionError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly status = 400,
  ) {
    super(message);
  }
}

// --- Which hosts may be called -------------------------------------------------------------------

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
    (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) || a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!value || value === "::" || value === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isPrivateIpv4(mapped[1]);
  if (value.startsWith("::ffff:")) return true;
  const first = Number.parseInt(value.split(":")[0] || "0", 16);
  return /^(?:fc|fd|fe[89a-f]|ff)/.test(value) || first < 0x2000 || first > 0x3ffe || value.startsWith("2001:db8:") || value.startsWith("64:ff9b:");
}

const isPrivateAddress = (address: string) => (address.includes(":") ? isPrivateIpv6(address) : isPrivateIpv4(address));

function ollamaDefault(): URL | null {
  const value = deno.env.get("OLLAMA_BASE_URL")?.trim();
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Hosts the operator trusts even when they're internal. */
function trusted(url: URL, backend: Backend): boolean {
  const prefix = backend === "ollama" ? "OLLAMA" : "OPENAI";
  if (deno.env.get(`${prefix}_ALLOW_PRIVATE`) === "true") return true;
  if (backend === "ollama" && ollamaDefault()?.host === url.host) return true;
  const allowed = (deno.env.get(`${prefix}_ALLOWED_HOSTS`) ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(url.host.toLowerCase()) || allowed.includes(url.hostname.toLowerCase());
}

/** The backend's address as a URL that may be called: http(s), no credentials, a public host (or a trusted one). */
async function allowedUrl(value: string, backend: Backend): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FunctionError("The model API's address isn't a URL", "config");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new FunctionError("The model API's address must be an HTTP(S) URL without credentials, a query or a fragment", "config");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (trusted(url, backend)) return url;
  const refuse = () => {
    throw new FunctionError(
      `The server doesn't call internal addresses such as ${url.host}; ask its operator to list it in ${backend === "ollama" ? "OLLAMA" : "OPENAI"}_ALLOWED_HOSTS`,
      "forbidden",
      403,
    );
  };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (backend === "openai" && url.protocol !== "https:") refuse();
  if (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp)$/.test(host)) refuse();
  if (/^\d+(?:\.\d+){3}$/.test(host) || host.startsWith("[")) {
    if (isPrivateAddress(host)) refuse();
    return url;
  }
  const records = await Promise.allSettled([deno.resolveDns(host, "A"), deno.resolveDns(host, "AAAA")]);
  const addresses = records.flatMap((record) => (record.status === "fulfilled" ? record.value : []));
  if (!addresses.length) throw new FunctionError(`${host} doesn't resolve`, "unreachable", 502);
  if (addresses.some(isPrivateAddress)) refuse();
  return url;
}

/** fetch that never follows a redirect (it could lead past allowedUrl()). */
const noRedirectFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "manual" });

// --- The model API -------------------------------------------------------------------------------

interface Target {
  backend: Backend;
  root: string;
  apiKey: string | null;
}

/** The user's own key setting for a backend (user scope only), read under their RLS. */
async function settingsKey(supabase: SupabaseClient, userId: string, backend: Backend): Promise<string | null> {
  const { data, error } = await supabase.from("app_settings").select("data").eq("app_id", "ai").eq("scope", "user").eq("scope_id", userId).maybeSingle();
  if (error) throw new FunctionError("Couldn't read your AI settings", "config", 500);
  const key = (data?.data as Record<string, unknown> | undefined)?.[`${backend}.apiKey`];
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

/** Where the agent's model is: the service's API (and key), else the body's backend and address. */
async function resolveTarget(supabase: SupabaseClient, userId: string, body: Record<string, unknown>): Promise<Target> {
  let backend: Backend;
  let address: string;
  let apiKey: string | null;
  if (body.serviceId !== undefined) {
    if (typeof body.serviceId !== "string" || !UUID.test(body.serviceId)) throw new FunctionError("The AI service is invalid", "invalid");
    const { data: service, error } = await supabase
      .from("ai_services")
      .select("provider, base_url, enabled, options")
      .eq("id", body.serviceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new FunctionError("Couldn't read the AI service", "config", 500);
    const row = service as { provider?: string; base_url?: string | null; enabled?: boolean; options?: { backend?: unknown } | null } | null;
    if (!row) throw new FunctionError("There is no such AI service", "config", 404);
    if (row.provider !== "deepagents") throw new FunctionError("The AI service isn't a Deep Agent", "config");
    if (row.enabled === false) throw new FunctionError("The AI service is turned off", "config");
    backend = row.options?.backend === "openai" ? "openai" : "ollama";
    address = typeof row.base_url === "string" ? row.base_url.trim() : "";
    const serviceKey = deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const url = deno.env.get("SUPABASE_URL");
    if (!serviceKey || !url) throw new FunctionError("SUPABASE_SERVICE_ROLE_KEY isn't set for this function", "config", 500);
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: key, error: keyError } = await admin.from("ai_service_keys").select("api_key").eq("service_id", body.serviceId).eq("user_id", userId).maybeSingle();
    if (keyError) throw new FunctionError("Couldn't read the AI service's key", "config", 500);
    const stored = (key as { api_key?: unknown } | null)?.api_key;
    apiKey = typeof stored === "string" && stored.trim() ? stored.trim() : null;
  } else {
    backend = body.backend === "openai" ? "openai" : "ollama";
    address = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    apiKey = await settingsKey(supabase, userId, backend);
  }
  if (address.length > 2048) throw new FunctionError("The model API's address is too long", "config");
  if (!address) {
    if (backend === "openai") address = OPENAI_BASE_URL;
    else address = ollamaDefault()?.href ?? "";
  }
  if (!address) throw new FunctionError("No Ollama address: set one in the AI settings, or OLLAMA_BASE_URL on the server", "config");
  const url = await allowedUrl(address, backend);
  return { backend, root: url.href.replace(/\/+$/, ""), apiKey };
}

async function upstreamError(response: Response): Promise<string> {
  let detail = response.statusText;
  try {
    const body = await response.json();
    const error = body?.error;
    detail = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : detail;
  } catch {
    // not JSON
  }
  return `The model API answered ${response.status}: ${detail}`;
}

/** The models the backend serves, as { name, size?, modified_at?, details? }. */
async function listModels(target: Target, signal: AbortSignal): Promise<unknown[]> {
  const url = target.backend === "ollama" ? `${target.root}/api/tags` : `${target.root}/models`;
  let response: Response;
  try {
    response = await noRedirectFetch(url, {
      headers: { Accept: "application/json", ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}) },
      signal: AbortSignal.any([signal, AbortSignal.timeout(CONNECT_TIMEOUT_MS)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new FunctionError(`Couldn't reach the model API at ${new URL(url).origin} (${error instanceof Error ? error.message : String(error)})`, "unreachable", 502);
  }
  if (!response.ok) throw new FunctionError(await upstreamError(response), "http", 502);
  const data = await response.json().catch(() => null);
  if (target.backend === "ollama") return Array.isArray(data?.models) ? data.models.slice(0, 1000) : [];
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((model: { id?: unknown }) => typeof model?.id === "string" && model.id)
    .slice(0, 1000)
    .map((model: { id: string; owned_by?: unknown }) => ({ name: model.id, ...(typeof model.owned_by === "string" ? { details: { owned_by: model.owned_by } } : {}) }));
}

function chatModel(target: Target, model: string, body: Record<string, unknown>) {
  const temperature = typeof body.temperature === "number" && body.temperature >= 0 && body.temperature <= 2 ? body.temperature : undefined;
  if (target.backend === "ollama") {
    const numCtx = typeof body.numCtx === "number" && Number.isInteger(body.numCtx) && body.numCtx >= 256 && body.numCtx <= 1_048_576 ? body.numCtx : undefined;
    return new ChatOllama({
      baseUrl: target.root,
      model,
      fetch: noRedirectFetch,
      ...(target.apiKey ? { headers: { Authorization: `Bearer ${target.apiKey}` } } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(numCtx !== undefined ? { numCtx } : {}),
    });
  }
  return new ChatOpenAI({
    model,
    // OpenAI's SDK insists on a key; compatible APIs without one ignore it.
    apiKey: target.apiKey ?? "none",
    configuration: { baseURL: target.root, fetch: noRedirectFetch },
    streamUsage: true,
    ...(temperature !== undefined ? { temperature } : {}),
  });
}

// --- The conversation ----------------------------------------------------------------------------

interface ClientTool {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

function cleanTools(value: unknown): ClientTool[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TOOLS) throw new FunctionError("The tools are malformed", "invalid");
  return value.map((item) => {
    const fn = (item as { type?: unknown; function?: { name?: unknown; description?: unknown; parameters?: unknown } })?.function;
    if ((item as { type?: unknown })?.type !== "function" || typeof fn?.name !== "string" || !TOOL_NAME.test(fn.name)) throw new FunctionError("The tools are malformed", "invalid");
    if (!fn.parameters || typeof fn.parameters !== "object" || Array.isArray(fn.parameters)) throw new FunctionError("The tools are malformed", "invalid");
    return { name: fn.name, ...(typeof fn.description === "string" ? { description: fn.description.slice(0, 4000) } : {}), parameters: fn.parameters as Record<string, unknown> };
  });
}

/** The instructions (every system message) and the rest of the conversation, as the agent takes them. */
function cleanMessages(value: unknown): { system: string; messages: { role: "user" | "assistant"; content: string }[] } {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) throw new FunctionError("No messages to send", "invalid");
  const system: string[] = [];
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  let size = 0;
  for (const item of value) {
    const role = (item as { role?: unknown })?.role;
    const content = String((item as { content?: unknown })?.content ?? "");
    size += content.length;
    if (role === "system") system.push(content);
    else if (role === "user" || role === "assistant") messages.push({ role, content });
    else if (role !== "tool") throw new FunctionError("A message has an unknown role", "invalid");
  }
  if (size > 1_000_000) throw new FunctionError("The messages are too large", "invalid");
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new FunctionError("The last message must be the user's", "invalid");
  return { system: system.join("\n\n"), messages };
}

/** The text of a message chunk's content (a string, or text blocks). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block && typeof block === "object" && (block as { type?: unknown }).type === "text" ? String((block as { text?: unknown }).text ?? "") : "")).join("");
}

/** What the chat shows while the agent uses one of its own tools. */
const STATUS: Record<string, string> = {
  write_todos: "Planning",
  task: "Working with a sub-agent",
  ls: "Looking through its notes",
  read_file: "Reading its notes",
  glob: "Looking through its notes",
  grep: "Searching its notes",
  write_file: "Taking notes",
  edit_file: "Taking notes",
  delete: "Tidying its notes",
};

interface Session {
  send: (message: Record<string, unknown>) => void;
  signal: AbortSignal;
  /** Tool calls the browser is running, by id. */
  pending: Map<string, (result: { content: string; ok: boolean }) => void>;
}

/** A tool that runs in the browser: asks for it over the socket and waits for the answer. */
function browserTool(session: Session, spec: ClientTool) {
  return tool(
    (args: unknown) =>
      new Promise<string>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          session.pending.delete(id);
          resolve("The tool didn't answer in time.");
        }, TOOL_TIMEOUT_MS);
        const stop = () => {
          clearTimeout(timer);
          session.pending.delete(id);
          reject(new Error("Stopped"));
        };
        session.signal.addEventListener("abort", stop, { once: true });
        session.pending.set(id, ({ content }) => {
          clearTimeout(timer);
          session.signal.removeEventListener("abort", stop);
          session.pending.delete(id);
          resolve(content);
        });
        session.send({ type: "tool_call", id, name: spec.name, arguments: args && typeof args === "object" ? args : {} });
      }),
    { name: spec.name, description: spec.description ?? spec.name, schema: spec.parameters },
  );
}

async function chat(session: Session, target: Target, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model || model.length > 200) throw new FunctionError("Pick a model", "invalid");
  const { system, messages } = cleanMessages(body.messages);
  const tools = cleanTools(body.tools).map((spec) => browserTool(session, spec));
  const steps = typeof body.maxSteps === "number" && Number.isInteger(body.maxSteps) ? Math.min(Math.max(body.maxSteps, 5), MAX_STEPS) : DEFAULT_STEPS;

  const agent = createDeepAgent({
    // Deno resolves deepagents' peers to a second copy of @langchain/core, whose types don't match
    // the chat models' (the classes work together at runtime).
    model: chatModel(target, model, body) as never,
    tools,
    ...(system ? { systemPrompt: system } : {}),
  });

  let content = "";
  let lastMessage: string | undefined;
  const usage = { input_tokens: 0, output_tokens: 0 };
  const stream = await agent.stream({ messages }, { streamMode: ["messages", "updates"], recursionLimit: steps, signal: session.signal });
  for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
    if (mode === "messages") {
      const [message, meta] = chunk as [{ id?: string; content?: unknown; _getType?: () => string; getType?: () => string }, { langgraph_node?: string }];
      const type = message.getType?.() ?? message._getType?.();
      if (type !== "ai" || meta?.langgraph_node !== "model_request") continue;
      const text = textOf(message.content);
      if (!text) continue;
      // Each model call's text follows the last's.
      const piece = content && message.id !== lastMessage ? `\n\n${text}` : text;
      lastMessage = message.id;
      content += piece;
      session.send({ type: "token", text: piece });
    } else if (mode === "updates") {
      for (const update of Object.values((chunk ?? {}) as Record<string, { messages?: unknown[] } | undefined>)) {
        for (const message of update?.messages ?? []) {
          const m = message as { tool_calls?: { name?: string }[]; usage_metadata?: { input_tokens?: number; output_tokens?: number } };
          usage.input_tokens += m.usage_metadata?.input_tokens ?? 0;
          usage.output_tokens += m.usage_metadata?.output_tokens ?? 0;
          for (const call of m.tool_calls ?? []) {
            const status = call.name ? STATUS[call.name] : undefined;
            if (status) session.send({ type: "status", status });
          }
        }
      }
    }
  }
  return { content, usage: { ...(usage.input_tokens ? { input_tokens: usage.input_tokens } : {}), ...(usage.output_tokens ? { output_tokens: usage.output_tokens } : {}) } };
}

// --- The socket ----------------------------------------------------------------------------------

/** What went wrong, as the error event says it. */
function failure(error: unknown): Record<string, unknown> {
  // CreditsError and CreditsConfigError carry their own kind and status.
  const own = error as { kind?: unknown; status?: unknown; message?: unknown } | null;
  if (own && !(error instanceof FunctionError) && (own.kind === "credits" || own.kind === "config") && typeof own.status === "number") {
    return { type: "error", error: String(own.message), kind: own.kind, status: own.status };
  }
  if (error instanceof FunctionError) return { type: "error", error: error.message, kind: error.kind, status: error.status };
  const message = error instanceof Error ? error.message : String(error);
  const unreachable = /ECONNREFUSED|fetch failed|connection|timed out|dns/i.test(message);
  return { type: "error", error: unreachable ? `Couldn't reach the model API (${message})` : message, kind: unreachable ? "unreachable" : "http" };
}

function serveSocket(request: Request): Response {
  const { socket, response } = deno.upgradeWebSocket(request, { idleTimeout: 0 });
  const abort = new AbortController();
  const session: Session = {
    send: (message) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    signal: abort.signal,
    pending: new Map(),
  };
  let started = false;
  let ping: ReturnType<typeof setInterval> | undefined;
  const close = (message?: Record<string, unknown>) => {
    clearInterval(ping);
    clearTimeout(startTimer);
    if (message) session.send(message);
    if (socket.readyState === WebSocket.OPEN) socket.close(1000);
  };
  const startTimer = setTimeout(() => {
    if (!started) close({ type: "error", error: "No request came", kind: "invalid" });
  }, START_TIMEOUT_MS);

  socket.onclose = () => {
    clearInterval(ping);
    abort.abort();
  };
  socket.onmessage = async (event) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      close({ type: "error", error: "Messages must be JSON", kind: "invalid" });
      return;
    }
    if (message.type === "cancel") {
      abort.abort();
      close();
      return;
    }
    if (message.type === "tool_result") {
      const answer = typeof message.id === "string" ? session.pending.get(message.id) : undefined;
      answer?.({ content: String(message.content ?? "").slice(0, 100_000), ok: message.ok !== false });
      return;
    }
    if (message.type !== "start" || started) return;
    started = true;
    clearTimeout(startTimer);
    try {
      const token = typeof message.accessToken === "string" ? message.accessToken : "";
      const body = message.body && typeof message.body === "object" && !Array.isArray(message.body) ? (message.body as Record<string, unknown>) : null;
      if (!token) throw new FunctionError("Sign in before using the AI service", "invalid", 401);
      if (!body) throw new FunctionError("The request must be a JSON object", "invalid");
      const url = deno.env.get("SUPABASE_URL");
      const key = deno.env.get("SUPABASE_ANON_KEY") ?? deno.env.get("SUPABASE_PUBLISHABLE_KEY");
      if (!url || !key) throw new FunctionError("Supabase is not configured for this function", "config", 500);
      const supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: auth, error: authError } = await supabase.auth.getUser(token);
      if (authError || !auth.user) throw new FunctionError("Sign in before using the AI service", "invalid", 401);
      session.send({ type: "ready" });
      ping = setInterval(() => session.send({ type: "ping" }), PING_MS);

      const target = await resolveTarget(supabase, auth.user.id, body);
      if (body.action === "models") close({ type: "done", models: await listModels(target, abort.signal) });
      else if (body.action === "chat") {
        // AI credits (_shared/aiCredits.ts): checked first, the run's tokens charged after.
        const credit = creditContext(request, body, { userId: auth.user.id, provider: "deepagents" });
        await assertCredits(supabase, credit);
        const result = await chat(session, target, body);
        const usage = result.usage as { input_tokens?: number; output_tokens?: number };
        await chargeCredits(credit, {
          inputTokens: usage.input_tokens ?? estimateTokens(JSON.stringify(body.messages ?? [])),
          outputTokens: usage.output_tokens ?? estimateTokens(String(result.content ?? "")),
        });
        close({ type: "done", ...result });
      }
      else throw new FunctionError("Unknown action", "invalid");
    } catch (error) {
      if (abort.signal.aborted) close();
      else close(failure(error));
    }
  };
  return response;
}

deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if ((request.headers.get("upgrade") ?? "").toLowerCase() === "websocket") return serveSocket(request);
  return new Response(JSON.stringify({ error: "Connect with a WebSocket", kind: "invalid" }), {
    status: 426,
    headers: { ...corsHeaders, "Content-Type": "application/json", Upgrade: "websocket" },
  });
});
