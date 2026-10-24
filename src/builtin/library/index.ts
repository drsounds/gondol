import { createElement } from "react";
import { defineApp, lazyWidget } from "../../apps/defineApp";
import type { AppSidebarWidgetProps } from "../../apps/types";
import manifest from "./manifest.json";

const SidebarLibrary = lazyWidget(() => import("./features/library/src/widgets/SidebarLibrary").then((m) => m.SidebarLibrary));

/**
 * The library app, built into gondol: the entities the user saves and pins (`saved_items`,
 * `pinned_items`, by entity URI), at `/library` and as "Your Library" at the bottom of the desktop
 * sidebar, with the user's playlists when the playlists app is on. "Save to library" and "Pin" come
 * with ActionMenu's `uri` once the host offers them (its EntityActionsProvider).
 *
 * Switch it on by adding it to the host's apps: `configureGondol({ apps: [...apps, libraryApp] })`,
 * or `gondolApps({ builtin: ["library"] })`. Its tables are in docs/guide/library.md.
 */
export const libraryApp = defineApp({
  manifest,
  pages: {
    library: () => import("./features/library/src/pages/LibraryPage").then((m) => m.LibraryPage),
  },
  widgets: {
    sidebarPanelWidgets: [
      (props: AppSidebarWidgetProps) => createElement(SidebarLibrary, { onOpenUri: props.onOpenUri ?? (() => {}), collapsed: props.collapsed ?? false }),
    ],
  },
});

export default libraryApp;
