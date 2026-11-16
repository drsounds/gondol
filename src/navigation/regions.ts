import { useEffect, type RefObject } from "react";

/**
 * Landmark regions for keyboard browsing: F6 (and Shift+F6) move focus between the parts of the
 * shell marked `data-region` (the header, the menu, Your Library, the content, the service dock,
 * the player), in document order, skipping those that aren't on screen. Focus lands on the
 * region's current item (its `[aria-current]`/`[aria-selected]`/`[tabindex="0"]` row) when it
 * has one, else its first focusable element, else the region itself.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Whether `element` takes part in keyboard browsing now (on screen, not inert). */
export function isTabbable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest("[inert], [aria-hidden='true']")) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return getComputedStyle(element).visibility !== "hidden";
}

/** The first focusable element in `root` (its current item first). */
export function firstFocusable(root: HTMLElement): HTMLElement | null {
  const current = root.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"][tabindex], [data-cursor="true"]');
  if (current && isTabbable(current)) return current;
  return [...root.querySelectorAll(FOCUSABLE)].find(isTabbable) ?? null;
}

export function useRegionKeys(frame: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F6" || event.altKey || event.ctrlKey || event.metaKey) return;
      const root = frame.current;
      if (!root) return;
      const regions = [...root.querySelectorAll<HTMLElement>("[data-region]")].filter((region) => isTabbable(region) && (firstFocusable(region) || region.hasAttribute("tabindex")));
      if (regions.length === 0) return;
      event.preventDefault();
      const active = document.activeElement;
      const here = regions.findIndex((region) => active instanceof Node && region.contains(active));
      const at = here < 0 ? (event.shiftKey ? regions.length - 1 : 0) : (here + (event.shiftKey ? -1 : 1) + regions.length) % regions.length;
      const next = regions[at];
      // The content takes focus itself (it has tabindex -1), so reading starts at the top of the view.
      const target = next.tabIndex === -1 && next.hasAttribute("tabindex") ? next : (firstFocusable(next) ?? next);
      if (target === next && !next.hasAttribute("tabindex")) next.tabIndex = -1;
      target.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frame]);
}
