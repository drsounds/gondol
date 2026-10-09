import { isDesktopApp } from "./desktopApp";

/** Registers public/sw.js. Production-only: in dev, a cached service worker
 * would otherwise serve stale hashed assets across HMR reloads. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // The desktop app's bundled build already has every asset locally (and sp:// can't host one).
  if (isDesktopApp()) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  });
}
