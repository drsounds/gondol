/**
 * View switching: when the user moves to another page, the current page stays on screen, with a thin
 * progress bar along the top, until the new page's data has loaded. Then the new page is shown in
 * one go, so navigating never empties the screen or shows a half-loaded page.
 *
 * React has already swapped the content by then, so what stays on screen is a frozen copy of
 * `.app-main` (taken in holdScreen() just before React renders the new location), laid over the real
 * one while that is hidden (`html[data-nav="hold"]` in styles.css). NavigationProgress starts this
 * from the router's onBeforeNavigate event and decides when the new page is done.
 *
 * Opening or closing a routed sheet (/suppliers → /suppliers/new → /suppliers) and search-only
 * changes (the date range) keep the page live: the sheet is the feedback.
 */

export type NavigationPhase = "idle" | "loading";

/** How long the frozen copy takes to fade into the new page. */
const REVEAL_MS = 120;

let phase: NavigationPhase = "idle";
let viewTransitions = false;
let holdLayer: HTMLElement | null = null;
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

/** When the user's view transitions are on, the new page is revealed through one. */
export function setNavigationViewTransitions(enabled: boolean) {
  viewTransitions = enabled;
}

const SHEET_PATH = /\/(new|edit)$/;

/** Opening a routed sheet over the current page, switching sheets, or closing one back to it. */
export function isSheetNavigation(from: string, to: string) {
  if (SHEET_PATH.test(to)) return true;
  return SHEET_PATH.test(from) && to !== "/" && from.startsWith(`${to}/`);
}

export function beginNavigation(from: string, to: string) {
  if (from === to || isSheetNavigation(from, to)) return;
  holdScreen();
  setPhase("loading");
}

export function finishNavigation() {
  releaseScreen();
  setPhase("idle");
}

/** A static copy of `source`: same markup, scroll position, form values and canvas pixels. */
function frozenCopy(source: HTMLElement) {
  const copy = source.cloneNode(true) as HTMLElement;

  const pairs = <T extends Element>(selector: string) => {
    const from = source.querySelectorAll<T>(selector);
    const to = copy.querySelectorAll<T>(selector);
    return Array.from(to, (el, i) => [from[i], el] as const);
  };

  for (const [from, to] of pairs<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")) {
    if (from instanceof HTMLInputElement && (from.type === "checkbox" || from.type === "radio")) {
      (to as HTMLInputElement).checked = from.checked;
    } else if (!(from instanceof HTMLInputElement && from.type === "file")) {
      to.value = from.value;
    }
  }
  for (const [from, to] of pairs<HTMLCanvasElement>("canvas")) {
    try {
      to.getContext("2d")?.drawImage(from, 0, 0);
    } catch {
      // A tainted or WebGL canvas just stays blank in the copy.
    }
  }
  // A copied frame or player would load (and play) all over again: keep an empty box of its size.
  for (const [from, to] of pairs<HTMLElement>("iframe, video, audio, object, embed")) {
    const { width, height } = from.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = from.className;
    box.style.cssText = from.style.cssText;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    to.replaceWith(box);
  }
  return copy;
}

function holdScreen() {
  // Already holding (a second click before the first page loaded): keep showing the page the user left.
  if (holdLayer || typeof document === "undefined") return;
  const main = document.querySelector<HTMLElement>(".app-main");
  if (!main) return;

  const layer = document.createElement("div");
  layer.className = "nav-hold";
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;

  // Empty copies of the ancestors (display: contents, so they add no boxes) keep the selectors and
  // inherited theme tokens that style the content.
  let parent: HTMLElement = layer;
  const ancestors: HTMLElement[] = [];
  for (let el = main.parentElement; el && el !== document.body; el = el.parentElement) ancestors.unshift(el);
  for (const ancestor of ancestors) {
    const shell = ancestor.cloneNode(false) as HTMLElement;
    shell.removeAttribute("id");
    shell.style.display = "contents";
    parent.appendChild(shell);
    parent = shell;
  }

  const copy = frozenCopy(main);
  copy.style.height = "100%";
  parent.appendChild(copy);

  const rect = main.getBoundingClientRect();
  Object.assign(layer.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  document.body.appendChild(layer);
  copy.scrollTop = main.scrollTop;
  copy.scrollLeft = main.scrollLeft;

  holdLayer = layer;
  document.documentElement.setAttribute("data-nav", "hold");
}

function releaseScreen() {
  const layer = holdLayer;
  if (!layer) return;
  holdLayer = null;

  const root = document.documentElement;
  if (viewTransitions && typeof document.startViewTransition === "function") {
    document.startViewTransition(() => {
      layer.remove();
      root.removeAttribute("data-nav");
    });
    return;
  }
  // Show the new page underneath, then fade the copy away over it.
  root.removeAttribute("data-nav");
  layer.classList.add("nav-hold--leaving");
  setTimeout(() => layer.remove(), REVEAL_MS);
}
