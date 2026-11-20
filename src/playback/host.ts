import { defineHook } from "../apps/contributions";
import type { PlayRequest } from "./types";

/**
 * What the host app (or any app) can do for playback, by answering `playbackHostHook`: turn its own
 * entity URIs into play requests (a recording with an ISRC external id, a track with a title and
 * an artist), so a playlist of entities plays through the music services like musik: URIs do.
 */
export interface PlaybackHost {
  /** The request for `uri`, or null when it isn't something that plays. */
  toPlayRequest?(uri: string): Promise<PlayRequest | null> | PlayRequest | null;
}

export const playbackHostHook = defineHook<PlaybackHost>("gondol.playbackHost");
