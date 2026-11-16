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
export const playerApp = defineApp({
  manifest,
  pages: {
    "music-services": () => import("./features/music-services/src/pages/MusicServicesPage").then((m) => m.MusicServicesPage),
  },
  actions: {
    "player.toggle": () => {
      if (playback.getSnapshot().queue.length) playback.toggle();
    },
    "player.next": () => playback.next(),
    "player.previous": () => playback.previous(),
    "player.seekForward": () => playback.seekBy(5000),
    "player.seekBack": () => playback.seekBy(-5000),
    "player.volumeUp": () => playback.setVolume(playback.getSnapshot().volume + 0.1),
    "player.volumeDown": () => playback.setVolume(playback.getSnapshot().volume - 0.1),
    "player.mute": () => playback.toggleMute(),
    "player.shuffle": () => playback.toggleShuffle(),
    "player.repeat": () => playback.cycleRepeat(),
    "player.nowPlaying": () => {
      if (playback.getSnapshot().queue.length) toggleNowPlaying();
    },
    "player.playWith": () => void playback.playWith(),
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
