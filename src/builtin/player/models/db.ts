import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../../supabase/client";

/** The player app's tables (external_service_accounts, playback_resolutions), untyped: they're the host's schema. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const playerDb = (): SupabaseClient<any> => getSupabaseClient<any>();
