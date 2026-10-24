# The search app

Gondol's `search` app is the search page at `/search`: a Spotify-style search over every entity the
user can see (their own rows plus other users' public ones), backed by the `search_entities()`
Postgres function that also powers `@` mentions and `<EntityPicker/>` (see
[Search and filters](./search-and-filters.md)). With an empty query the page shows the user's recent
searches and a **Browse all** grid of tiles.

## Switching it on

```ts
import { searchApp } from "gondol/builtin/search";
configureGondol({ apps: [...myApps, searchApp] });
// or, with the Vite plugin:
gondolApps({ dir: "apps", builtin: ["search"] });
```

The feature is `hiddenFromNav`: the shell's chrome search field opens it, and a host that wants a
menu item for it adds one itself.

## Browse tiles

Every app can put a tile on the browse grid. A manifest feature does it with `browse`:

```json
{ "id": "playlists", "path": "playlists", "browse": { "label": "nav.playlists", "iconName": "play", "hue": 141, "order": 20 } }
```

and code can answer `searchBrowseHook` (`gondol/apps/shellHooks`) directly, which is how a host adds
tiles for pages that aren't app features:

```ts
import { answer } from "gondol/apps/contributions";
import { searchBrowseHook } from "gondol/apps/shellHooks";

configureGondol({
  resolutions: [answer(searchBrowseHook, { label: "nav.entries", path: "/entries", icon: "list-ul", hue: 214, order: 10 })],
});
```

Tiles sort by `order` (ascending); tiles without one come last, in app order. Gondol's own apps use
library 40, playlists 20, streams 160 and analytics 170, so leave gaps between yours.

## Opening a result

A result opens its entity's view (`resolveEntityUri()`); a host that renders the panel itself can
pass `onOpenUri` to `SearchPanel` (`gondol/builtin/search/features/search/src/components/SearchPanel`).
