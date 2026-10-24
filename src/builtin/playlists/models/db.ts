import { getSupabaseClient } from "../../../supabase/client";
import { lazy } from "../../../supabase/fetch";
import type { PlaylistsDatabase } from "./types";

/** The shared client, typed with the playlists app's tables. */
export const supabase = lazy(() => getSupabaseClient<PlaylistsDatabase>());
