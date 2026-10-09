import { useEffect, useState, useSyncExternalStore } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { beginNavigation, finishNavigation, getNavigationPhase, subscribeNavigationPhase } from "./navigationProgress";

/** Give up waiting (show the new page as it is and finish the bar) after this long. */
const MAX_LOADING_MS = 10000;
/** How long to wait for the new page's images before showing it anyway. */
const MAX_IMAGE_WAIT_MS = 3000;

/** Queries that have nothing to show yet; a background refetch of cached data doesn't count. */
const isPendingQuery = { predicate: (query: { state: { status: string } }) => query.state.status === "pending" };

/** Resolves once the new page's (non-lazy) images have loaded or failed, or after MAX_IMAGE_WAIT_MS. */
function imagesLoaded() {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>(".app-main img")).filter(
    (img) => !img.closest(".nav-hold") && img.loading !== "lazy" && !img.complete,
  );
  if (images.length === 0) return Promise.resolve();
  const loads = images.map((img) => new Promise<void>((resolve) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true });
  }));
  return Promise.race([Promise.all(loads), new Promise<void>((resolve) => setTimeout(resolve, MAX_IMAGE_WAIT_MS))]);
}

/**
 * Keeps the current page on screen while the next one loads (src/lib/navigationProgress.ts), with a
 * thin loading bar along the top in the meantime.
 */
export function NavigationProgress() {
  const router = useRouter();
  const phase = useSyncExternalStore(subscribeNavigationPhase, getNavigationPhase, () => "idle" as const);
  const pending = useIsFetching(isPendingQuery);
  const routeLoading = useRouterState({ select: (s) => s.isLoading });
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const active = phase !== "idle";

  // Fires after the router has set the new location but before React renders it, so the page the
  // user is leaving is still in the DOM to be held.
  useEffect(
    () =>
      router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
        if (fromLocation) beginNavigation(fromLocation.pathname, toLocation.pathname);
      }),
    [router],
  );

  // Start the bar and trickle it towards (never quite reaching) the end while active.
  useEffect(() => {
    if (!active) return;
    setVisible(true);
    setProgress((p) => (p > 0 && p < 1 ? p : 0.08));
    const interval = setInterval(() => setProgress((p) => p + (0.9 - p) * 0.08), 200);
    return () => clearInterval(interval);
  }, [active]);

  // Complete the bar, then fade it away.
  useEffect(() => {
    if (active || !visible) return;
    setProgress(1);
    const hide = setTimeout(() => setVisible(false), 250);
    const reset = setTimeout(() => setProgress(0), 600);
    return () => {
      clearTimeout(hide);
      clearTimeout(reset);
    };
  }, [active, visible]);

  useEffect(() => {
    if (phase !== "loading") return;
    const giveUp = setTimeout(finishNavigation, MAX_LOADING_MS);
    return () => clearTimeout(giveUp);
  }, [phase]);

  // The new page is done once its route has rendered, no query has been waiting for its first data
  // for two frames (so queries that only start once another one's data is in get the chance to),
  // and its images are in.
  useEffect(() => {
    if (phase !== "loading" || routeLoading || pending > 0) return;
    let cancelled = false;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        void imagesLoaded().then(() => {
          if (!cancelled) finishNavigation();
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [phase, routeLoading, pending]);

  return (
    <div className={["nav-progress", visible ? "nav-progress--visible" : null].filter(Boolean).join(" ")} aria-hidden="true">
      <div className="nav-progress__bar" style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
