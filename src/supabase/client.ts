import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseFetch, lazy, requireEnv } from "./fetch";
import type { GondolDatabase } from "./types";

/**
 * The browser (and SSR) Supabase client every gondol module talks through. It is created from the
 * environment on first use: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (Vite build-time
 * replacement on the client), falling back to SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (SSR).
 *
 * An app reads it with its own generated schema: `getSupabaseClient<Database>()`, so the app and
 * gondol share one client (one auth session).
 */
function createBrowserClient(): SupabaseClient<GondolDatabase> {
  const { url, key } = requireEnv({
    url: import.meta.env?.["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"],
    key: import.meta.env?.["VITE_SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_PUBLISHABLE_KEY"],
  });
  return createClient<GondolDatabase>(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

let client: SupabaseClient<GondolDatabase> | undefined;

/** Use a client of the app's own making instead of the one gondol creates from the environment. Call it before anything queries. */
export function setSupabaseClient(next: SupabaseClient<never>): void {
  client = next as unknown as SupabaseClient<GondolDatabase>;
}

/** The shared client, typed with the app's schema (`Database`), or gondol's base schema by default. */
export function getSupabaseClient<Database = GondolDatabase>(): SupabaseClient<Database> {
  client ??= createBrowserClient();
  return client as unknown as SupabaseClient<Database>;
}

/** The shared client, typed with gondol's base schema. */
export const supabase: SupabaseClient<GondolDatabase> = lazy(() => getSupabaseClient());
