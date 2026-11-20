import { getSupabaseClient } from "../../../supabase/client";
import { lazy } from "../../../supabase/fetch";
import type { LibraryDatabase } from "./types";

/** The shared client, typed with the library app's tables. */
export const supabase = lazy(() => getSupabaseClient<LibraryDatabase>());
