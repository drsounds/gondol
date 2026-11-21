import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { accountEncryptionKey, encryptAccountToken } from "../_shared/accountTokenCrypto.ts";

const env = (name: string) => Deno.env.get(name)?.trim() || undefined;
const supabaseUrl = env("SUPABASE_URL");
const anonKey = env("SUPABASE_ANON_KEY");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const clientId = env("GITHUB_OAUTH_CLIENT_ID");
const clientSecret = env("GITHUB_OAUTH_CLIENT_SECRET");
const callbackUrl = env("GITHUB_OAUTH_REDIRECT_URL");
const returnUrl = env("GONDOL_ACCOUNTS_RETURN_URL");
const encryptionKey = env("ACCOUNT_TOKEN_ENCRYPTION_KEY");
const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const cors = {
  "Access-Control-Allow-Origin": env("GONDOL_ACCOUNTS_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function redirect(value: string): Response {
  return new Response(null, { status: 303, headers: { Location: value, "Cache-Control": "no-store" } });
}

function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function caller(request: Request): Promise<string> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !anonKey) throw new Error("Sign in first");
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Sign in first");
  return data.user.id;
}

async function start(request: Request): Promise<Response> {
  const userId = await caller(request);
  if (!admin || !clientId || !clientSecret || !callbackUrl || !returnUrl || !encryptionKey) return json({ error: "GitHub OAuth is not configured" }, 503);
  const state = randomToken();
  const { error } = await admin.from("account_oauth_states").insert({
    user_id: userId,
    provider: "github",
    state_hash: await hash(state),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) return json({ error: "Couldn't start GitHub sign-in" }, 500);
  const authorization = new URL("https://github.com/login/oauth/authorize");
  authorization.searchParams.set("client_id", clientId);
  authorization.searchParams.set("redirect_uri", callbackUrl);
  authorization.searchParams.set("scope", "read:user repo");
  authorization.searchParams.set("state", state);
  return json({ url: authorization.toString() });
}

function accountsReturn(status: "connected" | "error"): string {
  if (!returnUrl) throw new Error("GONDOL_ACCOUNTS_RETURN_URL is not configured");
  const target = new URL(returnUrl);
  if (target.protocol !== "https:" && target.hostname !== "localhost") throw new Error("The accounts return URL must use HTTPS");
  target.searchParams.set("github", status);
  return target.toString();
}

async function callback(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const state = query.get("state");
  const code = query.get("code");
  if (!admin || !clientId || !clientSecret || !callbackUrl || !encryptionKey || !state || !code || query.has("error")) {
    return redirect(accountsReturn("error"));
  }
  const { data: row, error: stateError } = await admin
    .from("account_oauth_states")
    .delete()
    .eq("state_hash", await hash(state))
    .eq("provider", "github")
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();
  if (stateError || !row?.user_id) return redirect(accountsReturn("error"));

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!tokenResponse?.ok) return redirect(accountsReturn("error"));
  const tokenData = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error?: string };
  if (!tokenData.access_token) return redirect(accountsReturn("error"));

  const identityResponse = await fetch("https://api.github.com/user", {
    headers: { Authorization: "Bearer " + tokenData.access_token, Accept: "application/vnd.github+json", "User-Agent": "gondol-accounts" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!identityResponse?.ok) return redirect(accountsReturn("error"));
  const identity = await identityResponse.json().catch(() => ({})) as { id?: number; login?: string; name?: string | null };
  if (!identity.id || !identity.login) return redirect(accountsReturn("error"));

  const encrypted = await encryptAccountToken(tokenData.access_token, accountEncryptionKey(encryptionKey));
  const { data: account, error: accountError } = await admin
    .from("account_connections")
    .upsert(
      { user_id: row.user_id, provider: "github", external_user_id: String(identity.id), login: identity.login, display_name: identity.name },
      { onConflict: "user_id,provider" },
    )
    .select("id")
    .single();
  if (accountError || !account) return redirect(accountsReturn("error"));
  const { error: saveError } = await admin.from("account_sessions").upsert(
    { account_id: account.id, access_token_ciphertext: encrypted, scopes: ["read:user", "repo"], updated_at: new Date().toISOString() },
    { onConflict: "account_id" },
  );
  if (saveError) {
    await admin.from("account_connections").delete().eq("id", account.id).eq("user_id", row.user_id);
    return redirect(accountsReturn("error"));
  }
  return redirect(accountsReturn("connected"));
}

async function disconnect(request: Request, db: SupabaseClient, userId: string): Promise<Response> {
  const input = await request.json().catch(() => ({})) as { account_id?: unknown };
  if (typeof input.account_id !== "string") return json({ error: "Name the account to disconnect" }, 422);
  const { error } = await db.from("account_connections").delete().eq("id", input.account_id).eq("user_id", userId);
  if (error) return json({ error: "Couldn't disconnect the account" }, 500);
  return json({ disconnected: true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path.endsWith("/callback")) {
    try {
      return await callback(request);
    } catch {
      return json({ error: "GitHub sign-in failed" }, 500);
    }
  }
  if (request.method !== "POST") return json({ error: "POST an accounts action" }, 405);
  try {
    const userId = await caller(request);
    const input = await request.json().catch(() => ({})) as { action?: unknown };
    if (input.action === "connect-github") return await start(request);
    if (!admin) return json({ error: "Accounts service is not configured" }, 503);
    if (input.action === "disconnect") return await disconnect(request, admin!, userId);
    return json({ error: "Unknown accounts action" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 401);
  }
});
