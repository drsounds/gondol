import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseFetch, lazy, requireEnv } from "./fetch";
import type { GondolDatabase } from "./types";

let admin: SupabaseClient<GondolDatabase> | undefined;

/**
 * Server-side Supabase client with the service role key: it bypasses RLS. Use it only for trusted
 * operations in server functions and server routes; for user-authenticated queries use
 * `requireSupabaseAuth` (./auth-middleware). Load it inside server handlers
 * (`const { getSupabaseAdmin } = await import("gondol/supabase/client.server")`): route files and
 * *.functions.ts ship to the client bundle.
 */
export function getSupabaseAdmin<Database = GondolDatabase>(): SupabaseClient<Database> {
  if (!admin) {
    const { url, key } = requireEnv({ url: process.env["SUPABASE_URL"], key: process.env["SUPABASE_SERVICE_ROLE_KEY"] });
    admin = createClient<GondolDatabase>(url, key, {
      global: { fetch: createSupabaseFetch(key) },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
  }
  return admin as unknown as SupabaseClient<Database>;
}

/** The service-role client, typed with gondol's base schema. */
export const supabaseAdmin: SupabaseClient<GondolDatabase> = lazy(() => getSupabaseAdmin());
