// The app API gateway: one HTTP handler (a Fetch API `Request` in, a `Response` out) that serves
// the OpenAPI document the apps' manifests describe (openapi.ts), the OAuth 2 endpoints apps sign
// users in with, and every operation of that document, each bound to a Postgres function.
//
// It imports nothing and uses only web-standard APIs, so the same file runs in a Supabase edge
// function (Deno), Node, Bun or a worker. The host copies it next to its function with the
// `gondol-api` script (cli.ts) and supplies what touches its database:
//
//   import { createApiGateway } from "../_shared/gondol-api/gateway.ts";
//   import document from "../_shared/gondol-api/openapi.json" with { type: "json" };
//   Deno.serve(createApiGateway({ document, basePath: "/app-api", authorizeUrl, authenticate, token, invoke }));
//
// Routes (after `basePath`):
//   GET  /openapi.json      the document, with this server's URLs filled in
//   GET  /oauth/authorize   redirects to `authorizeUrl` (the consent page) with the same query
//   POST /oauth/token       grant_type=authorization_code | refresh_token (RFC 6749, PKCE RFC 7636)
//   POST /oauth/revoke      token=… (RFC 7009)
//   *    <document paths>   bearer token → scopes → validated input → `invoke(x-gondol-rpc, p_<name>…)`

/** A JSON Schema, the subset validate() understands (plus anything else, ignored). */
export type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
};

export type ApiParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
};

/** An operation of the document: OpenAPI's, plus the function it runs and the scopes it needs. */
export type ApiOperation = {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ApiParameter[];
  requestBody?: { required?: boolean; description?: string; content: Record<string, { schema?: JsonSchema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema?: JsonSchema }> }>;
  security?: Record<string, string[]>[];
  /** The Postgres function that answers it, called as the signed-in user. */
  "x-gondol-rpc": string;
  /** The app whose manifest defines it. */
  "x-gondol-app"?: string;
  [key: string]: unknown;
};

export const API_METHODS = ["get", "put", "post", "patch", "delete"] as const;
export type ApiMethod = (typeof API_METHODS)[number];

export type ApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  paths: Record<string, Partial<Record<ApiMethod, ApiOperation>>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    securitySchemes?: Record<string, unknown>;
  };
  [key: string]: unknown;
};

/** Who is calling: the user a token was issued to, through which client, with which scopes. */
export type ApiCaller = {
  userId: string;
  clientId: string;
  scopes: string[];
  /** The URI of the app the client belongs to, if it names one. */
  appUri?: string | null;
};

/** A token request, as parsed from the form (client credentials from Basic auth or the body). */
export type TokenGrant =
  | { grantType: "authorization_code"; clientId: string; clientSecret: string | null; code: string; redirectUri: string | null; codeVerifier: string | null }
  | { grantType: "refresh_token"; clientId: string; clientSecret: string | null; refreshToken: string; scope: string | null };

/** RFC 6749's token response, or its error response. */
export type TokenResult =
  | { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token?: string; scope?: string }
  | { error: string; error_description?: string };

export type InvokeResult = { data: unknown } | { error: { status: number; message: string; code?: string } };

export type ApiGatewayOptions = {
  document: ApiDocument;
  /** The part of the URL path before the routes, e.g. "/app-api" (Supabase strips "/functions/v1"). */
  basePath?: string;
  /** The public URL of the gateway (what clients call), for the served document; else the request's. */
  publicUrl?: string;
  /** The consent page that issues codes, e.g. "https://app.example.com/oauth/authorize". */
  authorizeUrl: string;
  /** Resolves a bearer token; null when it's unknown, expired or revoked. */
  authenticate: (accessToken: string) => Promise<ApiCaller | null>;
  /** Issues tokens for a grant (checks the client, the code or refresh token, PKCE). */
  token: (grant: TokenGrant) => Promise<TokenResult>;
  /** Revokes an access or refresh token of the client; unknown tokens are not an error (RFC 7009). */
  revoke?: (request: { clientId: string; clientSecret: string | null; token: string }) => Promise<void>;
  /** Runs an operation's function as the caller, with `p_<name>` arguments. */
  invoke: (request: { rpc: string; args: Record<string, unknown>; caller: ApiCaller; operation: ApiOperation }) => Promise<InvokeResult>;
  /** Extra headers for every response, e.g. CORS. Defaults to allowing any origin. */
  headers?: Record<string, string>;
  maxBodyBytes?: number;
};

const DEFAULT_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

/** The HTTP status for a PostgREST/Postgres error code raised by an operation's function. */
export function statusForDbError(code: string | undefined, fallback = 500): number {
  switch (code) {
    case "P0002": // no_data_found
    case "PGRST116":
      return 404;
    case "42501": // insufficient_privilege (RLS)
      return 403;
    case "22023": // invalid_parameter_value
    case "22P02": // invalid_text_representation
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
    case "23502": // not_null_violation
    case "23514": // check_violation
    case "PGRST202": // function/arguments don't match
      return 422;
    case "23505": // unique_violation
    case "23503": // foreign_key_violation
      return 409;
    default:
      return fallback;
  }
}

// ── JSON Schema validation (the subset documents use) ─────────────────────────────────────────

const FORMATS: Record<string, (value: string) => boolean> = {
  "date-time": (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(v) && !Number.isNaN(Date.parse(v)),
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
  uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  // An absolute URI: a scheme, then anything without spaces (spacify:stream:…, https://…).
  uri: (v) => /^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(v),
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
};

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/**
 * Checks `value` against `schema`, resolving `#/components/schemas/…` refs in `document`. Returns
 * the problems as "path: message" lines (empty when valid).
 */
export function validate(schema: JsonSchema | undefined, value: unknown, document?: Pick<ApiDocument, "components">, path = "body"): string[] {
  if (!schema) return [];
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/components\/schemas\//, "");
    const target = document?.components?.schemas?.[name];
    if (!target) return [`${path}: unknown schema ${schema.$ref}`];
    return validate(target, value, document, path);
  }
  const problems: string[] = [];
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok = types.some((t) => t === actual || (t === "number" && actual === "integer"));
    if (!ok) return [`${path}: must be ${types.join(" or ")}`];
  }
  if (schema.enum && !schema.enum.some((option) => option === value)) {
    problems.push(`${path}: must be one of ${schema.enum.map((o) => JSON.stringify(o)).join(", ")}`);
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) problems.push(`${path}: at least ${schema.minLength} characters`);
    if (schema.maxLength != null && value.length > schema.maxLength) problems.push(`${path}: at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) problems.push(`${path}: doesn't match ${schema.pattern}`);
    const format = schema.format ? FORMATS[schema.format] : undefined;
    if (format && !format(value)) problems.push(`${path}: must be a ${schema.format}`);
  }
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) problems.push(`${path}: must be at least ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) problems.push(`${path}: must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) problems.push(`${path}: at least ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) problems.push(`${path}: at most ${schema.maxItems} items`);
    value.forEach((item, index) => problems.push(...validate(schema.items, item, document, `${path}[${index}]`)));
  }
  if (typeOf(value) === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) problems.push(`${path}.${key}: is required`);
    }
    for (const [key, item] of Object.entries(record)) {
      const property = schema.properties?.[key];
      if (property) problems.push(...validate(property, item, document, `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}.${key}: is not a known field`);
      else if (typeof schema.additionalProperties === "object") problems.push(...validate(schema.additionalProperties, item, document, `${path}.${key}`));
    }
  }
  return problems;
}

// ── Routing ──────────────────────────────────────────────────────────────────────────────────

type CompiledPath = { template: string; regex: RegExp; names: string[] };

function compilePath(template: string): CompiledPath {
  const names: string[] = [];
  const pattern = template
    .split("/")
    .map((segment) => {
      const param = /^\{([A-Za-z_][\w]*)\}$/.exec(segment);
      if (param) {
        names.push(param[1]);
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { template, regex: new RegExp(`^${pattern}/?$`), names };
}

/** The operation for a method and path, with its path parameters; `allowed` lists the path's methods. */
export function matchOperation(document: ApiDocument, method: string, path: string, compiled = compileAll(document)) {
  for (const entry of compiled) {
    const match = entry.regex.exec(path);
    if (!match) continue;
    const item = document.paths[entry.template] ?? {};
    const allowed = API_METHODS.filter((m) => item[m]).map((m) => m.toUpperCase());
    const operation = item[method.toLowerCase() as ApiMethod];
    const params: Record<string, string> = {};
    entry.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });
    return { operation: operation ?? null, params, allowed, template: entry.template };
  }
  return null;
}

function compileAll(document: ApiDocument): CompiledPath[] {
  // Literal segments win over parameters: /streams/active before /streams/{id}.
  return Object.keys(document.paths)
    .map(compilePath)
    .sort((a, b) => a.names.length - b.names.length || b.template.length - a.template.length);
}

/** The scopes an operation asks for (any one of its security requirements must be met). */
function requiredScopeSets(operation: ApiOperation): string[][] | null {
  if (!operation.security) return [[]];
  if (operation.security.length === 0) return null; // explicitly public
  return operation.security.map((requirement) => Object.values(requirement).flat());
}

/** A query or path value as its schema's type: "3" → 3, "true" → true. */
function coerce(raw: string, schema: JsonSchema | undefined): unknown {
  const types = schema?.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : ["string"];
  if ((types.includes("integer") || types.includes("number")) && raw.trim() !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  if (types.includes("boolean") && (raw === "true" || raw === "false")) return raw === "true";
  if (types.includes("array")) return raw.split(",").map((item) => coerce(item, schema?.items));
  return raw;
}

/** `startedAt` / `started_at` → `p_started_at`, the way the host's SQL functions name arguments. */
export function rpcArgName(name: string): string {
  return `p_${name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`;
}

// ── The handler ──────────────────────────────────────────────────────────────────────────────

export function createApiGateway(options: ApiGatewayOptions): (request: Request) => Promise<Response> {
  const headers = options.headers ?? DEFAULT_HEADERS;
  const basePath = (options.basePath ?? "").replace(/\/+$/, "");
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const compiled = compileAll(options.document);

  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", ...extra } });
  // RFC 9457 problem details.
  const problem = (status: number, title: string, detail?: string, extra: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}), ...extra }), {
      status,
      headers: { ...headers, "Content-Type": "application/problem+json", ...extraHeaders },
    });
  const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

  async function readText(request: Request): Promise<string | null> {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > maxBodyBytes) return null;
    const text = await request.text();
    return text.length > maxBodyBytes ? null : text;
  }

  /** The form (or JSON) fields of a token/revoke request, with Basic client credentials merged in. */
  async function readForm(request: Request): Promise<Record<string, string> | null> {
    const text = await readText(request);
    if (text === null) return null;
    const type = request.headers.get("content-type") ?? "";
    const fields: Record<string, string> = {};
    if (type.includes("application/json")) {
      try {
        for (const [key, value] of Object.entries(JSON.parse(text || "{}") as Record<string, unknown>)) {
          if (typeof value === "string") fields[key] = value;
        }
      } catch {
        return null;
      }
    } else {
      for (const [key, value] of new URLSearchParams(text)) fields[key] = value;
    }
    const basic = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
    if (basic) {
      try {
        const decoded = atob(basic[1]);
        const colon = decoded.indexOf(":");
        if (colon > 0) {
          fields.client_id = decodeURIComponent(decoded.slice(0, colon));
          fields.client_secret = decodeURIComponent(decoded.slice(colon + 1));
        }
      } catch {
        // not base64: left to the client_id check below
      }
    }
    return fields;
  }

  function servedDocument(request: Request): ApiDocument {
    // Without publicUrl: the request's URL up to the base path, keeping a proxy's prefix.
    const url = new URL(request.url);
    const at = basePath ? url.pathname.indexOf(basePath) : -1;
    const prefix = at === -1 ? "" : url.pathname.slice(0, at + basePath.length);
    const base = (options.publicUrl ?? `${url.origin}${prefix}`).replace(/\/+$/, "");
    const schemes = { ...(options.document.components?.securitySchemes ?? {}) } as Record<string, unknown>;
    schemes.oauth2 = {
      type: "oauth2",
      flows: {
        authorizationCode: {
          authorizationUrl: options.authorizeUrl,
          tokenUrl: `${base}/oauth/token`,
          refreshUrl: `${base}/oauth/token`,
          scopes: ((schemes.oauth2 as { flows?: { authorizationCode?: { scopes?: Record<string, string> } } } | undefined)?.flows?.authorizationCode?.scopes) ?? {},
        },
      },
    };
    return { ...options.document, servers: [{ url: base }], components: { ...options.document.components, securitySchemes: schemes } };
  }

  async function handleToken(request: Request): Promise<Response> {
    const form = await readForm(request);
    if (!form) return json({ error: "invalid_request", error_description: "Unreadable or too large body" }, 400, noStore);
    const clientId = form.client_id;
    if (!clientId) return json({ error: "invalid_client", error_description: "client_id is missing" }, 401, noStore);
    const clientSecret = form.client_secret || null;
    let grant: TokenGrant;
    if (form.grant_type === "authorization_code") {
      if (!form.code) return json({ error: "invalid_request", error_description: "code is missing" }, 400, noStore);
      grant = { grantType: "authorization_code", clientId, clientSecret, code: form.code, redirectUri: form.redirect_uri || null, codeVerifier: form.code_verifier || null };
    } else if (form.grant_type === "refresh_token") {
      if (!form.refresh_token) return json({ error: "invalid_request", error_description: "refresh_token is missing" }, 400, noStore);
      grant = { grantType: "refresh_token", clientId, clientSecret, refreshToken: form.refresh_token, scope: form.scope || null };
    } else {
      return json({ error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token" }, 400, noStore);
    }
    const result = await options.token(grant);
    if ("error" in result) return json(result, result.error === "invalid_client" ? 401 : 400, noStore);
    return json(result, 200, noStore);
  }

  async function handleRevoke(request: Request): Promise<Response> {
    if (!options.revoke) return problem(404, "Not Found");
    const form = await readForm(request);
    if (!form?.client_id || !form.token) return json({ error: "invalid_request" }, 400, noStore);
    await options.revoke({ clientId: form.client_id, clientSecret: form.client_secret || null, token: form.token });
    return new Response(null, { status: 200, headers: { ...headers, ...noStore } });
  }

  async function handleOperation(request: Request, path: string): Promise<Response> {
    const match = matchOperation(options.document, request.method, path, compiled);
    if (!match) return problem(404, "Not Found", `No operation at ${path}`);
    const operation = match.operation;
    if (!operation) return problem(405, "Method Not Allowed", undefined, {}, { Allow: match.allowed.join(", ") });

    const scopeSets = requiredScopeSets(operation);
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
    const challenge = (error: string) => ({ "WWW-Authenticate": `Bearer realm="api", error="${error}"` });
    let caller: ApiCaller | null = null;
    if (scopeSets) {
      if (!bearer) return problem(401, "Unauthorized", "Send an access token: Authorization: Bearer <token>", {}, { "WWW-Authenticate": 'Bearer realm="api"' });
      caller = await options.authenticate(bearer[1]);
      if (!caller) return problem(401, "Unauthorized", "The access token is invalid, expired or revoked", {}, challenge("invalid_token"));
      const granted = new Set(caller.scopes);
      if (!scopeSets.some((set) => set.every((scope) => granted.has(scope)))) {
        const needed = scopeSets.map((set) => set.join(" ")).join(" or ");
        return problem(403, "Forbidden", `The token lacks the scope ${needed}`, {}, { "WWW-Authenticate": `Bearer realm="api", error="insufficient_scope", scope="${scopeSets[0].join(" ")}"` });
      }
    }

    const args: Record<string, unknown> = {};
    const problems: string[] = [];
    const url = new URL(request.url);
    for (const parameter of operation.parameters ?? []) {
      const raw = parameter.in === "path" ? match.params[parameter.name] : parameter.in === "query" ? url.searchParams.get(parameter.name) : parameter.in === "header" ? request.headers.get(parameter.name) : null;
      if (raw == null || raw === "") {
        if (parameter.required || parameter.in === "path") problems.push(`${parameter.in}.${parameter.name}: is required`);
        continue;
      }
      const value = coerce(raw, parameter.schema);
      problems.push(...validate(parameter.schema, value, options.document, `${parameter.in}.${parameter.name}`));
      args[rpcArgName(parameter.name)] = value;
    }

    if (operation.requestBody) {
      const text = await readText(request);
      if (text === null) return problem(413, "Content Too Large");
      if (text.trim()) {
        const schema = operation.requestBody.content["application/json"]?.schema;
        if (!schema) return problem(415, "Unsupported Media Type", "Send application/json");
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return problem(400, "Bad Request", "The body isn't valid JSON");
        }
        problems.push(...validate(schema, body, options.document));
        if (typeOf(body) === "object") {
          for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
            // Path parameters win: a body can't retarget the row in the URL.
            if (!(rpcArgName(key) in args)) args[rpcArgName(key)] = value;
          }
        }
      } else if (operation.requestBody.required) {
        problems.push("body: is required");
      }
    }
    if (problems.length) return problem(422, "Unprocessable Content", problems.join("; "), { errors: problems });

    const anonymous: ApiCaller = { userId: "", clientId: "", scopes: [] };
    const result = await options.invoke({ rpc: operation["x-gondol-rpc"], args, caller: caller ?? anonymous, operation });
    if ("error" in result) {
      return problem(result.error.status, result.error.status >= 500 ? "Internal Server Error" : "Request Failed", result.error.message, result.error.code ? { code: result.error.code } : {});
    }
    const status = Number(Object.keys(operation.responses).find((code) => /^2\d\d$/.test(code)) ?? 200);
    return json(result.data ?? null, status);
  }

  return async (request: Request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    let path = url.pathname;
    // The base path may come after a proxy's own prefix (/functions/v1/app-api/…).
    const at = basePath ? path.indexOf(basePath) : -1;
    if (at !== -1) path = path.slice(at + basePath.length);
    path = `/${path.replace(/^\/+/, "")}`;
    try {
      if (path === "/openapi.json" && request.method === "GET") return json(servedDocument(request));
      if (path === "/oauth/authorize" && request.method === "GET") {
        return new Response(null, { status: 302, headers: { ...headers, Location: `${options.authorizeUrl}${url.search}` } });
      }
      if (path === "/oauth/token") return request.method === "POST" ? await handleToken(request) : problem(405, "Method Not Allowed", undefined, {}, { Allow: "POST" });
      if (path === "/oauth/revoke") return request.method === "POST" ? await handleRevoke(request) : problem(405, "Method Not Allowed", undefined, {}, { Allow: "POST" });
      return await handleOperation(request, path);
    } catch (error) {
      console.error("gondol api gateway:", error);
      return problem(500, "Internal Server Error");
    }
  };
}
