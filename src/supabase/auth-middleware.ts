import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseFetch, requireEnv } from "./fetch";
import type { GondolDatabase } from "./types";

/**
 * Server function middleware that requires a signed-in caller: it reads the bearer token
 * `attachSupabaseAuth` (./auth-attacher) sends, verifies it and hands the function a Supabase
 * client acting as that user (RLS applies), with `userId` and `claims`.
 */
export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { url, key } = requireEnv({ url: process.env["SUPABASE_URL"], key: process.env["SUPABASE_PUBLISHABLE_KEY"] });

  const request = getRequest();
  if (!request?.headers) throw new Error("Unauthorized: No request headers available");

  const authHeader = request.headers.get("authorization");
  if (!authHeader) throw new Error("Unauthorized: No authorization header provided");
  if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized: Only Bearer tokens are supported");

  const token = authHeader.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized: No token provided");
  if (token.split(".").length !== 3) throw new Error("Unauthorized: Invalid token");

  const supabase = createClient<GondolDatabase>(url, key, {
    global: { fetch: createSupabaseFetch(key), headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) throw new Error("Unauthorized: Invalid token");
  if (!data.claims.sub) throw new Error("Unauthorized: No user ID found in token");

  return next({ context: { supabase, userId: data.claims.sub, claims: data.claims } });
});
