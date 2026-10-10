import { useEffect, useState } from "react";
import { getAppSource, isDesktopApp } from "./desktopApp";
import { namespaced } from "./storage";

/**
 * Developer mode: outside it the app behaves like a native app, so the browser's own right-click
 * menu and text selection only work in text fields (and code blocks); see "Native menu and text
 * selection" in src/styles.css. The app's own context menus (ActionMenu) work either way.
 *
 * In the desktop app (Tauri or Electron) this is its own developer mode (Account → Developer mode,
 * or the Developer menu); in a browser it is a per-device switch in Account, kept in localStorage.
 */
const STORAGE_KEY = "cashflow-developer-mode";
const ATTRIBUTE = "data-developer-mode";
const changeEvent = () => namespaced("developer-mode");

/** Where the native menu and selection stay available outside developer mode. */
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false']), pre, code";

/** The browser's own pick: true, false, or null when it has none (the site's default applies). */
function readStoredPick(): boolean | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "1" ? true : stored === "0" ? false : null;
  } catch {
    return null;
  }
}

/** What the site served here sets (SiteProvider): a default, or with `locked` the only choice. */
let site: { value: boolean | undefined; locked: boolean } = { value: undefined, locked: false };

/** In a browser: a locked site value, else this device's pick, else the site's default, else off. */
function readEffective(): boolean {
  if (site.locked && site.value !== undefined) return site.value;
  return readStoredPick() ?? site.value ?? false;
}

function apply(enabled: boolean) {
  document.documentElement.toggleAttribute(ATTRIBUTE, enabled);
}

export function isDeveloperMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(ATTRIBUTE);
}

/** The browser's switch (the desktop app saves its own through setDeveloperMode). */
export function setBrowserDeveloperMode(enabled: boolean) {
  try {
    // Off is stored too, so it wins over a site that turns developer mode on by default.
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Storage blocked: still applies to this page.
  }
  apply(readEffective());
  window.dispatchEvent(new Event(changeEvent()));
}

/** Called by SiteProvider with the site's developerMode preference (sites/preferences.ts). */
export function setSiteDeveloperMode(value: boolean | undefined, locked: boolean) {
  site = { value, locked };
  if (typeof document === "undefined" || isDesktopApp()) return;
  apply(readEffective());
  window.dispatchEvent(new Event(changeEvent()));
}

/** The browser's developer mode in effect (with the site's default or lock) and its setter. */
export function useBrowserDeveloperMode(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const sync = () => setEnabled(readEffective());
    sync();
    window.addEventListener(changeEvent(), sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(changeEvent(), sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [enabled, setBrowserDeveloperMode];
}

/** Applies developer mode and blocks the native context menu outside it. Returns a cleanup. */
export function installDeveloperMode(): () => void {
  const desktop = isDesktopApp();
  if (desktop) {
    // Changing it in the desktop app reloads the window, so reading it once is enough.
    getAppSource()
      .then((info) => apply(info.developerMode))
      .catch((error) => console.error("Could not read developer mode", error));
  } else {
    apply(readEffective());
  }

  const onStorage = (event: StorageEvent) => {
    if (!desktop && event.key === STORAGE_KEY) apply(readEffective());
  };
  // Bubble phase on window: the app's own menus (ActionMenu) have already handled the event.
  const onContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented || isDeveloperMode()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(EDITABLE)) return;
    event.preventDefault();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("contextmenu", onContextMenu);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("contextmenu", onContextMenu);
  };
}
