/**
 * View switching: when the user moves to another page, the new page renders at once. Data any of
 * its queries already has (from earlier in this visit, or from an earlier visit through the
 * persisted cache in queryCache.ts) shows straight away and refreshes in the background, and what
 * was never loaded on this device is drawn as skeletons (src/shell/Skeleton.tsx) until it arrives.
 * A thin bar along the top shows that something is still on its way.
 *
 * NavigationProgress starts the bar from the router's onBeforeNavigate event and decides when the
 * new page is done. Opening or closing a routed sheet (/suppliers → /suppliers/new → /suppliers)
 * and search-only changes (the date range) don't start it: the sheet is the feedback.
 */

export type NavigationPhase = "idle" | "loading";

let phase: NavigationPhase = "idle";
const listeners = new Set<() => void>();

function setPhase(next: NavigationPhase) {
  if (phase === next) return;
  phase = next;
  listeners.forEach((listener) => listener());
}

export function subscribeNavigationPhase(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNavigationPhase() {
  return phase;
}

/**
 * Kept for callers from when the page being left was held on screen and revealed through a view
 * transition. The router now wraps navigations in view transitions itself (`defaultViewTransition`,
 * set by the user theme), so there is nothing left to do here.
 */
export function setNavigationViewTransitions(_enabled: boolean) {}

const SHEET_PATH = /\/(new|edit)$/;

/** Opening a routed sheet over the current page, switching sheets, or closing one back to it. */
export function isSheetNavigation(from: string, to: string) {
  if (SHEET_PATH.test(to)) return true;
  return SHEET_PATH.test(from) && to !== "/" && from.startsWith(`${to}/`);
}

export function beginNavigation(from: string, to: string) {
  if (from === to || isSheetNavigation(from, to)) return;
  setPhase("loading");
}

export function finishNavigation() {
  setPhase("idle");
}
