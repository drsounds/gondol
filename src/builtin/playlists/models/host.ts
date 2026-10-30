import { defineHook, resolutionsOf } from "../../../apps/contributions";

/**
 * What the host app can do for the playlists app, by answering `playlistsHostHook` in
 * `configureGondol({ resolutions })`. Without an answer, pasted web links go in as plain links.
 */
export interface PlaylistsHost {
  /**
   * Saves a pasted web page as a bookmark entity (its Open Graph title, description and image, or
   * its icon) and resolves to that entity's URI, which then goes in the playlist instead of the link.
   * Null when the host has no bookmarks.
   */
  useSaveLink(): ((url: string) => Promise<string>) | null;
}

export const playlistsHostHook = defineHook<Partial<PlaylistsHost>>("playlists.host");

const DEFAULTS: PlaylistsHost = { useSaveLink: () => null };

/** Every answer to `playlistsHostHook`, merged over the defaults (later answers win). Stable for the page's life. */
export function playlistsHost(): PlaylistsHost {
  return Object.assign({}, DEFAULTS, ...resolutionsOf(playlistsHostHook).map((a) => a.value)) as PlaylistsHost;
}
