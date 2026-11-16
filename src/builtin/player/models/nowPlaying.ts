import { useSyncExternalStore } from "react";

/**
 * Whether Now playing (the full-screen player) is open. It is always mounted (so a service's player
 * inside it, YouTube's, keeps playing) and only shown or hidden, through this state.
 */
let open = false;
const listeners = new Set<() => void>();

export function setNowPlayingOpen(next: boolean) {
  if (next === open) return;
  open = next;
  listeners.forEach((l) => l());
}

export function toggleNowPlaying() {
  setNowPlayingOpen(!open);
}

export function useNowPlayingOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => open,
    () => false,
  );
}
