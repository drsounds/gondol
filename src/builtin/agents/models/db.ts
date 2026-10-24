import { getSupabaseClient } from "../../../supabase/client";
import { lazy } from "../../../supabase/fetch";
import type { AgentsDatabase } from "./types";

/** The shared client, typed with the agents app's tables. */
export const supabase = lazy(() => getSupabaseClient<AgentsDatabase>());
