// The agents app's server runner (src/builtin/agents; `gondol-api --builtin agents --functions <dir>`
// writes it into the host): does AI agents' due work while nobody has the app
// open. pg_cron calls queue_due_agent_runs() every minute, which queues scheduled work and POSTs
// { action: "tick" } here with the `x-agent-runner-secret` header from agent_runner_config (set its
// URL once with SELECT public.set_agent_runner_url('https://<host>/functions/v1/ai-agents')).
//
// A tick answers at once (202) and does the work in the background (EdgeRuntime.waitUntil), so pg_net
// hanging up after its few seconds doesn't stop it. All of a tick's work has to fit in the worker's
// wall clock (the self-hosted main router's workerTimeoutMs, 60 s by default): AGENT_WORKER_WALL_MS
// (default 50 s) is how long it may take, runs are only claimed while there's time left for one, and
// a model that doesn't answer in time fails the run with a message saying so. Runs the worker is cut
// off in are marked failed on its way down, and queue_due_agent_runs() fails any that still sit in
// "running" (fail_stale_agent_runs()).
//
// Each tick claims due runs (claim_agent_runs('server'): the agents on `openai` or `ollama`; Deep
// Agents wait for a browser) and, for each, acts as the agent's owner with a five-minute JWT signed
// with the stack's secret: it reads the conversation, the channel thread or the task, asks the model
// (non-streaming, the service's or the owner's settings' address and key), lets it call the app
// router's MCP tools the agent's `tool_access` allows (as the owner, so RLS applies), and posts the
// answer as the agent: in its direct thread, in the channel, or in the owner's direct thread with it.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET (or SUPABASE_JWT_SECRET). Optional:
// AGENT_WORKER_WALL_MS (raise it with the router's workerTimeoutMs for slow models),
// APP_ROUTER_URL (default <SUPABASE_URL>/functions/v1/app-router), ENTITY_URI_SCHEME (the app's entity
// URI scheme, default `gondol`: tool calls name the agent in `x-gondol-actor` as
// `<scheme>:agent:<id>`), OLLAMA_BASE_URL and the same
// OLLAMA_ALLOWED_HOSTS / OLLAMA_ALLOW_PRIVATE / OPENAI_ALLOWED_HOSTS / OPENAI_ALLOW_PRIVATE as the
// ai-ollama and ai-openai functions. Deploy with `verify_jwt = false`.
//
// Alter egos and channels are the host's (its `egos`, `channels` and `channel_messages` tables and
// `channel_thread()`); they're only read for runs that name them (a thread with an ego, a channel run).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { SignJWT } from "npm:jose@5";
import { agentMayUseTool, agentPromptMessages, agentSystemPrompt, agentThreadContext, type PromptLine, type PromptMessage, type PromptSituation } from "../_shared/agentPrompt.ts";

const env = (name: string) => Deno.env.get(name)?.trim() || undefined;
const SUPABASE_URL = env("SUPABASE_URL")!;
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const JWT_SECRET = env("JWT_SECRET") ?? env("SUPABASE_JWT_SECRET") ?? "";
// The app's entity URI scheme (gondol's configureEntityUris()), for naming the agent as the actor.
const URI_SCHEME = env("ENTITY_URI_SCHEME") ?? "gondol";
const APP_ROUTER_URL = (env("APP_ROUTER_URL") ?? `${SUPABASE_URL}/functions/v1/app-router`).replace(/\/+$/, "");
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_RESULT = 20_000;
const CONTEXT_MESSAGES = 30;
/** How long a tick may work in all: keep it under the worker's wall clock limit (workerTimeoutMs). */
const WORKER_WALL_MS = Math.max(15_000, Number(env("AGENT_WORKER_WALL_MS")) || 50_000);
/** A run isn't started with less time than this left. */
const MIN_RUN_MS = 15_000;

const admin = SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface Agent {
  id: string;
  user_id: string;
  name: string;
  username: string;
  gender: string | null;
  title: string | null;
  bio: string | null;
  instructions: string | null;
  provider: string;
  service_id: string | null;
  model: string | null;
  temperature: number | null;
  tool_access: string;
  time_zone: string;
  status: string;
}

interface Run {
  id: string;
  user_id: string;
  agent_id: string;
  schedule_id: string | null;
  instructions: string | null;
  conversation_id: string | null;
  channel_id: string | null;
  channel_parent_id: string | null;
  speaker_agent_id: string | null;
  message_parent_id: string | null;
  replace_message_id: string | null;
}

interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

type ChatMessage =
  | PromptMessage
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; toolName: string };

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ── Addresses the server may call ───────────────────────────────────────────────────────────

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function isPrivateIPv6(address: string): boolean {
  const v = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return /^(?:fc|fd|fe[89ab]|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
}

/** Throws unless the server may call `url` for this provider (the ai-ollama / ai-openai rules). */
async function assertAllowed(url: URL, provider: "openai" | "ollama"): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The AI address must be an HTTP(S) URL");
  if (url.username || url.password) throw new Error("The AI address can't hold a user name or password");
  const prefix = provider === "openai" ? "OPENAI" : "OLLAMA";
  if (env(`${prefix}_ALLOW_PRIVATE`) === "true") return;
  const allowed = (env(`${prefix}_ALLOWED_HOSTS`) ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.includes(url.host.toLowerCase()) || allowed.includes(url.hostname.toLowerCase())) return;
  if (provider === "ollama") {
    const fallback = env("OLLAMA_BASE_URL");
    if (fallback && new URL(fallback).host === url.host) return;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const refuse = () => {
    throw new Error(`The server doesn't call internal addresses such as ${url.host}; ask its operator to list it in ${prefix}_ALLOWED_HOSTS`);
  };
  if (provider === "openai" && url.protocol !== "https:") refuse();
  if (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp)$/.test(host)) refuse();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIPv4(host) ? refuse() : undefined;
  if (host.startsWith("[") || host.includes(":")) return isPrivateIPv6(host) ? refuse() : undefined;
  const [v4, v6] = await Promise.all([Deno.resolveDns(host, "A").catch(() => [] as string[]), Deno.resolveDns(host, "AAAA").catch(() => [] as string[])]);
  if (v4.length + v6.length === 0) throw new Error(`${host} doesn't resolve`);
  if (v4.some(isPrivateIPv4) || v6.some(isPrivateIPv6)) refuse();
}

// ── Acting as the owner ─────────────────────────────────────────────────────────────────────

async function tokenFor(userId: string): Promise<string> {
  if (!JWT_SECRET) throw new Error("The agent runner isn't configured (JWT_SECRET)");
  return await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function userClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

let rpcId = 1;
// `actor` (x-gondol-actor, which the router passes on to the database) logs the agent's writes as its own.
async function mcp<T>(token: string, method: string, params: Record<string, unknown>, deadline: number, actor?: string): Promise<T> {
  const response = await fetch(`${APP_ROUTER_URL}/mcp`, {
    method: "POST",
    signal: AbortSignal.timeout(timeLeft(deadline)),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", ...(actor ? { "x-gondol-actor": actor } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  const answer = (await response.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
  if (!response.ok || !answer || answer.error) throw new Error(answer?.error?.message ?? `The app router answered ${response.status}`);
  return answer.result as T;
}

async function agentTools(token: string, agent: Agent, deadline: number): Promise<{ tools: McpTool[]; instructions: string }> {
  if (agent.tool_access === "none") return { tools: [], instructions: "" };
  try {
    const [init, list] = await Promise.all([
      mcp<{ instructions?: string }>(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gondol-agents", version: "1.0.0" } }, deadline),
      mcp<{ tools: McpTool[] }>(token, "tools/list", {}, deadline),
    ]);
    return { tools: (list?.tools ?? []).filter((tool) => agentMayUseTool(agent.tool_access, tool)), instructions: init?.instructions ?? "" };
  } catch (error) {
    console.warn("ai-agents: no tools:", error instanceof Error ? error.message : error);
    return { tools: [], instructions: "" };
  }
}

async function callTool(token: string, call: ToolCall, actor: string, deadline: number): Promise<{ text: string; ok: boolean }> {
  try {
    const result = await mcp<{ content?: { type: string; text?: string }[]; isError?: boolean }>(token, "tools/call", { name: call.name, arguments: call.arguments }, deadline, actor);
    const text = (result?.content ?? []).map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : JSON.stringify(part))).join("\n");
    return { text, ok: !result?.isError };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), ok: false };
  }
}

// ── The model ───────────────────────────────────────────────────────────────────────────────

/** Where to ask and with which key: the agent's service, else the owner's settings for the provider. */
async function endpointFor(agent: Agent): Promise<{ provider: "openai" | "ollama"; baseUrl: URL; apiKey: string | null }> {
  const provider = agent.provider === "ollama" ? "ollama" : "openai";
  let base: string | null = null;
  let apiKey: string | null = null;
  if (agent.service_id) {
    const { data: service } = await admin!.from("ai_services").select("provider, base_url, enabled").eq("id", agent.service_id).eq("user_id", agent.user_id).maybeSingle();
    if (!service) throw new Error("The agent's AI service is gone");
    if (service.enabled === false) throw new Error("The agent's AI service is turned off");
    const { data: key } = await admin!.from("ai_service_keys").select("api_key").eq("service_id", agent.service_id).eq("user_id", agent.user_id).maybeSingle();
    base = (service.base_url as string | null)?.trim() || null;
    apiKey = (key?.api_key as string | undefined)?.trim() || null;
  } else {
    const { data: row } = await admin!.from("app_settings").select("data").eq("app_id", "ai").eq("scope", "user").eq("scope_id", agent.user_id).maybeSingle();
    const settings = (row?.data ?? {}) as Record<string, unknown>;
    const setting = (key: string) => (typeof settings[key] === "string" && (settings[key] as string).trim() ? (settings[key] as string).trim() : null);
    base = setting(`${provider}.baseUrl`);
    apiKey = setting(`${provider}.apiKey`);
  }
  base = base ?? (provider === "openai" ? OPENAI_BASE_URL : (env("OLLAMA_BASE_URL") ?? null));
  if (!base) throw new Error("No Ollama address: set one in the AI settings, or OLLAMA_BASE_URL on the server");
  const baseUrl = new URL(base);
  await assertAllowed(baseUrl, provider);
  return { provider, baseUrl, apiKey };
}

/** Milliseconds until `deadline`, at least one. */
function timeLeft(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

function timedOut(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function post(url: string, apiKey: string | null, body: unknown, deadline: number): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeLeft(deadline)),
      redirect: "error",
    });
  } catch (error) {
    if (timedOut(error)) {
      throw new Error(
        `The model didn't answer within the server runner's ${Math.round(WORKER_WALL_MS / 1000)} s. Use a faster model, or raise AGENT_WORKER_WALL_MS together with the functions' workerTimeoutMs.`,
      );
    }
    throw error;
  }
  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !answer) {
    const error = answer?.error;
    const message = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : null;
    throw new Error(message ?? `The AI API answered ${response.status}`);
  }
  return answer;
}

async function chat(
  endpoint: { provider: "openai" | "ollama"; baseUrl: URL; apiKey: string | null },
  model: string,
  messages: ChatMessage[],
  tools: McpTool[],
  temperature: number | null,
  deadline: number,
): Promise<{ content: string; toolCalls: ToolCall[]; metrics: Record<string, number> }> {
  const functions = tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description ?? "", parameters: tool.inputSchema ?? { type: "object", properties: {} } } }));
  const base = endpoint.baseUrl.toString().replace(/\/+$/, "");
  if (endpoint.provider === "openai") {
    const answer = await post(`${base}/chat/completions`, endpoint.apiKey, {
      model,
      messages: messages.map((m) =>
        m.role === "tool"
          ? { role: "tool", tool_call_id: m.toolCallId, content: m.content }
          : "toolCalls" in m
            ? { role: "assistant", content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
            : m,
      ),
      ...(functions.length ? { tools: functions } : {}),
      ...(temperature !== null ? { temperature } : {}),
    }, deadline);
    const choice = (answer.choices as { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] | undefined)?.[0]?.message;
    const usage = answer.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return {
      content: choice?.content ?? "",
      toolCalls: (choice?.tool_calls ?? []).map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || "{}");
        } catch {
          // The model sent arguments that aren't JSON; the tool will say what's missing.
        }
        return { id: c.id, name: c.function.name, arguments: args };
      }),
      metrics: { ...(usage?.prompt_tokens ? { promptTokens: usage.prompt_tokens } : {}), ...(usage?.completion_tokens ? { completionTokens: usage.completion_tokens } : {}) },
    };
  }
  const answer = await post(`${base}/api/chat`, endpoint.apiKey, {
    model,
    stream: false,
    messages: messages.map((m) =>
      m.role === "tool"
        ? { role: "tool", content: m.content, tool_name: m.toolName }
        : "toolCalls" in m
          ? { role: "assistant", content: m.content, tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) }
          : m,
    ),
    ...(functions.length ? { tools: functions } : {}),
    ...(temperature !== null ? { options: { temperature } } : {}),
  }, deadline);
  const message = answer.message as { content?: string; tool_calls?: { function: { name: string; arguments?: Record<string, unknown> } }[] } | undefined;
  return {
    content: message?.content ?? "",
    toolCalls: (message?.tool_calls ?? []).map((c, i) => ({ id: `call_${i}`, name: c.function.name, arguments: c.function.arguments ?? {} })),
    metrics: {
      ...(typeof answer.prompt_eval_count === "number" ? { promptTokens: answer.prompt_eval_count } : {}),
      ...(typeof answer.eval_count === "number" ? { completionTokens: answer.eval_count } : {}),
    },
  };
}

// ── A run ───────────────────────────────────────────────────────────────────────────────────

async function loadAgent(id: string): Promise<Agent | null> {
  const { data } = await admin!.from("agents").select("*").eq("id", id).maybeSingle();
  return (data as Agent | null) ?? null;
}

async function accountName(userId: string): Promise<string> {
  const { data } = await admin!.auth.admin.getUserById(userId);
  const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name].find((v) => typeof v === "string" && v.trim());
  return (name as string | undefined) ?? data.user?.email?.split("@")[0] ?? "the user";
}

async function context(run: Run, speaker: Agent, user: SupabaseClient): Promise<{ lines: PromptLine[]; situation: PromptSituation }> {
  if (run.conversation_id) {
    const { data: c } = await admin!.from("agent_conversations").select("*").eq("id", run.conversation_id).single();
    const { data: stored } = await admin!
      .from("agent_messages")
      .select("id, parent_id, soft_deleted_at, created_at, author_kind, author_agent_id, content")
      .eq("conversation_id", run.conversation_id)
      .order("created_at", { ascending: false })
      .limit(2000);
    // The way to the thread it answers in and the thread so far, up to an answer it writes again.
    const rows = agentThreadContext(
      (stored ?? []) as { id: string; parent_id: string | null; soft_deleted_at: string | null; created_at: string; author_kind: string; author_agent_id: string | null; content: string }[],
      run.message_parent_id,
      run.replace_message_id,
    );
    const otherId = c.with_kind === "agent" ? (c.agent_id === speaker.id ? c.with_agent_id : c.agent_id) : null;
    const other = otherId ? await loadAgent(otherId) : null;
    let withName: string;
    if (other) withName = other.name;
    else if (c.with_ego_id) {
      const { data: ego } = await admin!.from("egos").select("name, username").eq("id", c.with_ego_id).maybeSingle();
      withName = ego ? `${ego.name} (@${ego.username})` : "someone";
    } else withName = await accountName(run.user_id);
    const lines = rows.map((m) => ({
      own: m.author_kind === "agent" && m.author_agent_id === speaker.id,
      author: m.author_kind === "agent" ? (m.author_agent_id === other?.id ? other!.name : speaker.name) : withName,
      text: m.content,
    }));
    return { lines, situation: { kind: "direct", with: withName, withAgent: !!other, topic: c.topic, thread: !!run.message_parent_id } };
  }
  if (run.channel_id) {
    const { data: channel } = await admin!.from("channels").select("name").eq("id", run.channel_id).maybeSingle();
    let lines: PromptLine[] = [];
    if (run.channel_parent_id) {
      const { data } = await user.rpc("channel_thread", { p_message_id: run.channel_parent_id });
      const thread = ((data ?? []) as { depth: number; created_at: string; is_deleted: boolean; author_kind: string; author_name: string | null; author_username: string | null; body: string }[])
        .filter((m) => !m.is_deleted)
        .sort((a, b) => a.depth - b.depth || a.created_at.localeCompare(b.created_at));
      lines = thread.map((m) => ({ own: m.author_kind === "agent" && m.author_username === speaker.username, author: m.author_name ?? "Someone", text: m.body }));
    }
    return { lines, situation: { kind: "channel", channel: channel?.name ?? null, thread: !!run.channel_parent_id } };
  }
  let title: string | null = null;
  if (run.schedule_id) {
    const { data } = await admin!.from("agent_schedules").select("title").eq("id", run.schedule_id).maybeSingle();
    title = data?.title ?? null;
  }
  return { lines: [], situation: { kind: "task", title } };
}

async function finish(runId: string, values: { status: string; output?: string | null; error?: string | null; metrics?: Json }) {
  await admin!.from("agent_runs").update({ ...values, finished_at: new Date().toISOString() }).eq("id", runId);
}

async function execute(run: Run, deadline: number): Promise<void> {
  const speaker = await loadAgent(run.speaker_agent_id ?? run.agent_id);
  if (!speaker || speaker.status !== "active") {
    await finish(run.id, { status: "skipped", error: speaker ? `The agent is ${speaker.status}` : "The agent is gone" });
    return;
  }
  const used: { name: string; title?: string; ok: boolean }[] = [];
  let content = "";
  let failure: string | null = null;
  let metrics: Record<string, number> = {};
  const started = Date.now();
  try {
    const token = await tokenFor(run.user_id);
    const user = userClient(token);
    const endpoint = await endpointFor(speaker);
    const { data: settingsRow } = await admin!.from("app_settings").select("data").eq("app_id", "ai").eq("scope", "user").eq("scope_id", run.user_id).maybeSingle();
    const defaultModel = (settingsRow?.data as Record<string, unknown> | undefined)?.defaultModel;
    const model = speaker.model?.trim() || (typeof defaultModel === "string" ? defaultModel.trim() : "");
    if (!model) throw new Error("The agent has no model");
    const { lines, situation } = await context(run, speaker, user);
    const tools = await agentTools(token, speaker, deadline);
    let system = agentSystemPrompt(speaker, situation);
    if (tools.tools.length && tools.instructions.trim()) system += `\n\nYou can use these apps through their tools:\n${tools.instructions.trim()}`;
    const messages: ChatMessage[] = agentPromptMessages(system, lines, run.instructions, CONTEXT_MESSAGES);
    for (let round = 0; ; round++) {
      const result = await chat(endpoint, model, messages, round < MAX_TOOL_ROUNDS ? tools.tools : [], speaker.temperature, deadline);
      if (result.content) content = content ? `${content}\n\n${result.content}` : result.content;
      metrics = result.metrics;
      if (!result.toolCalls.length || round >= MAX_TOOL_ROUNDS) break;
      messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        const tool = tools.tools.find((t) => t.name === call.name);
        const answer = tool ? await callTool(await tokenFor(run.user_id), call, `${URI_SCHEME}:agent:${speaker.id}`, deadline) : { text: `There is no tool named ${call.name}, or the agent may not use it.`, ok: false };
        used.push({ name: call.name, ...(tool?.title ? { title: tool.title } : {}), ok: answer.ok });
        messages.push({ role: "tool", content: answer.text.length > MAX_TOOL_RESULT ? `${answer.text.slice(0, MAX_TOOL_RESULT)}…` : answer.text, toolCallId: call.id, toolName: call.name });
      }
    }
    content = content.trim();
    if (!content) throw new Error("The model gave no answer");
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const allMetrics = { ...metrics, durationMs: Date.now() - started, ...(used.length ? { tools: used } : {}) } as Json;

  try {
    if (run.channel_id && !run.conversation_id) {
      if (content) {
        const { error } = await admin!.from("channel_messages").insert({ channel_id: run.channel_id, parent_id: run.channel_parent_id, agent_id: speaker.id, user_id: run.user_id, body: content });
        if (error) throw new Error(error.message);
      }
    } else if (content || failure) {
      let conversationId = run.conversation_id;
      if (!conversationId) {
        const { data, error } = await userClient(await tokenFor(run.user_id)).rpc("open_agent_conversation", { p_agent_id: speaker.id, p_with_kind: "account" });
        if (error) throw new Error(error.message);
        conversationId = data as string;
      }
      let replaced = false;
      if (run.replace_message_id && content) {
        // Written again in its place; the earlier answer stays when the new one failed outright.
        const { data, error } = await admin!
          .from("agent_messages")
          .update({ content, error: failure, metrics: allMetrics, run_id: run.id, edited_at: new Date().toISOString() })
          .eq("id", run.replace_message_id)
          .eq("user_id", run.user_id)
          .select("id");
        if (error) throw new Error(error.message);
        replaced = !!data?.length;
      }
      const { error } = replaced || (run.replace_message_id && !content) ? { error: null } : await admin!.from("agent_messages").insert({
        user_id: run.user_id,
        conversation_id: conversationId,
        parent_id: run.message_parent_id,
        author_kind: "agent",
        author_agent_id: speaker.id,
        content,
        error: failure,
        metrics: allMetrics,
        run_id: run.id,
      });
      if (error) throw new Error(error.message);
    }
  } catch (error) {
    failure = failure ?? (error instanceof Error ? error.message : String(error));
  }
  await finish(run.id, { status: failure ? "failed" : "done", output: content || null, error: failure, metrics: allMetrics });
}

/** Runs this worker is working on, failed on its way down if it's cut off before they're done. */
const inFlight = new Set<string>();

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

addEventListener("beforeunload", (event) => {
  if (!inFlight.size || !admin) return;
  const reason = (event as Event & { detail?: { reason?: string } }).detail?.reason;
  const error = `The server stopped the run before the model was done${reason ? ` (${reason})` : ""}. Use a faster model, or raise AGENT_WORKER_WALL_MS together with the functions' workerTimeoutMs.`;
  void admin
    .from("agent_runs")
    .update({ status: "failed", error, finished_at: new Date().toISOString() })
    .in("id", [...inFlight])
    .eq("status", "running");
});

/** Claims and does due runs while there's time left for one in this worker. */
async function tick(): Promise<{ done: number; error?: string }> {
  const started = Date.now();
  // What's left for posting the answer and logging the run once the model is done.
  const deadline = started + WORKER_WALL_MS - 3_000;
  let done = 0;
  while (deadline - Date.now() > MIN_RUN_MS) {
    const { data: claimed, error } = await admin!.rpc("claim_agent_runs", { p_runner: "server", p_limit: 3 });
    if (error) return { done, error: error.message };
    const runs = (claimed ?? []) as Run[];
    if (!runs.length) break;
    await Promise.all(
      runs.map(async (run) => {
        inFlight.add(run.id);
        try {
          await execute(run, deadline);
        } catch (e) {
          await finish(run.id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        } finally {
          inFlight.delete(run.id);
        }
      }),
    );
    done += runs.length;
  }
  return { done };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!admin) return json({ error: "SUPABASE_SERVICE_ROLE_KEY isn't set for this function" }, 500);
  const { data: config } = await admin.from("agent_runner_config").select("secret").eq("id", true).maybeSingle();
  const secret = request.headers.get("x-agent-runner-secret") ?? "";
  if (!config?.secret || secret.length !== config.secret.length || secret !== config.secret) return json({ error: "Unauthorized" }, 401);

  const work = tick().then((result) => {
    if (result.error) console.error("ai-agents:", result.error);
    return result;
  });
  // pg_net only waits a few seconds for an answer: the work goes on after the answer.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
    return json({ accepted: true }, 202);
  }
  const result = await work;
  return json(result, result.error ? 500 : 200);
});
