# Playback and music services

Gondol plays music through **music services**, apps that each bring one service (YouTube first),
with the multi-service architecture of [Bungalow](https://github.com/drsounds/bungalow): items are
named by what they are (`musik:` URIs, by ISRC or by title and artist), every music service is asked
what it has for them, and the user picks, once or for good, which match plays ("Play with…").

Two apps do this:

- `player` (`gondol/builtin/player`): the player bar along the bottom, the **service dock** at the
  bottom of the desktop menu (the active service's own player, like the album art in early Spotify),
  **Now playing** (full screen, with the queue), "Play with…", the Music services page
  (`/music-services`) and the playback shortcuts. It owns the entity type `external_service_account`.
- `yt-music-service` (`gondol/builtin/yt-music-service`, depends on `player`): YouTube as a music
  service. It plays YouTube links and finds candidates for musik: items with the `yt-music-service`
  edge function (the YouTube Data API with the user's own key, else YouTube's search page).

```ts
import { playerApp } from "gondol/builtin/player";
import { ytMusicServiceApp } from "gondol/builtin/yt-music-service";
configureGondol({ apps: [...myApps, playerApp, ytMusicServiceApp] });
// or: gondolApps({ dir: "apps", builtin: ["player", "yt-music-service"] });
```

`gondol-api --builtin …,yt-music-service --functions supabase/functions` copies the edge function.

## Services, aspects and concepts

Bungalow's service architecture is part of the apps framework (`gondol/services/*`):

| Bungalow | Gondol |
| --- | --- |
| `Aspect`, `AspectManager` | `Aspect` (`{ id, name }`) and `AspectManager<T>` (`services/aspect.ts`): a registry with `register`, `get`, `all` and `subscribe`. |
| `Service`, lifecycle | `Service` (`services/service.ts`): an aspect with `aspects` (what it implements), `appId` and `onCreate`/`onStart`/`onStop`/`onDestroy`. |
| `ServiceManager.getServices(aspect)` | `serviceManager.getServices(musicAspect)`; in components `useServices(aspect)` and `useServicesList()` (`services/ConceptsHost.tsx`). |
| `Concept`, `ConceptContext` | An app's `concept` (`onActivate(context)` / `onDeactivate()`), and its `services`. `ConceptManager` activates them while the app is on and unregisters everything it added when it goes off. |
| `Feature`, `FeatureManager` | App features, also registered in `featureManager` as `<app>.<feature>`. |

A service aspect is a typed token: `defineServiceAspect<MusicService>("music")`. The playback ones
(`gondol/playback/types`) are `media` (play, pause, seek, `loadUri`, events, an optional player
surface), `music` (`findCandidates(request)`, then load by URI, ISRC or title and artist), `auth`
(`login`, `logout`, `getAccount`) and `catalogue` (`search`).

An app declares its services in its manifest and implements them in `defineApp`:

```json
{
  "services": [
    {
      "id": "youtube",
      "name": "YouTube",
      "aspects": ["media", "music", "auth"],
      "hosts": ["youtube.com", "youtu.be"],
      "schemes": ["youtube:"]
    }
  ]
}
```

```ts
export const myApp = defineApp({
  manifest,
  services: { youtube: (definition) => new YouTubeService(definition) },
});
```

`BaseMediaService` (`gondol/playback/support`) does the listener bookkeeping and `canPlayUri` from
`hosts` and `schemes`. A service with a `surface` URL in its manifest and no implementation runs in
an iframe of that page, the way apps ran in early Spotify: gondol drives it over `postMessage`
(`gondol/playback/surfaceService`, which documents the messages: `load`, `play`, `seek`,
`findCandidates`, `login`, … and `state`, `position`, `track`, `session`, … back).

## musik: URIs

`gondol/playback/musikUri` ports Bungalow's RFC-0002 URIs: `musik:isrc:<ISRC>`,
`musik:artist:<artist>:release:<release>[:track:<n>]:name:<name>`, `musik:track?name=…&artist_name=…`,
and identities of works (`iswc`), releases (`upc`), artists (`isni`, `ipi`, `artist`) and facets
(`genre`, `mood`). `parseMusikUri`, `formatMusikUri`, `musikLabel` and `isPlayableMusikUri` are the
helpers; old `spacify:recording:isrc:` URIs parse too. Recordings (an ISRC or a name) play; the
others are kept and shown but aren't one playable item.

## The coordinator

`playback` (`gondol/playback/coordinator`) is Bungalow's `PlaybackCoordinator`: one queue, one
active service, one snapshot (`usePlayback()`, `usePlaybackSelector()`).

1. `requestFor(uri)` turns a URI into a `PlayRequest`: musik: by its identity, a link a service
   plays as it is, else whatever the host answers to `playbackHostHook` (`toPlayRequest(uri)`, for
   its own entities: a recording with an ISRC).
2. Playing an item asks the service that plays it as it is, else the saved choice, else every music
   service (`gatherMatches`). One match plays; several open "Play with…" when the user pressed play,
   and the first plays when the queue moves on by itself.
3. "Always play this with this match" saves the choice (`playback_resolutions`), so the item plays
   straight away next time; "Play with…" in the bar or Now playing changes it.

`playQueue(requests, index, context)`, `enqueue(requests, next)`, `playAt`, `toggle`, `next`,
`previous`, `seek`, `seekBy`, `setVolume`, `toggleMute`, `toggleShuffle` and `cycleRepeat` drive it.

## Where the player is

Each service's player surface (YouTube's iframe) is mounted **once**, into a fixed layer, and laid
over a slot: the service dock at the bottom of the desktop menu, or Now playing's stage while that
is open. It never moves in the DOM, which would reload the iframe and stop the music. Now playing is
always mounted and shown with `visibility` (and `inert`), never by mounting it, for the same reason.

On phones there is no dock: the bar is a mini player, tapping it opens Now playing, and the service's
player shows on its stage. With Now playing closed it stays hidden (`visibility: hidden`), playing on.

## Accounts and sessions

A service that signs in implements `auth`. Its sessions are `external_service_accounts` rows
(spacify type `external_service_account`, private to their owner, never shared with a workspace):
`service_id`, `name`, `external_id`, `image_url`, `status` (`signed_in`/`signed_out`, one signed-in
account per service), `signed_in_at`, `signed_out_at` and `has_secret`. A token or API key goes
through `set_external_service_account_secret(p_account_id, p_secret)` into
`external_service_account_secrets`, which only edge functions read with the service role. The Music
services page signs services in and out (`/music-services/<service>/sign-in`) and lists the accounts
(`/music-services/accounts/new`, `/music-services/accounts/<key>/edit`).

The host's database needs these tables, `playback_resolutions` (`user_id`, `request_key`,
`service_id`, `candidate_uri`, `title`, `artist`, `by_isrc`; unique per user and key) and, for
playlists, `musik:` allowed in `playlist_items.uri`.

## Shortcuts

Like Spotify's web player: Space plays or pauses, Alt+Shift+→/← next and previous, Shift+→/← seeks
5 s, Alt+Shift+↑/↓ volume, Alt+Shift+M mutes, Alt+S shuffle, Alt+R repeat, Alt+Shift+R opens Now
playing and Alt+Shift+P "Play with…". They are palette actions, listed in the shortcuts help (`?`).
