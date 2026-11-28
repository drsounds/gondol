/**
 * Staggered transitions (the `staggeredTransitions` preference, `data-staggered-entries`): a view's
 * components, entries and list or grid rows come in one after another (styles/base.css, keyed off
 * the `STAGGER_ITEMS` below), and go out the same way:
 *
 * - leaving a view, a copy of it is laid over the content area and its parts fade out one by one
 *   while the new view waits (`--stagger-base`) and then comes in;
 * - rows that leave a list or grid while it stays (a delete, a filter) are put back for a moment as
 *   inert copies that fade out (`.stagger-leaving`); rows that arrive animate in by themselves.
 *
 * Phones get it too. Nothing moves under prefers-reduced-motion.
 */

/** The parts that stagger: mirrors the selectors in styles/base.css. */
export const STAGGER_ITEMS = [
  ".panel-head",
  ".stack > *",
  ".data-table tbody > tr",
  ".library-list > *",
  ".media-grid > *",
  ".hub-grid > *",
  ".play-grid > *",
  ".collection-grid > *",
  ".browse-grid > *",
  ".channel-grid > *",
  ".stat-grid > *",
  "[data-stagger] > *",
].join(", ");

/** Lists and grids whose rows are seen leaving (not every `.stack`: forms toggle fields all the time). */
const LEAVING_PARENTS = [
  ".data-table tbody",
  ".library-list",
  ".media-grid",
  ".hub-grid",
  ".play-grid",
  ".collection-grid",
  ".browse-grid",
  ".channel-grid",
].join(", ");

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** One part's fade, and the gap before the next one starts. */
const ITEM_MS = 160;
const STEP_MS = 30;
/** At most this many parts go out one by one; the rest go with the last. */
const MAX_STEPS = 8;
/** A list that loses more rows than this at once was replaced, not edited: no copies. */
const MAX_LEAVING_ROWS = 24;
const LEAVE_MS = ITEM_MS + STEP_MS * MAX_STEPS;

type Navigation = { fromPath: string; toPath: string };

/** A sheet opening over its list (`/x` → `/x/new`) or closing back to it keeps the view. */
function sameView({ fromPath, toPath }: Navigation): boolean {
  const trim = (path: string) => path.replace(/\/+$/, "") || "/";
  const from = trim(fromPath);
  const to = trim(toPath);
  if (from === to) return true;
  return to.startsWith(`${from}/`) || from.startsWith(`${to}/`);
}

function inViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0 && rect.height > 0;
}

/**
 * Starts the transitions; `subscribeNavigation` is called with a handler for each navigation,
 * while the old view is still in the DOM. Returns the function that stops them.
 */
export function installStaggeredTransitions(subscribeNavigation: (handler: (navigation: Navigation) => void) => () => void): () => void {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
  const root = document.documentElement;
  let leavingUntil = 0;
  let baseTimer: ReturnType<typeof setTimeout> | undefined;
  const ghosts = new Set<HTMLElement>();

  const track = (ghost: HTMLElement, ms: number) => {
    ghosts.add(ghost);
    setTimeout(() => {
      ghost.remove();
      ghosts.delete(ghost);
    }, ms + 60);
  };

  const leaveView = (navigation: Navigation) => {
    if (reducedMotion.matches || sameView(navigation)) return;
    const content = document.getElementById("app-content");
    if (!content || !content.firstElementChild) return;
    const rect = content.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Number the visible parts in reading order before copying, so the copy can find them.
    const parts = Array.from(content.querySelectorAll<HTMLElement>(STAGGER_ITEMS)).filter(inViewport);
    parts.forEach((part, index) => part.setAttribute("data-stagger-out", String(Math.min(index, MAX_STEPS))));
    const ghost = content.cloneNode(true) as HTMLElement;
    parts.forEach((part) => part.removeAttribute("data-stagger-out"));
    ghost.removeAttribute("id");
    ghost.removeAttribute("data-region");
    ghost.removeAttribute("tabindex");
    ghost.classList.add("stagger-view-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    // The page's own background, so the new view doesn't show through until the old one is gone.
    let background = "";
    for (let el: HTMLElement | null = content; el && !background; el = el.parentElement) {
      const color = getComputedStyle(el).backgroundColor;
      if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) background = color;
    }
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      // Its styles may come from the id it no longer has.
      padding: getComputedStyle(content).padding,
      boxSizing: "border-box",
      overflow: "hidden",
      zIndex: "50",
      pointerEvents: "none",
      background: background || "var(--bungalow-color-canvas)",
    });
    ghost.style.setProperty("--stagger-leave-ms", `${LEAVE_MS}ms`);
    document.body.appendChild(ghost);
    ghost.scrollTop = content.scrollTop;
    ghost.scrollLeft = content.scrollLeft;
    track(ghost, LEAVE_MS);
    // The new view's parts start once the old ones are out.
    leavingUntil = Date.now() + LEAVE_MS;
    root.style.setProperty("--stagger-base", `${LEAVE_MS - ITEM_MS / 2}ms`);
    if (baseTimer) clearTimeout(baseTimer);
    baseTimer = setTimeout(() => root.style.removeProperty("--stagger-base"), LEAVE_MS);
  };

  const observer = new MutationObserver((records) => {
    if (reducedMotion.matches || Date.now() < leavingUntil) return;
    const leaving: { node: HTMLElement; parent: Node; before: Node | null }[] = [];
    for (const record of records) {
      record.removedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement) || node.classList.contains("stagger-leaving")) return;
        const parent = record.target;
        if (!(parent instanceof HTMLElement) || !parent.isConnected || !parent.closest("#app-content")) return;
        if (parent.closest(".skeleton-group, .stagger-view-ghost")) return;
        if (!parent.matches(LEAVING_PARENTS) || (parent.tagName === "TBODY" && node.tagName !== "TR")) return;
        if (node.classList.contains("skeleton") || node.querySelector(".skeleton")) return;
        const before = record.nextSibling && record.nextSibling.parentNode === parent ? record.nextSibling : null;
        leaving.push({ node, parent, before });
      });
    }
    if (leaving.length === 0 || leaving.length > MAX_LEAVING_ROWS) return;
    leaving.forEach(({ node, parent, before }, index) => {
      const ghost = node.cloneNode(true) as HTMLElement;
      ghost.classList.add("stagger-leaving");
      ghost.removeAttribute("id");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.draggable = false;
      const step = Math.min(index, MAX_STEPS);
      ghost.style.setProperty("--stagger-i", String(step));
      parent.insertBefore(ghost, before);
      track(ghost, ITEM_MS + STEP_MS * step);
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = subscribeNavigation(leaveView);

  return () => {
    observer.disconnect();
    unsubscribe();
    if (baseTimer) clearTimeout(baseTimer);
    root.style.removeProperty("--stagger-base");
    ghosts.forEach((ghost) => ghost.remove());
    ghosts.clear();
  };
}
