// The ai app's way to OpenAI-compatible APIs (gondol/builtin/ai): the browser asks this function,
// which calls the API server-side for the signed-in user.
//
// POST body: { action: "models", baseUrl } | { action: "models", serviceId }
//            { action: "chat", baseUrl | serviceId, model, messages, temperature?, tools? }
//
// With `baseUrl` the key is the user's `openai.apiKey` setting (app_settings). With `serviceId`
// (one of the user's ai_services, provider "openai") the address is the service's (empty: OpenAI's)
// and the key the service's, from ai_service_keys, which only the service role reads.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-spacify-workspace",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const deno = (globalThis as typeof globalThis & {
  Deno: {
    env: { get: (name: string) => string | undefined };
    resolveDns: (name: string, recordType: "A" | "AAAA") => Promise<string[]>;
    serve: (handler: (request: Request) => Promise<Response>) => void;
  };
}).Deno;

type ErrorKind = "config" | "forbidden" | "unreachable" | "http" | "invalid";

class FunctionError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly status: number,
  ) {
    super(message);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(error: FunctionError): Response {
  return jsonResponse({ error: error.message, kind: error.kind }, error.status);
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];
  if (!value) return true;
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (mapped.includes(".")) return isPrivateIpv4(mapped);
    const groups = mapped.split(":");
    if (groups.length === 2 && groups.every((group) => /^[\da-f]{1,4}$/.test(group))) {
      const high = Number.parseInt(groups[0], 16);
      const low = Number.parseInt(groups[1], 16);
      return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return true;
  }
  const groups = value.split(":");
  const firstGroup = Number.parseInt(groups[0] || "0", 16);
  const secondGroup = Number.parseInt(groups[1] || "0", 16);
  if (firstGroup === 0x2002) {
    if (!/^[\da-f]{1,4}$/.test(groups[1] ?? "") || !/^[\da-f]{1,4}$/.test(groups[2] ?? "")) return true;
    const high = Number.parseInt(groups[1], 16);
    const low = Number.parseInt(groups[2], 16);
    if (isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)) return true;
  }
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    /^fe[89a-f]/.test(value) ||
    value.startsWith("ff") ||
    firstGroup < 0x2000 ||
    firstGroup > 0x3fff ||
    firstGroup === 0x3fff ||
    (firstGroup === 0x2001 && secondGroup < 0x0200) ||
    value.startsWith("2001:db8:")
  );
}

function isPrivateAddress(address: string): boolean {
  return address.includes(":") ? isPrivateIpv6(address) : isPrivateIpv4(address);
}

function configuredHost(host: string, hostname: string): boolean {
  const allowed = (deno.env.get("OPENAI_ALLOWED_HOSTS") ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(host.toLowerCase()) || allowed.includes(hostname.toLowerCase());
}

async function validateBaseUrl(value: unknown): Promise<URL> {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) {
    throw new FunctionError("An API base URL is required", "config", 400);
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new FunctionError("The API base URL is not a valid URL", "config", 400);
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new FunctionError("The API base URL must be an HTTP(S) URL without credentials, a query, or a fragment", "config", 400);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const host = url.host.toLowerCase();
  const allowPrivate = deno.env.get("OPENAI_ALLOW_PRIVATE") === "true";
  const allowlisted = configuredHost(host, hostname);
  const localHostname = hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal");
  const ipLiteral = hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname);

  if (!allowPrivate && !allowlisted) {
    if (url.protocol !== "https:" || localHostname || ipLiteral) {
      throw new FunctionError("The API host is not allowed", "forbidden", 403);
    }

    const records = await Promise.allSettled([
      deno.resolveDns(hostname, "A"),
      deno.resolveDns(hostname, "AAAA"),
    ]);
    const addresses = records.flatMap((record) => (record.status === "fulfilled" ? record.value : []));
    if (!addresses.length) throw new FunctionError("Couldn't resolve the API host", "unreachable", 502);
    if (addresses.some(isPrivateAddress)) throw new FunctionError("The API host is not allowed", "forbidden", 403);
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

function validateToolCalls(value: unknown): { id: string; type: "function"; function: { name: string; arguments: string } }[] {
  if (!Array.isArray(value) || value.length > 64) throw new FunctionError("The tool calls are invalid", "invalid", 400);
  return value.map((call) => {
    const item = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } } | null;
    if (!item || typeof item.id !== "string" || typeof item.function?.name !== "string" || !TOOL_NAME.test(item.function.name) || typeof item.function.arguments !== "string") {
      throw new FunctionError("The tool calls are invalid", "invalid", 400);
    }
    return { id: item.id, type: "function" as const, function: { name: item.function.name, arguments: item.function.arguments } };
  });
}

function validateTools(value: unknown): { type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }[] {
  if (!Array.isArray(value) || value.length > 128) throw new FunctionError("The tools are invalid", "invalid", 400);
  return value.map((tool) => {
    const item = tool as { type?: unknown; function?: { name?: unknown; description?: unknown; parameters?: unknown } } | null;
    const fn = item?.function;
    if (
      !item ||
      item.type !== "function" ||
      typeof fn?.name !== "string" ||
      !TOOL_NAME.test(fn.name) ||
      (fn.description !== undefined && typeof fn.description !== "string") ||
      !fn.parameters ||
      typeof fn.parameters !== "object" ||
      Array.isArray(fn.parameters)
    ) {
      throw new FunctionError("The tools are invalid", "invalid", 400);
    }
    return {
      type: "function" as const,
      function: { name: fn.name, ...(typeof fn.description === "string" ? { description: fn.description } : {}), parameters: fn.parameters as Record<string, unknown> },
    };
  });
}

function validateChat(body: Record<string, unknown>): {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  tools?: ReturnType<typeof validateTools>;
} {
  if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200) {
    throw new FunctionError("A valid model is required", "invalid", 400);
  }
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 1000) {
    throw new FunctionError("Valid chat messages are required", "invalid", 400);
  }

  let totalLength = 0;
  const messages = body.messages.map((message): ChatMessage => {
    const item = message as Record<string, unknown> | null;
    if (!item || typeof item !== "object" || typeof item.role !== "string") throw new FunctionError("The chat messages are invalid", "invalid", 400);
    if (item.role === "assistant" && item.tool_calls !== undefined) {
      if (item.content !== null && typeof item.content !== "string") throw new FunctionError("The chat messages are invalid", "invalid", 400);
      const toolCalls = validateToolCalls(item.tool_calls);
      totalLength += (typeof item.content === "string" ? item.content.length : 0) + toolCalls.reduce((sum, call) => sum + call.function.arguments.length, 0);
      return { role: "assistant", content: (item.content as string | null) ?? null, tool_calls: toolCalls };
    }
    if (typeof item.content !== "string") throw new FunctionError("The chat messages are invalid", "invalid", 400);
    totalLength += item.content.length;
    if (item.role === "tool") {
      if (typeof item.tool_call_id !== "string" || !item.tool_call_id) throw new FunctionError("The chat messages are invalid", "invalid", 400);
      return { role: "tool", tool_call_id: item.tool_call_id, content: item.content };
    }
    if (!["system", "user", "assistant"].includes(item.role)) throw new FunctionError("The chat messages are invalid", "invalid", 400);
    return { role: item.role as "system" | "user" | "assistant", content: item.content };
  });
  if (totalLength > 1_000_000) throw new FunctionError("The chat messages are too large", "invalid", 413);
  if (body.temperature !== undefined && (typeof body.temperature !== "number" || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2)) {
    throw new FunctionError("Temperature must be between 0 and 2", "invalid", 400);
  }
  const tools = body.tools !== undefined ? validateTools(body.tools) : undefined;
  if (tools && JSON.stringify(tools).length > 500_000) throw new FunctionError("The tools are too large", "invalid", 413);
  return {
    model: body.model,
    messages,
    ...(body.temperature !== undefined ? { temperature: body.temperature as number } : {}),
    ...(tools?.length ? { tools } : {}),
  };
}

function upstreamErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return undefined;
  const error = payload.error;
  return typeof error === "string" ? error : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : undefined;
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One of the user's services (ai_services, read as the user so RLS applies), with its key, which
 * only the service role can read (ai_service_keys).
 */
async function readService(
  supabase: SupabaseClient,
  userId: string,
  serviceId: unknown,
): Promise<{ baseUrl: string; apiKey: string }> {
  if (typeof serviceId !== "string" || !UUID.test(serviceId)) throw new FunctionError("The AI service is invalid", "invalid", 400);
  const { data: service, error } = await supabase
    .from("ai_services")
    .select("id, provider, base_url, enabled")
    .eq("id", serviceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new FunctionError("Couldn't read the AI service", "config", 500);
  const row = service as { provider?: string; base_url?: string | null; enabled?: boolean } | null;
  if (!row) throw new FunctionError("There is no such AI service", "config", 404);
  if (row.provider !== "openai") throw new FunctionError("The AI service doesn't speak an OpenAI-compatible API", "config", 400);
  if (row.enabled === false) throw new FunctionError("The AI service is turned off", "config", 400);

  const serviceKey = deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = deno.env.get("SUPABASE_URL");
  if (!serviceKey || !supabaseUrl) throw new FunctionError("SUPABASE_SERVICE_ROLE_KEY isn't set for this function", "config", 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: key, error: keyError } = await admin
    .from("ai_service_keys")
    .select("api_key")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (keyError) throw new FunctionError("Couldn't read the AI service's key", "config", 500);
  const stored = (key as { api_key?: unknown } | null)?.api_key;
  const apiKey = typeof stored === "string" ? stored.trim() : "";
  return { baseUrl: typeof row.base_url === "string" ? row.base_url.trim() : "", apiKey };
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed", kind: "invalid" }, 405);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!authorization || !token) {
    return jsonResponse({ error: "Sign in before using the AI service", kind: "invalid" }, 401);
  }

  const supabaseUrl = deno.env.get("SUPABASE_URL");
  const supabaseKey = deno.env.get("SUPABASE_ANON_KEY") ?? deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabaseKey) throw new FunctionError("Supabase is not configured for this function", "config", 500);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return jsonResponse({ error: "Sign in before using the AI service", kind: "invalid" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new FunctionError("The request body must be valid JSON", "invalid", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FunctionError("The request body must be a JSON object", "invalid", 400);
  }
  const input = body as Record<string, unknown>;
  if (input.action !== "models" && input.action !== "chat") {
    throw new FunctionError("The requested action is invalid", "invalid", 400);
  }

  let apiKey = "";
  let requestedBaseUrl: unknown = input.baseUrl;
  if (input.serviceId !== undefined) {
    const service = await readService(supabase, authData.user.id, input.serviceId);
    apiKey = service.apiKey;
    requestedBaseUrl = service.baseUrl || OPENAI_BASE_URL;
  } else {
    const { data: settingsRow, error: settingsError } = await supabase
      .from("app_settings")
      .select("data")
      .eq("app_id", "ai")
      .eq("scope", "user")
      .eq("scope_id", authData.user.id)
      .maybeSingle();
    if (settingsError) throw new FunctionError("Couldn't read your AI settings", "config", 500);
    const settings = settingsRow?.data && typeof settingsRow.data === "object" && !Array.isArray(settingsRow.data)
      ? settingsRow.data as Record<string, unknown>
      : {};
    apiKey = typeof settings["openai.apiKey"] === "string" ? settings["openai.apiKey"].trim() : "";
  }
  const baseUrl = await validateBaseUrl(requestedBaseUrl);
  const endpoint = new URL(`${baseUrl.toString().replace(/\/+$/, "")}/${input.action === "models" ? "models" : "chat/completions"}`);

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: input.action === "models" ? "GET" : "POST",
      headers: {
        Accept: input.action === "chat" ? "text/event-stream" : "application/json",
        ...(input.action === "chat" ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
      },
      ...(input.action === "chat" ? { body: JSON.stringify({ ...validateChat(input), stream: true }) } : {}),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) throw new FunctionError("The request was stopped", "unreachable", 499);
    throw new FunctionError(`Couldn't reach the OpenAI-compatible API${error instanceof Error ? ` (${error.message})` : ""}`, "unreachable", 502);
  }

  if (!upstream.ok) {
    let message = `The AI API answered ${upstream.status}`;
    try {
      message = upstreamErrorMessage(await upstream.json()) ?? message;
    } catch {
      // The upstream error body was not JSON.
    }
    return jsonResponse({ error: message, kind: "http" }, upstream.status);
  }

  if (input.action === "models") {
    let result: unknown;
    try {
      result = await upstream.json();
    } catch {
      throw new FunctionError("The AI API sent an invalid models response", "invalid", 502);
    }
    if (!result || typeof result !== "object" || !Array.isArray((result as { data?: unknown }).data)) {
      throw new FunctionError("The AI API sent an invalid models response", "invalid", 502);
    }
    return jsonResponse(result);
  }

  if (!upstream.body) throw new FunctionError("The AI API sent no answer", "invalid", 502);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-cache",
      "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
    },
  });
}

deno.serve(async (request) => {
  try {
    return await handleRequest(request);
  } catch (error) {
    if (error instanceof FunctionError) return errorResponse(error);
    return errorResponse(new FunctionError("The AI service failed unexpectedly", "unreachable", 500));
  }
});
