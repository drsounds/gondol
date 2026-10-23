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
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT } from "npm:jose@5";
import { statusForDbError } from "../_shared/gondol-api/gateway.ts";
import { createAppRouter, type AppRegistry, type RouterCaller } from "../_shared/gondol-api/router.ts";
import registry from "../_shared/gondol-api/apps.json" with { type: "json" };

const env = (name: string) => Deno.env.get(name) || undefined;
const SUPABASE_URL = env("SUPABASE_URL")!;
const ANON_KEY = env("SUPABASE_ANON_KEY") ?? env("SUPABASE_PUBLISHABLE_KEY")!;
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const JWT_SECRET = env("JWT_SECRET") ?? env("SUPABASE_JWT_SECRET") ?? "";
const FORWARD = (env("APP_ROUTER_FORWARD_HEADERS") ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

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
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": ["authorization", "content-type", "x-client-info", "apikey", "mcp-protocol-version", "mcp-session-id", ...FORWARD].join(", "),
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
