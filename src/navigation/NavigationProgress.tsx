import { useEffect, useState, useSyncExternalStore } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { beginNavigation, finishNavigation, getNavigationPhase, subscribeNavigationPhase } from "./navigationProgress";

/** Finish the bar after this long, whatever is still loading. */
const MAX_LOADING_MS = 10000;
/** Queries that have nothing to show yet; a background refetch of cached data doesn't count. */
const isPendingQuery = { predicate: (query: { state: { status: string } }) => query.state.status === "pending" };
/** The bar only shows when the new page takes longer than this; cached pages finish well before. */
const SHOW_AFTER_MS = 150;

/**
 * The thin loading bar along the top while a page the user moved to is still waiting for data it
 * has never had (navigationProgress.ts). The page itself is already on screen, cached data and
 * skeletons included.
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
    let interval: ReturnType<typeof setInterval> | undefined;
    const show = setTimeout(() => {
      setVisible(true);
      setProgress((p) => (p > 0 && p < 1 ? p : 0.08));
      interval = setInterval(() => setProgress((p) => p + (0.9 - p) * 0.08), 200);
    }, SHOW_AFTER_MS);
    return () => {
      clearTimeout(show);
      if (interval) clearInterval(interval);
    };
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

  // The new page is done once its route has rendered and no query has been waiting for its first
  // data for two frames (so queries that only start once another one's data is in get the chance to).
  useEffect(() => {
    if (phase !== "loading" || routeLoading || pending > 0) return;
    let cancelled = false;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!cancelled) finishNavigation();
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
