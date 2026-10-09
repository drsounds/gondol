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

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
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
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: still applies to this page.
  }
  apply(enabled);
  window.dispatchEvent(new Event(changeEvent()));
}

export function useBrowserDeveloperMode(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const sync = () => setEnabled(readStored());
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
    apply(readStored());
  }

  const onStorage = (event: StorageEvent) => {
    if (!desktop && event.key === STORAGE_KEY) apply(readStored());
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
