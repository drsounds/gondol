import { defineApp, lazyWidget } from "../../apps/defineApp";
import { playback } from "../../playback/coordinator";
import { ServiceSurfaceLayer } from "../../playback/surfaces";
import manifest from "./manifest.json";
import { PlaybackHost } from "./components/PlaybackHost";
import { toggleNowPlaying } from "./models/nowPlaying";

/**
 * The player app, built into gondol: Bungalow's multi-service playback. It plays musik: URIs, links
 * and entities (playbackHostHook) through the services other apps bring (the yt-music-service app's
 * YouTube, any app's manifest `services`), resolving each item at play time and asking "Play with…"
 * the first time (playback/coordinator.ts). Its widgets: the player bar (bottom), Now playing (the
 * full-screen player, always mounted and shown with visibility), the service dock at the bottom of
 * the desktop menu where the active service's player runs, and the layer that keeps every
 * service's player mounted. `/music-services` lists the services and the accounts they're signed
 * in with (`external_service_accounts`); `playback_resolutions` keeps the "always" choices.
 *
 * Switch it on like the others: `configureGondol({ apps: [...apps, playerApp, ytMusicServiceApp] })`.
 * Its tables are in docs/guide/playback.md.
 */
const hasQueue = () => playback.getSnapshot().queue.length > 0;

export const playerApp = defineApp({
  manifest,
  pages: {
    "music-services": () => import("./features/music-services/src/pages/MusicServicesPage").then((m) => m.MusicServicesPage),
  },
  actions: {
    // While nothing is in the queue the keys stay the page's (Space scrolls, Shift+→ selects).
    "player.toggle": { perform: () => playback.toggle(), when: hasQueue },
    "player.next": { perform: () => playback.next(), when: hasQueue },
    "player.previous": { perform: () => playback.previous(), when: hasQueue },
    "player.seekForward": { perform: () => playback.seekBy(5000), when: hasQueue },
    "player.seekBack": { perform: () => playback.seekBy(-5000), when: hasQueue },
    "player.volumeUp": () => playback.setVolume(playback.getSnapshot().volume + 0.1),
    "player.volumeDown": () => playback.setVolume(playback.getSnapshot().volume - 0.1),
    "player.mute": () => playback.toggleMute(),
    "player.shuffle": () => playback.toggleShuffle(),
    "player.repeat": () => playback.cycleRepeat(),
    "player.nowPlaying": { perform: () => toggleNowPlaying(), when: hasQueue },
    "player.playWith": { perform: () => void playback.playWith(), when: hasQueue },
  },
  widgets: {
    Providers: [PlaybackHost],
    bottomWidgets: [lazyWidget(() => import("./components/PlayerBar").then((m) => m.PlayerBar))],
    sidebarBottomWidgets: [lazyWidget(() => import("./components/ServiceDock").then((m) => m.ServiceDock))],
    overlayWidgets: [
      // The layer first: the slots in Now playing and the dock find it already there.
      ServiceSurfaceLayer,
      lazyWidget(() => import("./components/NowPlayingView").then((m) => m.NowPlayingView)),
      lazyWidget(() => import("./components/PlayWithSheet").then((m) => m.PlayWithSheet)),
    ],
  },
});

export default playerApp;
