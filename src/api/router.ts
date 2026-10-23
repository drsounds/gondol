// The app router: one HTTP handler (a Fetch API `Request` in, a `Response` out) that routes calls to
// the server functions apps declare in their manifests (`functions`), and serves what they offer AI
// models (`mcp`) as Model Context Protocol servers. Its registry, `apps.json`, is built from the
// manifests by the `gondol-api` script (functions.ts); this file only imports the gateway next to
// it, so the pair runs as is in a Supabase edge function (Deno), Node, Bun or a worker:
//
//   import { createAppRouter } from "../_shared/gondol-api/router.ts";
//   import registry from "../_shared/gondol-api/apps.json" with { type: "json" };
//   Deno.serve(createAppRouter({ registry, basePath: "/app-router", authenticate, rpc, callFunction }));
//
// Routes (after `basePath`):
//   GET  /apps                          the apps, their functions and tools, as the caller may use them
//   POST /apps/<app>/functions/<name>   JSON input → the function's Postgres function or edge function
//   POST /mcp                           every app's tools as one MCP server (tools named <app>__<tool>)
//   POST /apps/<app>/mcp                one app's tools (and its own MCP server's, proxied)
//   GET  /.well-known/oauth-protected-resource   where MCP clients get a token (RFC 9728)
//
// Callers send `Authorization: Bearer <token>`: the user's own session (first party, every scope) or
// an access token from the app API's OAuth (its scopes). `authenticate` tells which.
import { rpcArgName, validate, type InvokeResult, type JsonSchema } from "./gateway.ts";

/** What a function or tool runs: a Postgres function, or an edge function. */
export type RegistryTarget = { rpc: string } | { function: string };

export type RegistryFunction = {
  title?: string;
  description: string;
  target: RegistryTarget;
  /** An object schema for the input; refs are already inlined. */
  input: JsonSchema;
  output?: JsonSchema;
  /** OAuth scopes a token needs. Undefined: any signed-in caller; []: anyone. */
  scopes?: string[];
  readOnly?: boolean;
  destructive?: boolean;
};

export type RegistryTool = RegistryFunction & { name: string };

export type RegistryApp = {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  functions: Record<string, RegistryFunction>;
  tools: RegistryTool[];
  /** An MCP server of the app's own; header values name server secrets. */
  endpoint?: { url: string; headers?: Record<string, string> };
};

/** The router's `apps.json` (buildAppRegistry()). */
export type AppRegistry = { version: 1; apps: Record<string, RegistryApp> };

/** Who calls: a user, through their own session (`scopes` null: every scope) or an OAuth client. */
export type RouterCaller = {
  userId: string;
  /** The bearer token as sent, for passing on. */
  token: string;
  scopes: string[] | null;
  clientId?: string | null;
  appUri?: string | null;
};

/** A call to run: which app's function or tool, its checked input, the caller and the HTTP request. */
type CallRequest = { app: string; name: string; input: Record<string, unknown>; caller: RouterCaller | null; request: Request };

export type AppRouterOptions = {
  registry: AppRegistry;
  /** The part of the URL path before the routes, e.g. "/app-router". */
  basePath?: string;
  /** The router's public URL, for links it hands out; else the request's. */
  publicUrl?: string;
  /** Resolves a bearer token; null when it's unknown or expired. */
  authenticate: (token: string) => Promise<RouterCaller | null>;
  /** Runs a Postgres function as the caller (anon when null) with `p_<name>` arguments. */
  rpc: (request: CallRequest & { rpc: string; args: Record<string, unknown> }) => Promise<InvokeResult>;
  /** Calls an edge function with the input as its JSON body, as the caller. */
  callFunction: (request: CallRequest & { function: string }) => Promise<InvokeResult>;
  /** Reads a server secret, for the headers of apps' own MCP servers. */
  secret?: (name: string) => string | undefined;
  /** For apps' own MCP servers (default: the global fetch). */
  fetch?: typeof fetch;
  /** OAuth authorization servers MCP clients get tokens from (the app API's address). */
  authorizationServers?: string[];
  serverInfo?: { name: string; version: string };
  headers?: Record<string, string>;
  maxBodyBytes?: number;
  /** How long an app's own MCP server may take, in milliseconds (default 20 s). */
  remoteTimeoutMs?: number;
};

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** `<app>__<tool>`: how the aggregate MCP server names an app's tool. */
export function qualifiedToolName(app: string, tool: string): string {
  return `${app}__${tool}`;
}

/** The app and tool of a qualified name, or null. */
export function splitToolName(name: string): { app: string; tool: string } | null {
  const at = name.indexOf("__");
  return at > 0 ? { app: name.slice(0, at), tool: name.slice(at + 2) } : null;
}

/** Whether a caller may run something needing `scopes` (see RegistryFunction.scopes). */
export function mayCall(caller: RouterCaller | null, scopes: string[] | undefined): boolean {
  if (scopes && scopes.length === 0) return true;
  if (!caller) return false;
  if (caller.scopes === null || !scopes) return true;
  return scopes.every((scope) => caller.scopes!.includes(scope));
}

/** A Postgres function's arguments for an input: `startedAt` → `p_started_at`. */
export function rpcArgs(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [rpcArgName(key), value]));
}

const DEFAULT_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: unknown };
type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** An MCP tool as tools/list describes it. */
export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
};

/** An MCP tools/call result. */
export type McpToolResult = {
  content: { type: string; text?: string; [key: string]: unknown }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function toolResult(data: unknown): McpToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data ?? null, null, 2);
  const structured = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
  return { content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}) };
}

function toolError(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function createAppRouter(options: AppRouterOptions): (request: Request) => Promise<Response> {
  const headers = options.headers ?? DEFAULT_HEADERS;
  const basePath = (options.basePath ?? "").replace(/\/+$/, "");
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const apps = options.registry.apps;
  const serverInfo = options.serverInfo ?? { name: "gondol-apps", version: "1.0.0" };
  const doFetch = options.fetch ?? fetch;

  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", ...extra } });
  const problem = (status: number, title: string, detail?: string, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}) }), {
      status,
      headers: { ...headers, "Content-Type": "application/problem+json", ...extra },
    });

  function baseUrl(request: Request): string {
    const url = new URL(request.url);
    const at = basePath ? url.pathname.indexOf(basePath) : -1;
    const prefix = at === -1 ? "" : url.pathname.slice(0, at + basePath.length);
    return (options.publicUrl ?? `${url.origin}${prefix}`).replace(/\/+$/, "");
  }

  function challenge(request: Request, error?: string): Record<string, string> {
    const metadata = `${baseUrl(request)}/.well-known/oauth-protected-resource`;
    return { "WWW-Authenticate": `Bearer realm="apps", resource_metadata="${metadata}"${error ? `, error="${error}"` : ""}` };
  }

  /** The caller of a request: undefined without a token, null when the token is no good. */
  async function callerOf(request: Request): Promise<RouterCaller | null | undefined> {
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
    if (!bearer) return undefined;
    return await options.authenticate(bearer[1]);
  }

  async function readJson(request: Request): Promise<{ value: unknown } | { error: Response }> {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > maxBodyBytes) return { error: problem(413, "Content Too Large") };
    const text = await request.text();
    if (text.length > maxBodyBytes) return { error: problem(413, "Content Too Large") };
    if (!text.trim()) return { value: {} };
    try {
      return { value: JSON.parse(text) };
    } catch {
      return { error: problem(400, "Bad Request", "The body isn't valid JSON") };
    }
  }

  /** Runs a function or tool for a caller whose right to it is already checked. */
  async function run(app: string, name: string, fn: RegistryFunction, input: Record<string, unknown>, caller: RouterCaller | null, request: Request): Promise<InvokeResult> {
    const problems = validate(fn.input, input, undefined, "input");
    if (problems.length) return { error: { status: 422, message: problems.join("; ") } };
    if ("rpc" in fn.target) return await options.rpc({ app, name, input, caller, request, rpc: fn.target.rpc, args: rpcArgs(input) });
    return await options.callFunction({ app, name, input, caller, request, function: fn.target.function });
  }

  // ── Apps' own MCP servers (Streamable HTTP, as a client) ───────────────────────────────────

  async function remote(app: RegistryApp, method: string, params: unknown): Promise<unknown> {
    const endpoint = app.endpoint!;
    const base: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    for (const [header, secretName] of Object.entries(endpoint.headers ?? {})) {
      const value = options.secret?.(secretName);
      if (value) base[header] = value;
    }
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(options.remoteTimeoutMs ?? 20_000) : undefined;
    let session: string | null = null;
    let protocol: string | null = null;
    const post = async (message: Record<string, unknown>) => {
      const response = await doFetch(endpoint.url, {
        method: "POST",
        headers: { ...base, ...(session ? { "Mcp-Session-Id": session } : {}), ...(protocol ? { "MCP-Protocol-Version": protocol } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", ...message }),
        signal,
      });
      session = response.headers.get("mcp-session-id") ?? session;
      if (!("id" in message)) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw new Error(`${app.id}'s MCP server answered ${response.status}`);
      const text = await response.text();
      const type = response.headers.get("content-type") ?? "";
      const messages: JsonRpcResponse[] = [];
      if (type.includes("text/event-stream")) {
        for (const event of text.split(/\r?\n\r?\n/)) {
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) messages.push(JSON.parse(data) as JsonRpcResponse);
        }
      } else {
        const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
        messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      }
      const answer = messages.find((m) => m.id === message.id);
      if (!answer) throw new Error(`${app.id}'s MCP server sent no answer`);
      if (answer.error) throw new RpcError(answer.error.code, answer.error.message);
      return answer.result;
    };
    try {
      const init = (await post({
        id: 1,
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: serverInfo },
      })) as { protocolVersion?: string } | null;
      protocol = init?.protocolVersion ?? MCP_PROTOCOL_VERSIONS[0];
      await post({ method: "notifications/initialized" });
      return await post({ id: 2, method, params });
    } finally {
      if (session) {
        // Ends the session; servers without sessions may answer 405, which is fine.
        doFetch(endpoint.url, { method: "DELETE", headers: { ...base, "Mcp-Session-Id": session } }).then((r) => r.body?.cancel(), () => undefined);
      }
    }
  }

  // ── MCP server ────────────────────────────────────────────────────────────────────────────

  function describeTool(app: RegistryApp, tool: RegistryTool, qualified: boolean): McpTool {
    return {
      name: qualified ? qualifiedToolName(app.id, tool.name) : tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      description: qualified ? `${app.name}: ${tool.description}` : tool.description,
      inputSchema: tool.input.type === "object" ? tool.input : { type: "object", ...tool.input },
      annotations: {
        ...(tool.title ? { title: tool.title } : {}),
        readOnlyHint: !!tool.readOnly,
        destructiveHint: !!tool.destructive,
        openWorldHint: false,
      },
    };
  }

  async function listTools(scope: RegistryApp[], caller: RouterCaller, qualified: boolean): Promise<McpTool[]> {
    const lists = await Promise.all(
      scope.map(async (app) => {
        const own = app.tools.filter((tool) => mayCall(caller, tool.scopes)).map((tool) => describeTool(app, tool, qualified));
        if (!app.endpoint) return own;
        try {
          const result = (await remote(app, "tools/list", {})) as { tools?: McpTool[] } | null;
          const theirs = (result?.tools ?? [])
            .filter((tool) => tool && typeof tool.name === "string" && !app.tools.some((t) => t.name === tool.name))
            .map((tool) => ({ ...tool, name: qualified ? qualifiedToolName(app.id, tool.name) : tool.name, description: qualified ? `${app.name}: ${tool.description ?? ""}` : tool.description }));
          return [...own, ...theirs];
        } catch (error) {
          console.error(`app router: ${app.id}'s MCP server:`, error);
          return own;
        }
      }),
    );
    return lists.flat();
  }

  async function callTool(scope: RegistryApp[], caller: RouterCaller, qualified: boolean, params: Record<string, unknown>, request: Request): Promise<McpToolResult> {
    if (typeof params.name !== "string") throw new RpcError(-32602, "The tool's name is missing");
    const input = params.arguments ?? {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new RpcError(-32602, "The arguments must be an object");
    const parts = qualified ? splitToolName(params.name) : { app: scope[0]?.id ?? "", tool: params.name };
    const app = parts ? scope.find((a) => a.id === parts.app) : undefined;
    if (!app || !parts) throw new RpcError(-32602, `Unknown tool: ${params.name}`);
    const tool = app.tools.find((t) => t.name === parts.tool);
    if (!tool) {
      if (!app.endpoint) throw new RpcError(-32602, `Unknown tool: ${params.name}`);
      try {
        return (await remote(app, "tools/call", { name: parts.tool, arguments: input })) as McpToolResult;
      } catch (error) {
        if (error instanceof RpcError) throw error;
        return toolError(error instanceof Error ? error.message : String(error));
      }
    }
    if (!mayCall(caller, tool.scopes)) return toolError(`The token lacks the scope ${tool.scopes?.join(" ")}`);
    const result = await run(app.id, tool.name, tool, input as Record<string, unknown>, caller, request);
    return "error" in result ? toolError(result.error.message) : toolResult(result.data);
  }

  async function answer(message: JsonRpcRequest, scope: RegistryApp[], caller: RouterCaller, qualified: boolean, request: Request): Promise<JsonRpcResponse | null> {
    const id = message.id ?? null;
    const isRequest = message.id !== undefined;
    try {
      if (message.jsonrpc !== "2.0" || typeof message.method !== "string") throw new RpcError(-32600, "Not a JSON-RPC 2.0 request");
      const params = (message.params && typeof message.params === "object" ? message.params : {}) as Record<string, unknown>;
      if (!isRequest) return null; // notifications/initialized, notifications/cancelled, …
      let result: unknown;
      switch (message.method) {
        case "initialize": {
          const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
          const instructions = scope
            .map((app) => (app.instructions || app.description ? `${app.name}${qualified ? ` (tools ${app.id}__…)` : ""}: ${app.instructions ?? app.description}` : ""))
            .filter(Boolean)
            .join("\n");
          result = {
            protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: qualified ? serverInfo : { name: `${serverInfo.name}/${scope[0]?.id}`, version: serverInfo.version },
            ...(instructions ? { instructions } : {}),
          };
          break;
        }
        case "ping":
          result = {};
          break;
        case "tools/list":
          result = { tools: await listTools(scope, caller, qualified) };
          break;
        case "tools/call":
          result = await callTool(scope, caller, qualified, params, request);
          break;
        case "resources/list":
          result = { resources: [] };
          break;
        case "prompts/list":
          result = { prompts: [] };
          break;
        default:
          throw new RpcError(-32601, `Unknown method: ${message.method}`);
      }
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      if (!isRequest) return null;
      if (error instanceof RpcError) return { jsonrpc: "2.0", id, error: { code: error.code, message: error.message } };
      console.error("app router: mcp:", error);
      return { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } };
    }
  }

  async function handleMcp(request: Request, scope: RegistryApp[], qualified: boolean): Promise<Response> {
    if (request.method !== "POST") return problem(405, "Method Not Allowed", "This MCP server answers POST only (no event stream).", { Allow: "POST" });
    const caller = await callerOf(request);
    if (!caller) return problem(401, "Unauthorized", "Send an access token: Authorization: Bearer <token>", challenge(request, caller === null ? "invalid_token" : undefined));
    const body = await readJson(request);
    if ("error" in body) {
      if (body.error.status === 400) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
      return body.error;
    }
    const batch = Array.isArray(body.value);
    const messages = (batch ? body.value : [body.value]) as JsonRpcRequest[];
    const answers = (await Promise.all(messages.map((m) => answer(m && typeof m === "object" ? m : {}, scope, caller, qualified, request)))).filter(
      (a): a is JsonRpcResponse => a !== null,
    );
    if (!answers.length) return new Response(null, { status: 202, headers });
    return json(batch ? answers : answers[0]);
  }

  // ── Functions and the catalogue ────────────────────────────────────────────────────────────

  async function handleFunction(request: Request, appId: string, name: string): Promise<Response> {
    const app = apps[appId];
    const fn = app?.functions[name];
    if (!app || !fn) return problem(404, "Not Found", `No function ${appId}/${name}`);
    if (request.method !== "POST") return problem(405, "Method Not Allowed", undefined, { Allow: "POST" });
    const caller = await callerOf(request);
    if (caller === null) return problem(401, "Unauthorized", "The token is invalid or expired", challenge(request, "invalid_token"));
    if (!mayCall(caller ?? null, fn.scopes)) {
      if (!caller) return problem(401, "Unauthorized", "Send a token: Authorization: Bearer <token>", challenge(request));
      return problem(403, "Forbidden", `The token lacks the scope ${fn.scopes?.join(" ")}`, { "WWW-Authenticate": `Bearer realm="apps", error="insufficient_scope", scope="${fn.scopes?.join(" ")}"` });
    }
    const body = await readJson(request);
    if ("error" in body) return body.error;
    if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) return problem(422, "Unprocessable Content", "The input must be a JSON object");
    const result = await run(app.id, name, fn, body.value as Record<string, unknown>, caller ?? null, request);
    if ("error" in result) {
      return problem(result.error.status, result.error.status >= 500 ? "Internal Server Error" : "Request Failed", result.error.message);
    }
    return json(result.data ?? null);
  }

  async function handleCatalog(request: Request): Promise<Response> {
    const caller = await callerOf(request);
    if (!caller) return problem(401, "Unauthorized", "Send a token: Authorization: Bearer <token>", challenge(request, caller === null ? "invalid_token" : undefined));
    const base = baseUrl(request);
    const list = Object.values(apps).map((app) => ({
      id: app.id,
      name: app.name,
      ...(app.description ? { description: app.description } : {}),
      ...(app.instructions ? { instructions: app.instructions } : {}),
      functions: Object.entries(app.functions)
        .filter(([, fn]) => mayCall(caller, fn.scopes))
        .map(([name, fn]) => ({
          name,
          ...(fn.title ? { title: fn.title } : {}),
          description: fn.description,
          url: `${base}/apps/${app.id}/functions/${name}`,
          input: fn.input,
          ...(fn.output ? { output: fn.output } : {}),
          ...(fn.scopes ? { scopes: fn.scopes } : {}),
          readOnly: !!fn.readOnly,
          destructive: !!fn.destructive,
        })),
      tools: app.tools.filter((tool) => mayCall(caller, tool.scopes)).map((tool) => describeTool(app, tool, true)),
      mcp: `${base}/apps/${app.id}/mcp`,
      ownMcpServer: !!app.endpoint,
    }));
    return json({ mcp: `${base}/mcp`, apps: list });
  }

  return async (request: Request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    let path = url.pathname;
    const at = basePath ? path.indexOf(basePath) : -1;
    if (at !== -1) path = path.slice(at + basePath.length);
    path = `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
    try {
      if (path.startsWith("/.well-known/oauth-protected-resource") && request.method === "GET") {
        return json({
          resource: `${baseUrl(request)}/mcp`,
          ...(options.authorizationServers?.length ? { authorization_servers: options.authorizationServers } : {}),
          bearer_methods_supported: ["header"],
        });
      }
      if (path === "/apps" && request.method === "GET") return await handleCatalog(request);
      if (path === "/mcp") return await handleMcp(request, Object.values(apps), true);
      const appMcp = /^\/apps\/([^/]+)\/mcp$/.exec(path);
      if (appMcp) {
        const app = apps[decodeURIComponent(appMcp[1])];
        return app ? await handleMcp(request, [app], false) : problem(404, "Not Found", `No app ${appMcp[1]}`);
      }
      const fn = /^\/apps\/([^/]+)\/functions\/([^/]+)$/.exec(path);
      if (fn) return await handleFunction(request, decodeURIComponent(fn[1]), decodeURIComponent(fn[2]));
      return problem(404, "Not Found", `Nothing at ${path}`);
    } catch (error) {
      console.error("gondol app router:", error);
      return problem(500, "Internal Server Error");
    }
  };
}
