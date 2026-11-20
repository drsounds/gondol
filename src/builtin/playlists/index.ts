import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";

/**
 * The playlists app, built into gondol: ordered collections of any entity (by entity URI) and of
 * web links, with a title, a description and, where the host has a media library
 * (`mediaHostHook`), a header image and an image. Every other app can add to playlists: "Add to
 * playlist…" in ActionMenu (the host's EntityActionsProvider), dropping rows on a playlist.
 *
 * It needs the library app: `gondolApps({ builtin: ["library", "playlists"] })`. Its tables are in
 * docs/guide/playlists.md.
 */
export const playlistsApp = defineApp({
  manifest,
  pages: {
    playlists: () => import("./features/playlists/src/pages/PlaylistsPage").then((m) => m.PlaylistsPage),
  },
});

export default playlistsApp;
