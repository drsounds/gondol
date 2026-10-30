# The playlists app

Gondol's `playlists` app keeps ordered collections of any entity (stored by entity URI, so a new
type works as soon as it's registered) and of plain web links, each item with an optional `title`.
It depends on the [library app](./library.md).

## Switching it on

```ts
import { playlistsApp } from "gondol/builtin/playlists";
configureGondol({ apps: [...myApps, playlistsApp] });
// or: gondolApps({ dir: "apps", builtin: ["playlists"] });
```

## Pages

| Path | |
| --- | --- |
| `/playlists` | The user's playlists. |
| `/playlists/<key>` | A playlist: its header, its numbered items (drag to reorder, drop rows on it to add them). |
| `/playlists/new`, `/playlists/<key>/edit` | The playlist's sheet: name, description, public or not, and its images. |
| `/playlists/<key>/items/new`, `/playlists/<key>/items/<item>/edit` | Add items; an item's own title and custom date added. |

## Keyboard, clipboard and undo

In a playlist (focus on its rows, or nowhere in particular) the arrow keys move between rows,
Shift extends the selection (Home/End too), Ctrl/⌘ or Shift with a click (or a click on the number)
select with the mouse, Mod+A selects all, Esc clears, Alt+↑/↓ (or Mod+Shift+↑/↓) moves the selection,
Delete removes it and Enter opens the row. Mod+C / Mod+X put the selected items' URIs on the
clipboard (entity URIs, one per line, and web links); Mod+V pastes after the selection: entity URIs
and app addresses as entities, and web links as bookmarks where the host keeps them
(`playlistsHostHook`, below), else as links. Pasting a copy back keeps the items' titles, and a cut
keeps their added dates (and, in the same playlist, their ids).

Every change in the view (add, remove, move, cut, paste, edit) is a step of `usePlaylistHistory()`
(`models/history.ts`): Mod+Z undoes it, Mod+Shift+Z or Mod+Y redoes it (also the Undo and Redo
buttons). Items keep their ids and `added_at` through undo and redo. The history lasts for the page.

## Bookmarks

```ts
import { playlistsHostHook } from "gondol/builtin/playlists/models/host";

// Saves a pasted web page as a bookmark entity and resolves to its entity URI.
answer(playlistsHostHook, { useSaveLink: () => (url) => saveBookmark(url) });
```

The app owns the entity type `playlist`. "Add to playlist…" in every `ActionMenu` with a `uri` uses
`useAddToPlaylist()` from `gondol/builtin/playlists/models/playlists`, which takes an entity URI or
an `https://` link.

## Images

A playlist's header image and image are its covers (`header_image`, `square_cover_image`). Gondol
has no media library of its own, so the host provides covers by answering `mediaHostHook`
(`gondol/media/host`); without an answer the image fields are hidden and playlists show their
generated art:

```ts
import { answer } from "gondol/apps/contributions";
import { mediaHostHook } from "gondol/media/host";

answer(mediaHostHook, {
  useImages,             // the user's images, for pickers and avatars
  useEntityCovers,       // (uri) → { header_image?, square_cover_image?, … }
  useSetEntityCovers,    // saves an entity's covers
  mediaSrc,              // a media row → its address
  ImagePicker,           // optional: picks an image ({ value, onChange })
  CoverFrame,            // optional: draws a cover slot
  MediaPicker,           // optional: picks media of some kinds (the agents app's avatar)
});
```

## The tables

`playlists` (`name`, `description`, `is_public`, plus `identifier`/`slug`) and `playlist_items`
(`playlist_id`, `uri`, `entity_type`/`entity_id` when the URI is an entity, `title`, `position`,
`added_at` (default now(), written as it was when undo or a cut brings an item back) and
`custom_added_on`, a date the user set to show instead). Public playlists and their items are readable by every
signed-in user; `playlist_covers()` returns a public playlist's covers to them.
