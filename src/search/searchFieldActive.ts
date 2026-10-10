import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether a search field (the chrome bar's or /search's own) has been activated: focused, until the
 * user presses Escape or points anywhere outside the field, the recent searches and their menus.
 * /search lists recent searches only while it is, and its query is empty, like Spotify.
 */
let active = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (active === next) return;
  active = next;
  listeners.forEach((listener) => listener());
}

/** Spread on a search field's <input>. */
export const searchFieldProps = {
  "data-search-field": "",
  onFocus: () => set(true),
  onKeyDown: (event: { key: string }) => {
    if (event.key === "Escape") set(false);
  },
} as const;

/** Elements that keep the field active when pointed at: the field, the recents and their menus. */
const KEEPS_ACTIVE = "[data-search-field], [data-search-recent], [role='menu']";

export function useSearchFieldActive(): boolean {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => active,
    () => false,
  );
  useEffect(() => {
    if (!value) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.(KEEPS_ACTIVE)) set(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [value]);
  return value;
}

/** Ends the active state, e.g. after a recent search was opened. */
export function deactivateSearchField(): void {
  set(false);
}
