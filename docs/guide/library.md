# The library app

Gondol's `library` app is **Your Library**: what the user saved ("Save to library" in every
`ActionMenu` with a `uri`) and pinned, at `/library` and in the sidebar under the menu. Saved
entities show the saved glyph (`<SavedIcon/>`) on their rows everywhere.

## Switching it on

```ts
import { libraryApp } from "gondol/builtin/library";
configureGondol({ apps: [...myApps, libraryApp] });
// or: gondolApps({ dir: "apps", builtin: ["library"] });
```

The sidebar library is the app's `sidebarPanelWidgets` entry; users and sites turn it off with the
`sidebarLibrary` preference. With the [playlists app](./playlists.md) on, the library also lists the
user's playlists and offers "New playlist"; without it, it shows saved and pinned entities only.

## The models

`gondol/builtin/library/models/library` has `useLibrary()` (saved and pinned items, and the
functions that save, unsave, pin and unpin by entity URI), `savedItemsQueryOptions`,
`pinnedItemsQueryOptions` and `useLibraryPickerOptions()` (the library as `<EntityPicker/>`
options). Items are stored by entity URI, so any type works without schema changes.

## The tables

`saved_items` and `pinned_items`: `user_id`, `spacify_uri` (the entity URI; the column keeps its
historical name), an optional `label`, `created_at`, plus `identifier`/`slug`; pins also have a
`position`. Both are private to their user (RLS on `user_id`).
