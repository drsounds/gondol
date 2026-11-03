// The app router (docs/guide/functions.md): routes calls to the server functions apps declare in
// their manifests (`functions`) and serves what they offer AI models (`mcp`) as MCP servers. The
// routes are gondol's router (../_shared/gondol-api/router.ts); `gondol-api --functions <dir>`
// copies this file next to the host's other functions, and the registry it serves, apps.json, is
// built from the manifests by the same script.
//
//   GET  /app-router/apps                          the apps, their functions and tools
//   POST /app-router/apps/<app>/functions/<name>   run a function
//   POST /app-router/mcp                           every app's tools as one MCP server
//   POST /app-router/apps/<app>/mcp                one app's
//
// A caller is the user's own Supabase session (a JWT: every scope) or an access token from the app
// API's OAuth (opaque: its scopes, looked up with oauth_authenticate()). Postgres functions run as
// the user through PostgREST, so row level security applies; an edge function gets the input as its
// JSON body with the user's token (for OAuth callers a one-minute JWT for the user, signed with the
// stack's JWT secret). Deploy it with `verify_jwt = false`, since OAuth tokens aren't JWTs: it checks
// every token itself.
//
// Secrets: SUPABASE_URL and SUPABASE_ANON_KEY; for OAuth callers also SUPABASE_SERVICE_ROLE_KEY and
// JWT_SECRET (or SUPABASE_JWT_SECRET). Optional: APP_ROUTER_PUBLIC_URL (its public address),
// APP_API_PUBLIC_URL (the OAuth server MCP clients are pointed at), APP_ROUTER_FORWARD_HEADERS
// (request headers passed on to functions, e.g. `x-spacify-workspace`) and whatever secrets apps'
// own MCP servers name in their manifests.
//
// For callers with their own session, /mcp also has gondol's own tools: apps__… (the installed apps,
// their features, actions, entity types and functions) and entities__… (CRUD on any entity through
// the host's entity API, Postgres functions named in ENTITY_API_FUNCTIONS that run as the user, so
// RLS decides). APP_ROUTER_ENTITIES=false turns the entity tools off (for a host without them),
// APP_ROUTER_DISCOVERY=false the app tools.
//
// Remote apps' backends (apps loaded from a gondol apps runtime, docs/guide/remote-apps.md) join the
// apps once an admin approved them: the host's approved_remote_app_backends() lists them (read with
// SUPABASE_SERVICE_ROLE_KEY), and their functions are called on the runtime with its secret and the
// caller's user id, never the caller's token. Runtimes must be public HTTPS hosts, unless
// REMOTE_APPS_ALLOWED_HOSTS lists the host or REMOTE_APPS_ALLOW_PRIVATE=true.
//
// Users' own MCP servers (the ai app's ai_mcp_servers, with their header values from
// ai_mcp_server_headers) join /mcp for callers with their own session; reading them takes
// SUPABASE_SERVICE_ROLE_KEY. Their addresses must be public HTTPS, unless MCP_ALLOWED_HOSTS lists the
// host (comma separated, host or host:port) or MCP_ALLOW_PRIVATE=true.
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT } from "npm:jose@5";
import { statusForDbError } from "../_shared/gondol-api/gateway.ts";
import { createAppRouter, type AppRegistry, type RegistryApp, type RemoteBackend, type RouterCaller, type UserMcpServer } from "../_shared/gondol-api/router.ts";
import registry from "../_shared/gondol-api/apps.json" with { type: "json" };

const env = (name: string) => Deno.env.get(name) || undefined;
const SUPABASE_URL = env("SUPABASE_URL")!;
const ANON_KEY = env("SUPABASE_ANON_KEY") ?? env("SUPABASE_PUBLISHABLE_KEY")!;
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const JWT_SECRET = env("JWT_SECRET") ?? env("SUPABASE_JWT_SECRET") ?? "";
// `x-gondol-actor` always goes along: the AI chat and the agents name themselves in it (the entity
// URI of the conversation or the agent) when they call a tool, so the app can log who did a write.
const FORWARD = [
  ...new Set(["x-gondol-actor", ...(env("APP_ROUTER_FORWARD_HEADERS") ?? "").split(",").map((h) => h.trim().toLowerCase())]),
].filter(Boolean);

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const secret = new TextEncoder().encode(JWT_SECRET);

/** A token to act as the caller with: their own session, or a one-minute JWT for an OAuth caller. */
async function bearerFor(caller: RouterCaller | null): Promise<string | null> {
  if (!caller) return null;
  if (caller.scopes === null) return caller.token;
  if (!JWT_SECRET) throw new Error("The app router isn't configured for OAuth callers (JWT_SECRET)");
  return await new SignJWT({
    role: "authenticated",
    oauth_client_id: caller.clientId ?? null,
    oauth_app_uri: caller.appUri ?? null,
    oauth_scopes: caller.scopes,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(caller.userId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(secret);
}

// ── Users' own MCP servers ───────────────────────────────────────────────────────────────────

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

const MCP_ALLOWED_HOSTS = (env("MCP_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

/**
 * Throws when the router may not call `value`: only public HTTPS hosts, unless `allowedHosts` lists
 * the host or `allowPrivate` (see the top of this file). `what` names it in the errors.
 */
async function checkPublicUrl(value: string, what: string, allowedHosts: string[], allowPrivate: boolean, allowedVariable: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The ${what}'s address isn't a valid URL`);
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error(`The ${what}'s address must be an HTTP(S) URL without credentials`);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (allowPrivate || allowedHosts.includes(url.host.toLowerCase()) || allowedHosts.includes(hostname)) return;
  const local = hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal");
  const ipLiteral = hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname);
  if (url.protocol !== "https:" || local || ipLiteral) throw new Error(`The server doesn't call this ${what} address (only public HTTPS hosts, unless ${allowedVariable} lists it)`);
  const records = await Promise.allSettled([Deno.resolveDns(hostname, "A"), Deno.resolveDns(hostname, "AAAA")]);
  const addresses = records.flatMap((record) => (record.status === "fulfilled" ? record.value : []));
  if (!addresses.length) throw new Error(`Couldn't resolve the ${what}'s host`);
  if (addresses.some((address) => (address.includes(":") ? isPrivateIpv6(address) : isPrivateIpv4(address)))) {
    throw new Error(`The server doesn't call this ${what} address (a private network)`);
  }
}

/** Throws when the router may not call a user's MCP server at `value`. */
const checkMcpUrl = (value: string) => checkPublicUrl(value, "MCP server", MCP_ALLOWED_HOSTS, env("MCP_ALLOW_PRIVATE") === "true", "MCP_ALLOWED_HOSTS");

// ── Remote apps' backends ────────────────────────────────────────────────────────────────────

const REMOTE_APPS_ALLOWED_HOSTS = (env("REMOTE_APPS_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

/**
 * The backends of remote apps an admin approved (gondol's docs/guide/remote-apps.md): the host's
 * `approved_remote_app_backends()` (read with the service role) returns each one's registry entry,
 * as built from the approved manifest, and the secret its runtime expects. Functions on a runtime
 * that isn't a public HTTPS host (REMOTE_APPS_ALLOWED_HOSTS, REMOTE_APPS_ALLOW_PRIVATE) are left out.
 */
async function remoteApps(): Promise<RemoteBackend[]> {
  if (!admin) return [];
  const { data, error } = await admin.rpc("approved_remote_app_backends");
  if (error) {
    // 42883/PGRST202: the host has no remote apps.
    if (error.code !== "42883" && error.code !== "PGRST202") console.error("app-router: approved_remote_app_backends:", error.message);
    return [];
  }
  const rows = (data ?? []) as { app_id: string; registry: RegistryApp; secret: string | null }[];
  const checked = new Map<string, boolean>();
  const allowed = async (url: string) => {
    const origin = new URL(url).origin;
    if (!checked.has(origin)) {
      try {
        await checkPublicUrl(url, "apps runtime", REMOTE_APPS_ALLOWED_HOSTS, env("REMOTE_APPS_ALLOW_PRIVATE") === "true", "REMOTE_APPS_ALLOWED_HOSTS");
        checked.set(origin, true);
      } catch (caught) {
        console.error(`app-router: remote app runtime ${origin}:`, caught instanceof Error ? caught.message : caught);
        checked.set(origin, false);
      }
    }
    return checked.get(origin)!;
  };
  const out: RemoteBackend[] = [];
  for (const row of rows) {
    if (!row.registry || row.registry.id !== row.app_id) continue;
    const functions: RegistryApp["functions"] = {};
    for (const [name, fn] of Object.entries(row.registry.functions ?? {})) {
      if ("runtime" in fn.target && (await allowed(fn.target.runtime))) functions[name] = fn;
    }
    const tools = (row.registry.tools ?? []).filter((tool) => "runtime" in tool.target && Object.values(functions).some((fn) => "runtime" in fn.target && fn.target.runtime === (tool.target as { runtime: string }).runtime));
    out.push({ app: { ...row.registry, functions, tools }, secret: row.secret });
  }
  return out;
}

/** The caller's enabled MCP servers with their headers (read with the service role, by owner). */
async function userMcpServers(caller: RouterCaller): Promise<UserMcpServer[]> {
  if (!admin) return [];
  const { data, error } = await admin
    .from("ai_mcp_servers")
    .select("id, name, url, description")
    .eq("user_id", caller.userId)
    .eq("enabled", true)
    .order("position")
    .limit(20);
  // 42P01: the host hasn't the table (no ai app migration).
  if (error) {
    if (error.code !== "42P01") console.error("app-router: ai_mcp_servers:", error.message);
    return [];
  }
  const rows = (data ?? []) as { id: string; name: string; url: string; description: string | null }[];
  if (!rows.length) return [];
  const { data: secrets, error: secretError } = await admin
    .from("ai_mcp_server_headers")
    .select("server_id, headers")
    .eq("user_id", caller.userId)
    .in("server_id", rows.map((row) => row.id));
  if (secretError) console.error("app-router: ai_mcp_server_headers:", secretError.message);
  const headersOf = new Map(((secrets ?? []) as { server_id: string; headers: Record<string, unknown> }[]).map((row) => [row.server_id, row.headers]));
  return await Promise.all(
    rows.map(async (row): Promise<UserMcpServer> => {
      const headers = Object.fromEntries(Object.entries(headersOf.get(row.id) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      try {
        await checkMcpUrl(row.url);
        return { ...row, headers };
      } catch (caught) {
        return { ...row, error: caught instanceof Error ? caught.message : String(caught) };
      }
    }),
  );
}

function forwarded(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

const handler = createAppRouter({
  registry: registry as unknown as AppRegistry,
  basePath: "/app-router",
  publicUrl: env("APP_ROUTER_PUBLIC_URL"),
  authorizationServers: env("APP_API_PUBLIC_URL") ? [env("APP_API_PUBLIC_URL")!] : undefined,
  secret: env,
  userMcpServers,
  remoteApps,
  discovery: env("APP_ROUTER_DISCOVERY") !== "false",
  entities: env("APP_ROUTER_ENTITIES") !== "false",
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": ["authorization", "content-type", "x-client-info", "apikey", "mcp-protocol-version", "mcp-session-id", "x-gondol-apps", "x-gondol-entity-types", ...FORWARD].join(", "),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Expose-Headers": "WWW-Authenticate",
  },

  async authenticate(token) {
    // A Supabase session is a JWT; the app API's access tokens are opaque.
    if (token.split(".").length === 3) {
      const { data, error } = await anon.auth.getUser(token);
      return error || !data.user ? null : { userId: data.user.id, token, scopes: null };
    }
    if (!admin) return null;
    const { data, error } = await admin.rpc("oauth_authenticate", { p_access_token: token });
    if (error) {
      console.error("app-router: oauth_authenticate:", error.message);
      return null;
    }
    const row = (data as { user_id: string; client_id: string; scopes: string[]; app_uri: string | null }[] | null)?.[0];
    return row ? { userId: row.user_id, token, scopes: row.scopes ?? [], clientId: row.client_id, appUri: row.app_uri } : null;
  },

  async rpc({ rpc, args, caller, request }) {
    const bearer = await bearerFor(caller);
    const db = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { apikey: ANON_KEY, ...forwarded(request), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) } },
    });
    const { data, error } = await db.rpc(rpc, args);
    if (error) return { error: { status: statusForDbError(error.code), message: error.message, code: error.code } };
    return { data };
  },

  async callFunction({ function: name, input, caller, app, name: fn, request }) {
    const bearer = await bearerFor(caller);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        "x-gondol-app": app,
        "x-gondol-function": fn,
        ...forwarded(request),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(input),
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON: passed on as text
    }
    if (!response.ok) {
      const body = data as { error?: unknown; message?: unknown; detail?: unknown } | null;
      const message = [body?.error, body?.message, body?.detail].find((m) => typeof m === "string") as string | undefined;
      return { error: { status: response.status, message: message ?? `${name} answered ${response.status}` } };
    }
    return { data };
  },
});

Deno.serve(handler);
