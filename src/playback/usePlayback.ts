import { useSyncExternalStore } from "react";
import { playback, type PlaybackSnapshot } from "./coordinator";

/** The playback coordinator's state, re-rendering on every change. */
export function usePlayback(): PlaybackSnapshot {
  return useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
}

/** One part of the state (re-renders only when it changes). */
export function usePlaybackSelector<T>(select: (snapshot: PlaybackSnapshot) => T): T {
  return useSyncExternalStore(
    playback.subscribe,
    () => select(playback.getSnapshot()),
    () => select(playback.getSnapshot()),
  );
}

/** "3:05" from milliseconds. */
export function formatPlaybackTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
