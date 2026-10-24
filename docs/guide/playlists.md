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
(`playlist_id`, `uri`, `entity_type`/`entity_id` when the URI is an entity, `title`, `position`). Public playlists and their items are readable by every
signed-in user; `playlist_covers()` returns a public playlist's covers to them.
