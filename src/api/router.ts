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
// For callers with their own session, `/mcp` also has gondol's own tools: `apps__…` (with
// `discovery`, the default) find the installed apps, their features, actions, entity types and
// functions, and run any app's function; `entities__…` (with `entities`) find, read, create, change
// and delete any entity through the host's entity API, Postgres functions that run as the caller so
// row level security decides (spacify's entity_api_*). Two request headers narrow both, and the
// apps' tools: `x-gondol-apps` (the app ids the caller has on, comma separated) and
// `x-gondol-entity-types` (the entity types a site shows).
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

/** A palette action of a feature: where it goes (`navigate`), or something the app does in the browser. */
export type RegistryAction = { id: string; title: string; description?: string; navigate?: string; shortcut?: string };

/** One of an app's features (its pages), as its manifest has it. */
export type RegistryFeature = {
  id: string;
  name: string;
  description?: string;
  /** Its in-app path, with a leading slash. */
  path: string;
  entityTypes?: string[];
  actions?: RegistryAction[];
};

/** An entity type an app owns: its public segment and the templates of its page and edit sheet. */
export type RegistryEntity = { slug: string | null; view?: string; edit?: string };

export type RegistryApp = {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  functions: Record<string, RegistryFunction>;
  tools: RegistryTool[];
  /** An MCP server of the app's own; header values name server secrets. */
  endpoint?: { url: string; headers?: Record<string, string> };
  /** What the app has in the browser, for discovery (`apps__describe_app`). */
  features?: RegistryFeature[];
  entities?: Record<string, RegistryEntity>;
};

/**
 * An MCP server a user added (the ai app's `ai_mcp_servers`), as `userMcpServers` hands it over:
 * its address and its headers' values, or why it can't be called (`error`, e.g. a private address).
 */
export type UserMcpServer = {
  id: string;
  name: string;
  url: string;
  description?: string | null;
  headers?: Record<string, string>;
  error?: string;
};

/** What the router serves for a request: an app, or a user's own server dressed as one. */
type ScopeApp = RegistryApp & { user?: { headers: Record<string, string>; error?: string } };

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
  /**
   * The caller's own MCP servers, whose tools join the apps' on `/mcp` (named
   * `mcp_<first 8 of its id>__<tool>`) and in the catalogue. Only asked for callers with their own
   * session (not OAuth clients). The router follows no redirects from them; checking that an
   * address may be called (public HTTPS, not the stack's own network) is up to this function.
   */
  userMcpServers?: (caller: RouterCaller) => Promise<UserMcpServer[]>;
  /**
   * gondol's `apps__…` tools on `/mcp` for callers with their own session: the installed apps,
   * their features, actions, entity types and functions, and running any of those functions
   * (default true).
   */
  discovery?: boolean;
  /**
   * gondol's `entities__…` tools on `/mcp` for callers with their own session: CRUD on any entity
   * through the host's entity API (Postgres functions run as the caller, so row level security
   * applies; see ENTITY_API_FUNCTIONS). Off by default: true, or the functions' names and extra
   * instructions.
   */
  entities?: boolean | EntityApiOptions;
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

/** The app id a user's MCP server's tools go under: `mcp_` and the first 8 hex digits of its id. */
export function userMcpAppId(serverId: string): string {
  return `mcp_${serverId.replace(/-/g, "").slice(0, 8).toLowerCase()}`;
}

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
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey, mcp-protocol-version, mcp-session-id, x-gondol-apps, x-gondol-entity-types",
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

// ── gondol's own tools: apps and entities ──────────────────────────────────────────────────────

/** The entity API's tools, by name (served as `entities__<name>`). */
export const ENTITY_API_TOOLS = ["list_types", "describe_type", "search", "list", "get", "create", "update", "delete", "restore"] as const;
export type EntityApiTool = (typeof ENTITY_API_TOOLS)[number];

/**
 * The Postgres functions that answer the entity tools, by default. Each runs as the caller (SECURITY
 * INVOKER, so row level security decides), gets the tool's arguments as `p_<name>` plus
 * `p_allowed_types` (text[], the `x-gondol-entity-types` header; NULL: every type) and answers JSON.
 * Entities are addressed by `uri` (`<scheme>:<type>:<id, identifier or slug>`) or `type` + `key`.
 */
export const ENTITY_API_FUNCTIONS: Record<EntityApiTool, string> = {
  list_types: "entity_api_types",
  describe_type: "entity_api_describe",
  search: "entity_api_search",
  list: "entity_api_list",
  get: "entity_api_get",
  create: "entity_api_create",
  update: "entity_api_update",
  delete: "entity_api_delete",
  restore: "entity_api_restore",
};

export type EntityApiOptions = {
  /** Other names for the Postgres functions (ENTITY_API_FUNCTIONS). */
  functions?: Partial<Record<EntityApiTool, string>>;
  /** More for the model about the host's entities (appended to the default instructions). */
  instructions?: string;
};

/** The ids of gondol's own tool groups on `/mcp`; no app may take them. */
export const CORE_APP_IDS = ["apps", "entities"] as const;

const ID_LIST = /^[A-Za-z0-9][\w.-]*$/;

/** A comma-separated header of ids (apps, entity types), or null when it's absent. */
export function headerList(request: Request, name: string): string[] | null {
  const value = request.headers.get(name);
  if (value === null) return null;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => ID_LIST.test(item));
}

const entityAddress: Record<string, JsonSchema> = {
  uri: { type: "string", maxLength: 300, description: "The entity's URI, e.g. spacify:task:<id>; or give type and key." },
  type: { type: "string", maxLength: 80, description: "The entity type (entities__list_types), with key." },
  key: { type: "string", maxLength: 200, description: "The entity's id, identifier or slug, with type." },
};

const CONDITION: JsonSchema = {
  type: "object",
  required: ["field"],
  additionalProperties: false,
  properties: {
    field: { type: "string", maxLength: 80 },
    op: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "empty", "not_empty"], description: "Default eq." },
    value: { description: "What to compare with; dates may be {{today}}, {{today+7}}, {{today-1}} or {{now}}." },
  },
};

type CoreToolSpec = Omit<RegistryTool, "target"> & { name: string };

type CoreGroup = (typeof CORE_APP_IDS)[number];
const CORE_GROUP_NAMES: Record<CoreGroup, string> = { apps: "Apps", entities: "Entities" };

/** What gondol's own tools see of a call: the caller, the apps they may use and the entity types (null: all). */
type CoreContext = { caller: RouterCaller; request: Request; scope: RegistryApp[]; types: string[] | null };
type CoreTool = { group: CoreGroup; spec: CoreToolSpec; run: (input: Record<string, unknown>, ctx: CoreContext) => Promise<InvokeResult> };

/** The entities__ tools (what they take; the host's Postgres functions answer them). */
const ENTITY_TOOL_SPECS: Record<EntityApiTool, CoreToolSpec> = {
  list_types: {
    name: "list_types",
    title: "List entity types",
    description: "Every type of entity there is (tasks, ideas, playlists, …): its table, the app it belongs to, the field that names it, whether deletes go to the trash and what the user may do with it (read, create, update, delete).",
    input: { type: "object", additionalProperties: false, properties: {} },
    readOnly: true,
  },
  describe_type: {
    name: "describe_type",
    title: "Describe an entity type",
    description: "An entity type's fields (type, required, writable, default, allowed values, what a reference points at), check constraints, the types that point at it, what the user may do and the row level security policies deciding it. Read it before creating or changing entities of a type.",
    input: { type: "object", additionalProperties: false, required: ["type"], properties: { type: entityAddress.type } },
    readOnly: true,
  },
  search: {
    name: "search",
    title: "Search entities",
    description: "Full-text search over everything the user can see, as the app's search does. Returns each hit's type, URI and label.",
    input: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", maxLength: 200 },
        types: { type: "array", maxItems: 50, items: { type: "string", maxLength: 80 }, description: "Only these entity types." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20." },
      },
    },
    readOnly: true,
  },
  list: {
    name: "list",
    title: "List entities",
    description: "The entities of one type the user can see, newest first by default, filtered by conditions on their fields and/or words in their label. Trashed ones are left out unless include_deleted.",
    input: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: entityAddress.type,
        conditions: { type: "array", maxItems: 20, items: CONDITION },
        match: { type: "string", enum: ["all", "any"], description: "Whether all conditions must hold (default) or any." },
        query: { type: "string", maxLength: 200, description: "Words in the label." },
        order_by: { type: "string", maxLength: 80, description: "A field (default updated_at, else created_at)." },
        descending: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20." },
        offset: { type: "integer", minimum: 0 },
        include_deleted: { type: "boolean" },
        fields: { type: "array", maxItems: 50, items: { type: "string", maxLength: 80 }, description: "Only these fields of each entity (default all)." },
      },
    },
    readOnly: true,
  },
  get: {
    name: "get",
    title: "Get an entity",
    description: "One entity with all its fields, what its references point at, what points at it and its tags.",
    input: { type: "object", additionalProperties: false, properties: { ...entityAddress, relations: { type: "boolean", description: "With references, what points at it and tags (default true)." } } },
    readOnly: true,
  },
  create: {
    name: "create",
    title: "Create an entity",
    description: "Create an entity of a type with field values (entities__describe_type lists the writable and required ones; references are ids, URI fields spacify: URIs). The user owns it. Returns it with its URI.",
    input: {
      type: "object",
      additionalProperties: false,
      required: ["type", "values"],
      properties: { type: entityAddress.type, values: { type: "object", description: "Field: value." } },
    },
  },
  update: {
    name: "update",
    title: "Change an entity",
    description: "Set some fields of an entity. Only the fields given change.",
    input: { type: "object", additionalProperties: false, required: ["values"], properties: { ...entityAddress, values: { type: "object", description: "Field: new value." } } },
  },
  delete: {
    name: "delete",
    title: "Delete an entity",
    description: "Move an entity to the trash (it can be restored), or delete it for good with permanent (also for types without a trash).",
    input: { type: "object", additionalProperties: false, properties: { ...entityAddress, permanent: { type: "boolean" } } },
    destructive: true,
  },
  restore: {
    name: "restore",
    title: "Restore an entity",
    description: "Take an entity out of the trash.",
    input: { type: "object", additionalProperties: false, properties: entityAddress },
  },
};

const ENTITY_INSTRUCTIONS =
  "Entities are every kind of thing the user keeps in the app (tasks, ideas, books, playlists, …), whichever app they belong to. With the entities__ tools you can find, read, create, change and delete any of them, as the user: you can do exactly what they may do. Start with entities__list_types, read entities__describe_type before writing a type, and name entities by their uri. Prefer an app's own tool when it has one for the job. Deletes go to the trash unless permanent.";

const APPS_INSTRUCTIONS =
  "The apps__ tools tell which apps the user has, what they do, their pages (features, with their paths), actions and entity types, and the server functions they declare; apps__call_function runs any of those functions, also ones that aren't tools. Link to a page with its path, e.g. [Ideas](/ideas).";

const APP_TOOL_SPECS: CoreToolSpec[] = [
  {
    name: "list_apps",
    title: "List apps",
    description: "The apps the user has: what each is for, its pages, entity types and the names of its functions.",
    input: { type: "object", additionalProperties: false, properties: {} },
    readOnly: true,
  },
  {
    name: "describe_app",
    title: "Describe an app",
    description: "One app in full: its pages (features) with their paths and actions, its entity types with their addresses, and its functions with what they take.",
    input: { type: "object", additionalProperties: false, required: ["app"], properties: { app: { type: "string", maxLength: 80, description: "The app's id (apps__list_apps)." } } },
    readOnly: true,
  },
  {
    name: "call_function",
    title: "Run an app's function",
    description: "Run one of an app's server functions (apps__describe_app lists them, with their input) as the user.",
    input: {
      type: "object",
      additionalProperties: false,
      required: ["app", "function"],
      properties: {
        app: { type: "string", maxLength: 80 },
        function: { type: "string", maxLength: 80 },
        input: { type: "object", description: "The function's input (default {})." },
      },
    },
  },
];

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

  // ── gondol's own tools ─────────────────────────────────────────────────────────────────────

  const entityOptions: EntityApiOptions | null = options.entities ? (options.entities === true ? {} : options.entities) : null;
  const entityFunctions: Record<EntityApiTool, string> = { ...ENTITY_API_FUNCTIONS, ...(entityOptions?.functions ?? {}) };

  /** The app an entity type belongs to: the one declaring it in `entities`, else in a feature's `entityTypes`. */
  const typeApps = new Map<string, string>();
  for (const app of Object.values(apps)) for (const type of Object.keys(app.entities ?? {})) if (!typeApps.has(type)) typeApps.set(type, app.id);
  for (const app of Object.values(apps)) {
    for (const feature of app.features ?? []) for (const type of feature.entityTypes ?? []) if (!typeApps.has(type)) typeApps.set(type, app.id);
  }

  /** The app's entity types: those it declares, and those its features list. */
  const appEntityTypes = (app: RegistryApp) => [...typeApps.entries()].filter(([, owner]) => owner === app.id).map(([type]) => type);

  const coreTools: CoreTool[] = [];
  if (options.discovery !== false) {
    const [listApps, describeApp, callFunction] = APP_TOOL_SPECS;
    coreTools.push(
      {
        group: "apps",
        spec: listApps,
        run: async (_input, ctx) => ({
          data: {
            apps: ctx.scope.map((app) => ({
              id: app.id,
              name: app.name,
              ...(app.description ? { description: app.description } : {}),
              features: (app.features ?? []).map((feature) => ({ name: feature.name, path: feature.path })),
              entity_types: appEntityTypes(app),
              functions: Object.entries(app.functions)
                .filter(([, fn]) => mayCall(ctx.caller, fn.scopes))
                .map(([name]) => name),
              tools: app.tools.filter((tool) => mayCall(ctx.caller, tool.scopes)).map((tool) => qualifiedToolName(app.id, tool.name)),
            })),
          },
        }),
      },
      {
        group: "apps",
        spec: describeApp,
        run: async (input, ctx) => {
          const app = ctx.scope.find((a) => a.id === input.app);
          if (!app) return { error: { status: 404, message: `No app "${String(input.app)}" (apps__list_apps lists them)` } };
          return {
            data: {
              id: app.id,
              name: app.name,
              ...(app.description ? { description: app.description } : {}),
              ...(app.instructions ? { instructions: app.instructions } : {}),
              features: app.features ?? [],
              entities: Object.fromEntries(Object.entries(app.entities ?? {}).filter(([type]) => !ctx.types || ctx.types.includes(type))),
              entity_types: appEntityTypes(app).filter((type) => !ctx.types || ctx.types.includes(type)),
              functions: Object.entries(app.functions)
                .filter(([, fn]) => mayCall(ctx.caller, fn.scopes))
                .map(([name, fn]) => ({
                  name,
                  ...(fn.title ? { title: fn.title } : {}),
                  description: fn.description,
                  input: fn.input,
                  readOnly: !!fn.readOnly,
                  destructive: !!fn.destructive,
                })),
              tools: app.tools.filter((tool) => mayCall(ctx.caller, tool.scopes)).map((tool) => qualifiedToolName(app.id, tool.name)),
            },
          };
        },
      },
      {
        group: "apps",
        spec: callFunction,
        run: async (input, ctx) => {
          const app = ctx.scope.find((a) => a.id === input.app);
          const fn = app?.functions[String(input.function)];
          if (!app || !fn) return { error: { status: 404, message: `No function ${String(input.app)}/${String(input.function)} (apps__describe_app lists an app's)` } };
          if (!mayCall(ctx.caller, fn.scopes)) return { error: { status: 403, message: `The token lacks the scope ${fn.scopes?.join(" ")}` } };
          const args = input.input ?? {};
          if (!args || typeof args !== "object" || Array.isArray(args)) return { error: { status: 422, message: "input must be an object" } };
          return await run(app.id, String(input.function), fn, args as Record<string, unknown>, ctx.caller, ctx.request);
        },
      },
    );
  }
  if (entityOptions) {
    for (const name of ENTITY_API_TOOLS) {
      coreTools.push({
        group: "entities",
        spec: ENTITY_TOOL_SPECS[name],
        run: async (input, ctx) => {
          const result = await options.rpc({
            app: "entities",
            name,
            input,
            caller: ctx.caller,
            request: ctx.request,
            rpc: entityFunctions[name],
            args: { ...rpcArgs(input), p_allowed_types: ctx.types },
          });
          // Which app each type belongs to, from the manifests.
          if (name === "list_types" && "data" in result && Array.isArray(result.data)) {
            const types = (result.data as Record<string, unknown>[]).map((row) => {
              const app = typeof row.type === "string" ? typeApps.get(row.type) : undefined;
              return app ? { ...row, app } : row;
            });
            return { data: { types } };
          }
          return result;
        },
      });
    }
  }

  const coreName = (tool: CoreTool) => qualifiedToolName(tool.group, tool.spec.name);

  function describeCoreTool(tool: CoreTool): McpTool {
    return describeTool({ id: tool.group, name: CORE_GROUP_NAMES[tool.group] }, { ...tool.spec, target: { rpc: "" } }, true);
  }

  /** gondol's own tools for a caller (only with their own session) and what narrows them. */
  function coreFor(caller: RouterCaller, request: Request, scope: RegistryApp[]): { tools: CoreTool[]; ctx: CoreContext } {
    return { tools: caller.scopes === null ? coreTools : [], ctx: { caller, request, scope, types: headerList(request, "x-gondol-entity-types") } };
  }

  function coreInstructions(tools: CoreTool[]): string[] {
    const lines: string[] = [];
    if (tools.some((tool) => tool.group === "apps")) lines.push(`${CORE_GROUP_NAMES.apps} (tools apps__…): ${APPS_INSTRUCTIONS}`);
    if (tools.some((tool) => tool.group === "entities")) {
      lines.push(`${CORE_GROUP_NAMES.entities} (tools entities__…): ${ENTITY_INSTRUCTIONS}${entityOptions?.instructions ? ` ${entityOptions.instructions}` : ""}`);
    }
    return lines;
  }

  /** The registry's apps a request may see: all, or those `x-gondol-apps` names. */
  function appsFor(request: Request): RegistryApp[] {
    const only = headerList(request, "x-gondol-apps");
    const all = Object.values(apps);
    return only ? all.filter((app) => only.includes(app.id)) : all;
  }

  // ── Apps' own MCP servers (Streamable HTTP, as a client) ───────────────────────────────────

  async function remote(app: ScopeApp, method: string, params: unknown): Promise<unknown> {
    const endpoint = app.endpoint!;
    if (app.user?.error) throw new Error(app.user.error);
    const base: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (app.user) Object.assign(base, app.user.headers);
    else {
      for (const [header, secretName] of Object.entries(endpoint.headers ?? {})) {
        const value = options.secret?.(secretName);
        if (value) base[header] = value;
      }
    }
    // A user's server may not bounce the router somewhere its address check didn't cover.
    const redirect: RequestRedirect = app.user ? "error" : "follow";
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(options.remoteTimeoutMs ?? 20_000) : undefined;
    let session: string | null = null;
    let protocol: string | null = null;
    const post = async (message: Record<string, unknown>) => {
      const response = await doFetch(endpoint.url, {
        method: "POST",
        headers: { ...base, ...(session ? { "Mcp-Session-Id": session } : {}), ...(protocol ? { "MCP-Protocol-Version": protocol } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", ...message }),
        signal,
        redirect,
      });
      session = response.headers.get("mcp-session-id") ?? session;
      if (!("id" in message)) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw new Error(`${app.user ? app.name : app.id}'s MCP server answered ${response.status}`);
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
        doFetch(endpoint.url, { method: "DELETE", headers: { ...base, "Mcp-Session-Id": session }, redirect }).then((r) => r.body?.cancel(), () => undefined);
      }
    }
  }

  /** The caller's own MCP servers, as apps (none for OAuth clients, or without `userMcpServers`). */
  async function userApps(caller: RouterCaller): Promise<ScopeApp[]> {
    if (!options.userMcpServers || caller.scopes !== null) return [];
    let servers: UserMcpServer[];
    try {
      servers = await options.userMcpServers(caller);
    } catch (error) {
      console.error("app router: the user's MCP servers:", error);
      return [];
    }
    const seen = new Set(Object.keys(apps));
    return servers.flatMap((server): ScopeApp[] => {
      const id = userMcpAppId(server.id);
      if (seen.has(id)) return [];
      seen.add(id);
      return [
        {
          id,
          name: server.name,
          ...(server.description ? { description: server.description } : {}),
          functions: {},
          tools: [],
          endpoint: { url: server.url },
          user: { headers: server.headers ?? {}, ...(server.error ? { error: server.error } : {}) },
        },
      ];
    });
  }

  // ── MCP server ────────────────────────────────────────────────────────────────────────────

  function describeTool(app: Pick<ScopeApp, "id" | "name">, tool: RegistryTool, qualified: boolean): McpTool {
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

  /** The tools an app's own MCP server lists (none it shadows), named for the scope. */
  async function remoteTools(app: ScopeApp, qualified: boolean): Promise<McpTool[]> {
    const result = (await remote(app, "tools/list", {})) as { tools?: McpTool[] } | null;
    return (result?.tools ?? [])
      .filter((tool) => tool && typeof tool.name === "string" && !app.tools.some((t) => t.name === tool.name))
      .map((tool) => ({ ...tool, name: qualified ? qualifiedToolName(app.id, tool.name) : tool.name, description: qualified ? `${app.name}: ${tool.description ?? ""}` : tool.description }));
  }

  async function listTools(scope: ScopeApp[], caller: RouterCaller, qualified: boolean, core: CoreTool[] = []): Promise<McpTool[]> {
    const lists = await Promise.all(
      scope.map(async (app) => {
        const own = app.tools.filter((tool) => mayCall(caller, tool.scopes)).map((tool) => describeTool(app, tool, qualified));
        if (!app.endpoint || app.user?.error) return own;
        try {
          return [...own, ...(await remoteTools(app, qualified))];
        } catch (error) {
          console.error(`app router: ${app.id}'s MCP server:`, error);
          return own;
        }
      }),
    );
    return [...core.map(describeCoreTool), ...lists.flat()];
  }

  async function callTool(
    scope: ScopeApp[],
    caller: RouterCaller,
    qualified: boolean,
    params: Record<string, unknown>,
    request: Request,
    core: { tools: CoreTool[]; ctx: CoreContext } | null = null,
  ): Promise<McpToolResult> {
    if (typeof params.name !== "string") throw new RpcError(-32602, "The tool's name is missing");
    const input = params.arguments ?? {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new RpcError(-32602, "The arguments must be an object");
    const own = core?.tools.find((tool) => coreName(tool) === params.name);
    if (own && core) {
      const problems = validate(own.spec.input, input, undefined, "arguments");
      if (problems.length) return toolError(problems.join("; "));
      const result = await own.run(input as Record<string, unknown>, core.ctx);
      return "error" in result ? toolError(result.error.message) : toolResult(result.data);
    }
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

  async function answer(
    message: JsonRpcRequest,
    scope: ScopeApp[],
    caller: RouterCaller,
    qualified: boolean,
    request: Request,
    core: { tools: CoreTool[]; ctx: CoreContext } | null,
  ): Promise<JsonRpcResponse | null> {
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
          const instructions = [
            ...coreInstructions(core?.tools ?? []),
            ...scope
              // Only apps with tools: the others are for apps__describe_app.
              .filter((app) => app.tools.length || app.endpoint)
              .map((app) => (app.instructions || app.description ? `${app.name}${qualified ? ` (tools ${app.id}__…)` : ""}: ${app.instructions ?? app.description}` : "")),
          ]
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
          result = { tools: await listTools(scope, caller, qualified, core?.tools) };
          break;
        case "tools/call":
          result = await callTool(scope, caller, qualified, params, request, core);
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

  async function handleMcp(request: Request, appScope: RegistryApp[], qualified: boolean): Promise<Response> {
    if (request.method !== "POST") return problem(405, "Method Not Allowed", "This MCP server answers POST only (no event stream).", { Allow: "POST" });
    const caller = await callerOf(request);
    if (!caller) return problem(401, "Unauthorized", "Send an access token: Authorization: Bearer <token>", challenge(request, caller === null ? "invalid_token" : undefined));
    // The aggregate server also has gondol's own tools and the caller's own MCP servers.
    const core = qualified ? coreFor(caller, request, appScope) : null;
    const scope: ScopeApp[] = qualified ? [...appScope, ...(await userApps(caller))] : appScope;
    const body = await readJson(request);
    if ("error" in body) {
      if (body.error.status === 400) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
      return body.error;
    }
    const batch = Array.isArray(body.value);
    const messages = (batch ? body.value : [body.value]) as JsonRpcRequest[];
    const answers = (await Promise.all(messages.map((m) => answer(m && typeof m === "object" ? m : {}, scope, caller, qualified, request, core)))).filter(
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
    const scope = appsFor(request);
    const list = scope.map((app) => ({
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
    const own = await Promise.all(
      (await userApps(caller)).map(async (app) => {
        let tools: McpTool[] = [];
        let error: string | undefined;
        try {
          tools = await remoteTools(app, true);
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
        return {
          id: app.id,
          name: app.name,
          ...(app.description ? { description: app.description } : {}),
          functions: [],
          tools,
          mcp: `${base}/mcp`,
          ownMcpServer: true,
          userServer: true,
          ...(error ? { error } : {}),
        };
      }),
    );
    // gondol's own tools, as apps of their own.
    const { tools: core } = coreFor(caller, request, scope);
    const builtin = CORE_APP_IDS.filter((id) => core.some((tool) => tool.group === id)).map((id) => ({
      id,
      name: CORE_GROUP_NAMES[id],
      description: id === "entities" ? ENTITY_INSTRUCTIONS : APPS_INSTRUCTIONS,
      functions: [],
      tools: core.filter((tool) => tool.group === id).map(describeCoreTool),
      mcp: `${base}/mcp`,
      ownMcpServer: false,
      builtin: true,
    }));
    return json({ mcp: `${base}/mcp`, apps: [...builtin, ...list, ...own] });
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
      if (path === "/mcp") return await handleMcp(request, appsFor(request), true);
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
