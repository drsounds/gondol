import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";

/**
 * The search app, built into gondol: `/search`, a Spotify-style search over every entity the user
 * can see (the `search_entities()` Postgres function, the one @ mentions and EntityPicker use too),
 * with recent searches and, before anything is typed, a "Browse all" grid of every app's main
 * lists: the answers to `searchBrowseHook` (a manifest feature's `browse`, or the host's own).
 *
 * Switch it on by adding it to the host's apps: `configureGondol({ apps: [...apps, searchApp] })`,
 * or `gondolApps({ builtin: ["search"] })` with the Vite plugin. See docs/guide/search.md.
 */
export const searchApp = defineApp({
  manifest,
  pages: {
    search: () => import("./features/search/src/pages/SearchPage").then((m) => m.SearchPage),
  },
});

export default searchApp;
