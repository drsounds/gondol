/**
 * Menus that fade (the `menuFade` preference, desktop only): every `[role="menu"]` fades in with
 * `@starting-style` (styles/base.css), and closes like Windows 2000 did. The menu fades out first,
 * while the item that was picked keeps its highlight for half a second and then fades too.
 *
 * Menus are unmounted by whoever owns them (ActionMenu, the account menu, …), so closing is done
 * here, for all of them at once: while a menu is open its box and the item under the pointer or
 * the keyboard are measured, and when it leaves the DOM a copy of it is laid over the same spot and
 * faded out (`.menu-fade-ghost`). The copy is inert and gone after the animation.
 */

/** Desktop only: a mouse (or trackpad) that can hover. */
const DESKTOP_QUERY = "(hover: hover) and (pointer: fine)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** How long the picked item's highlight stays after the menu has gone, then its own fade. */
const SELECTION_DELAY_MS = 500;
const FADE_MS = 200;

interface MenuSnapshot {
  rect: DOMRect;
  style: Partial<Record<(typeof COPIED_STYLES)[number], string>>;
  /** The item last pressed, hovered or focused, by its index among the menu's items. */
  chosen: { index: number; background: string; color: string } | null;
  /** True once an item was activated (clicked or Enter/Space); else the menu was dismissed. */
  picked: boolean;
}

// The menu's own box, copied inline so the copy looks the same outside the menu's ancestors.
const COPIED_STYLES = [
  "background-color",
  "background-image",
  "border",
  "border-radius",
  "box-shadow",
  "color",
  "font-family",
  "font-size",
  "padding",
  "display",
  "flex-direction",
  "gap",
  "backdrop-filter",
] as const;

function isMenu(node: Element): boolean {
  return node instanceof HTMLElement && node.getAttribute("role") === "menu" && !node.classList.contains("menu-fade-ghost");
}

function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
}

/** Starts the fades; returns the function that stops them. */
export function installMenuFade(): () => void {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const desktop = window.matchMedia(DESKTOP_QUERY);
  const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
  const snapshots = new WeakMap<HTMLElement, MenuSnapshot>();
  const ghosts = new Set<HTMLElement>();

  const measure = (menu: HTMLElement, item?: HTMLElement | null, picked = false) => {
    if (!menu.isConnected) return;
    const rect = menu.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const computed = getComputedStyle(menu);
    // Still invisible while its owner measures where it fits.
    if (computed.visibility === "hidden") return;
    const previous = snapshots.get(menu);
    const style: MenuSnapshot["style"] = {};
    for (const key of COPIED_STYLES) style[key] = computed.getPropertyValue(key);
    let chosen = previous?.chosen ?? null;
    if (item && menu.contains(item)) {
      const index = menuItems(menu).indexOf(item);
      if (index >= 0) {
        const itemStyle = getComputedStyle(item);
        chosen = { index, background: itemStyle.backgroundColor, color: itemStyle.color };
      }
    }
    snapshots.set(menu, { rect, style, chosen, picked: picked || !!previous?.picked });
  };

  const itemOf = (target: EventTarget | null): { menu: HTMLElement; item: HTMLElement } | null => {
    if (!(target instanceof Element)) return null;
    const item = target.closest<HTMLElement>('[role^="menuitem"]');
    const menu = item?.closest<HTMLElement>('[role="menu"]');
    return item && menu && isMenu(menu) ? { menu, item } : null;
  };

  // The item under the pointer is highlighted (hover) right now, so its colours are the ones to keep.
  const onPointer = (event: PointerEvent) => {
    const hit = itemOf(event.target);
    if (hit) measure(hit.menu, hit.item, event.type === "pointerdown");
  };
  const onClick = (event: MouseEvent) => {
    const hit = itemOf(event.target);
    if (hit) measure(hit.menu, hit.item, true);
  };
  const onFocus = (event: FocusEvent) => {
    const hit = itemOf(event.target);
    if (hit) requestAnimationFrame(() => measure(hit.menu, hit.item));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const hit = itemOf(document.activeElement);
    if (hit) measure(hit.menu, hit.item, true);
  };

  const fadeOut = (menu: HTMLElement) => {
    const snapshot = snapshots.get(menu);
    snapshots.delete(menu);
    if (!snapshot || !desktop.matches || reducedMotion.matches) return;
    const ghost = menu.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("id");
    ghost.removeAttribute("role");
    ghost.classList.add("menu-fade-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    for (const [key, value] of Object.entries(snapshot.style)) if (value) ghost.style.setProperty(key, value);
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${snapshot.rect.left}px`,
      top: `${snapshot.rect.top}px`,
      width: `${snapshot.rect.width}px`,
      height: `${snapshot.rect.height}px`,
      margin: "0",
      boxSizing: "border-box",
      visibility: "visible",
      zIndex: "2147483000",
      pointerEvents: "none",
      overflow: "hidden",
      transform: "none",
    });
    ghost.style.setProperty("--menu-fade-ms", `${FADE_MS}ms`);
    ghost.style.setProperty("--menu-fade-selection-delay", `${SELECTION_DELAY_MS}ms`);
    // Only a picked item lingers: a menu closed with Escape or a click outside just fades.
    const chosen = snapshot.picked && snapshot.chosen ? menuItems(ghost)[snapshot.chosen.index] : undefined;
    if (chosen && snapshot.chosen) {
      chosen.setAttribute("data-menu-fade-chosen", "");
      chosen.style.backgroundColor = snapshot.chosen.background;
      chosen.style.color = snapshot.chosen.color;
      // Its ancestors inside the menu stay, so it isn't faded out with them.
      for (let el = chosen.parentElement; el && el !== ghost; el = el.parentElement) el.setAttribute("data-menu-fade-holds", "");
    }
    document.body.appendChild(ghost);
    ghosts.add(ghost);
    const remove = () => {
      ghost.remove();
      ghosts.delete(ghost);
    };
    setTimeout(remove, (chosen ? SELECTION_DELAY_MS : 0) + FADE_MS + 100);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const menus = isMenu(node) ? [node] : Array.from(node.querySelectorAll<HTMLElement>('[role="menu"]')).filter((menu) => isMenu(menu));
        // Measured once laid out (and positioned by its owner); again on every pointer move.
        menus.forEach((menu) => requestAnimationFrame(() => requestAnimationFrame(() => measure(menu))));
      });
      record.removedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement) || node.classList.contains("menu-fade-ghost")) return;
        if (isMenu(node)) fadeOut(node);
        else node.querySelectorAll<HTMLElement>('[role="menu"]').forEach((menu) => isMenu(menu) && fadeOut(menu));
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("pointerover", onPointer, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("focusin", onFocus, true);
  document.addEventListener("keydown", onKeyDown, true);

  return () => {
    observer.disconnect();
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("pointerover", onPointer, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("focusin", onFocus, true);
    document.removeEventListener("keydown", onKeyDown, true);
    ghosts.forEach((ghost) => ghost.remove());
    ghosts.clear();
  };
}
