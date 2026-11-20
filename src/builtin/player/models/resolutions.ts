import { playerDb } from "./db";
import { sessionUserId } from "../../../supabase/session";
import type { ResolutionStore, SavedResolution } from "../../../playback/coordinator";

/**
 * Saved "Play with…" choices (Bungalow's MusicServiceTrack) as `playback_resolutions` rows: per user,
 * keyed by the request's identity (`isrc:<ISRC>`, else its URI), so "always play this with …" holds
 * on every device. Private to their owner.
 */
export function databaseResolutionStore(): ResolutionStore {
  return {
    find: async (key) => {
      const { data, error } = await playerDb()
        .from("playback_resolutions")
        .select("service_id, candidate_uri, title, artist, by_isrc")
        .eq("request_key", key)
        .maybeSingle();
      if (error || !data) return null;
      return {
        serviceId: data.service_id,
        uri: data.candidate_uri ?? undefined,
        title: data.title ?? undefined,
        artist: data.artist ?? undefined,
        byIsrc: !!data.by_isrc,
      } satisfies SavedResolution;
    },
    save: async (key, resolution) => {
      const { error } = await playerDb()
        .from("playback_resolutions")
        .upsert(
          {
            user_id: await sessionUserId(),
            request_key: key,
            service_id: resolution.serviceId,
            candidate_uri: resolution.uri ?? null,
            title: resolution.title ?? null,
            artist: resolution.artist ?? null,
            by_isrc: resolution.byIsrc,
          },
          { onConflict: "user_id,request_key" },
        );
      if (error) throw error;
    },
    remove: async (key) => {
      const { error } = await playerDb().from("playback_resolutions").delete().eq("request_key", key);
      if (error) throw error;
    },
  };
}
