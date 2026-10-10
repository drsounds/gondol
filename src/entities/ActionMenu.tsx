import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../design-system/bungalow-79d923";
import { SavedIcon } from "../theme/savedIcon";
import { useI18n } from "../i18n/i18n";
import { copyText } from "../shell/clipboard";
import { entityExtensions, useCollectionActions } from "./extensions";
import { useDragEntity, writeEntityDrag } from "./dragEntity";
import { EntityArt } from "./EntityArt";
import { entityTypeLabel } from "./lookup";
import { parseEntityUri } from "./uri";
import { shareUri, shareUrl, useShareKey } from "./shareUri";
import { useGlobalFilterHides } from "../search/globalFilterState";
import { useSiteShows } from "../sites/sites";
import { useEntityLifecycle } from "./lifecycle";
import { showToast } from "../shell/clipboard";
import { actionCapability, useSiteOffers, type Capability } from "../sites/capabilities";

/**
 * One menu item. `roles`/`aspects` say which sites offer it (sites/capabilities.ts); untagged items
 * keyed `edit`, `delete`, `open`, … get their aspect from the key.
 */
export interface MenuAction extends Capability {
  /** Stable key; also used as the React key for the menu item. */
  key: string;
  label: ReactNode;
  onSelect: () => void;
  tone?: "danger";
  disabled?: boolean;
}

interface ActionMenuProps {
  actions: MenuAction[];
  /** Accessible name of the entity, e.g. the row's label ("More actions for {name}"). */
  name: string;
  /**
   * spacify: URI of the entity. When set, "Save to library", "Pin", "Add to playlist…", "Tags…", "Covers…",
   * "Change address…", "Copy URI" and "Copy URL" items are added automatically, and the surrounding `.action-row` becomes draggable (onto
   * playlists, the library, URI fields…).
   */
  uri?: string;
  /**
   * When true (the default) the trigger only shows while hovering/focusing its closest
   * `.action-row` ancestor, and right-clicking anywhere in that row opens the same menu at the
   * pointer. Set to false for a standalone, always-visible trigger (e.g. a sheet header).
   */
  row?: boolean;
}

/**
 * "sheet" is the touch version: a bottom sheet with a copy of the row on top, opened by pressing
 * and holding the row (or tapping a standalone trigger).
 */
type OpenState = { x: number; y: number; align: "pointer" | "trigger" | "sheet"; subtitle?: string } | null;

/** Press and hold a row this long on a touch screen to open its menu. */
const HOLD_MS = 1000;
/** A finger that moves further than this is scrolling, not holding. */
const HOLD_SLOP_PX = 10;

/** Text of the row's next two cells (a phone-width .data-table's second line), for the copy of the row on top of the sheet. */
function rowSubtitle(host: HTMLElement): string | undefined {
  const cells = Array.from(host.querySelectorAll<HTMLElement>(':scope > td[data-cell="1"], :scope > td[data-cell="2"]'))
    // Amounts carry their column header, as on the phone-width row (dataTableLabels.ts).
    .map((cell) => [cell.classList.contains("num") ? cell.dataset.label : null, cell.textContent?.trim()].filter(Boolean).join(" "))
    .filter(Boolean);
  return cells.length ? cells.join(" · ") : undefined;
}

/** Keep the click that ends a long press from also activating whatever ends up under the finger. */
function swallowNextClick(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    done();
  };
  const done = () => {
    window.removeEventListener("click", swallow, true);
    if (timer) clearTimeout(timer);
  };
  window.addEventListener("click", swallow, true);
  // Called once the finger lifts: a click, if the browser sends one, follows right away.
  return () => {
    timer = setTimeout(done, 400);
  };
}

// Only one action menu is open at a time across the whole app.
let closeOpenMenu: (() => void) | null = null;

/**
 * The single row/entity actions affordance used by every list in the app: a horizontal "⋯"
 * button that opens a dropdown, and the same dropdown as a right-click context menu on the
 * surrounding `.action-row`. See CLAUDE.md ("Row and entity actions").
 */
export function ActionMenu({ actions, name, uri, row = true }: ActionMenuProps) {
  const { t } = useI18n();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<OpenState>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // How the trigger was last pressed: a tap on a touch screen opens the sheet instead of the dropdown.
  const triggerPointerRef = useRef<string | null>(null);
  // True while a finger is held on the row, so Android's long-press contextmenu doesn't open the dropdown.
  const holdingRef = useRef(false);

  const collectionActions = useCollectionActions(uri, name);
  const like = entityExtensions().useLike(row ? uri : undefined, name);
  const lifecycle = useEntityLifecycle();
  const { setDragData } = useDragEntity();
  // The slug is looked up once the menu opens; until then the copies use the identifier.
  const shareKey = useShareKey(uri, open !== null);
  const url = uri && shareKey ? shareUrl(uri, shareKey) : null;
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const lifecycleState = lifecycle.stateFor(uri);
  // A restricted entity (e.g. quarantined) can't be shared: its copies stay in the menu, disabled.
  const noSharing = !!lifecycle.restrictionFor(uri)?.noSharing;
  const hasScheduledDeletion = !!lifecycleState?.soft_deleted_at;
  const deletionHasPassed = hasScheduledDeletion && Date.parse(lifecycleState.soft_deleted_at!) <= Date.now();
  const lifecycleActions: MenuAction[] = uri
    ? [
        {
          key: "soft-delete",
          aspects: ["delete"],
          label: deletionHasPassed
            ? t("actions.restore")
            : hasScheduledDeletion
              ? t("actions.cancelScheduledDeletion")
              : t("actions.scheduleSoftDeletion"),
          onSelect: () => {
            if (hasScheduledDeletion) {
              void lifecycle.schedule(uri, null)
                .then(() => showToast(t(deletionHasPassed ? "actions.restored" : "actions.deletionCancelled")))
                .catch(() => showToast(t("actions.lifecycleFailed")));
            } else {
              const now = new Date();
              setScheduleAt(new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
              setScheduleOpen(true);
            }
          },
        },
      ]
    : [];
  const offers = useSiteOffers();
  // Destructive items stay last, just before the automatic "Copy URI" / "Copy URL".
  const allItems: MenuAction[] = uri
    ? [
        ...actions.filter((a) => a.tone !== "danger"),
        ...collectionActions,
        ...lifecycleActions,
        ...actions.filter((a) => a.tone === "danger"),
        {
          key: "copy-uri",
          aspects: ["share"],
          label: t("actions.copyUri"),
          disabled: noSharing,
          onSelect: () => copyText(shareKey ? shareUri(uri, shareKey) : uri, t("actions.uriCopied"), t("actions.copyFailed")),
        },
        ...(url ? [{ key: "copy-url", aspects: ["share"] as const, label: t("actions.copyUrl"), disabled: noSharing, onSelect: () => copyText(url, t("actions.urlCopied"), t("actions.copyFailed")) }] : []),
      ]
    : actions;
  // What the site served here doesn't offer (its roles and aspects) is left out.
  const items = allItems.filter((item) => offers(actionCapability(item)));

  const closerRef = useRef<(() => void) | null>(null);

  const close = useCallback((restoreFocus = false) => {
    if (closeOpenMenu && closeOpenMenu === closerRef.current) closeOpenMenu = null;
    setOpen(null);
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const show = useCallback(
    (next: NonNullable<OpenState>) => {
      if (closeOpenMenu && closeOpenMenu !== closerRef.current) closeOpenMenu();
      closerRef.current = () => close();
      closeOpenMenu = closerRef.current;
      setOpen(next);
    },
    [close],
  );

  // Don't leave a dangling closer behind if the row unmounts while its menu is open.
  useEffect(() => () => {
    if (closeOpenMenu && closeOpenMenu === closerRef.current) closeOpenMenu = null;
  }, []);

  // Right-click anywhere in the surrounding row opens the menu at the pointer.
  useEffect(() => {
    if (!row) return;
    const host = triggerRef.current?.closest<HTMLElement>(".action-row");
    if (!host) return;
    const onContextMenu = (event: MouseEvent) => {
      // A nested row (e.g. a loan inside an education) already handled it.
      if (event.defaultPrevented) return;
      // Keep the native menu for text fields so copy/paste still works there.
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      // On touch screens the menu opens by holding the row (below); Android also sends a
      // contextmenu half-way through that hold, which must not open the dropdown.
      if (holdingRef.current || (event as PointerEvent).pointerType === "touch") return;
      show({ x: event.clientX, y: event.clientY, align: "pointer" });
    };
    host.addEventListener("contextmenu", onContextMenu);
    return () => host.removeEventListener("contextmenu", onContextMenu);
  }, [row, show]);

  // Touch screens have no "⋯" on rows: pressing and holding the row for HOLD_MS opens the menu
  // as a sheet.
  useEffect(() => {
    if (!row) return;
    const host = triggerRef.current?.closest<HTMLElement>(".action-row");
    if (!host) return;
    let pointerId: number | null = null;
    let origin = { x: 0, y: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasDraggable = false;
    let releaseClick: (() => void) | null = null;

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (pointerId !== null) {
        host.classList.remove("action-row--holding");
        // Native drag-and-drop would otherwise take over the long press.
        host.draggable = wasDraggable;
      }
      pointerId = null;
      holdingRef.current = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      const target = event.target as HTMLElement;
      // A nested row (e.g. a loan inside an education) handles its own hold.
      if (target.closest(".action-row") !== host) return;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      stop();
      pointerId = event.pointerId;
      origin = { x: event.clientX, y: event.clientY };
      holdingRef.current = true;
      wasDraggable = host.draggable;
      host.draggable = false;
      host.classList.add("action-row--holding");
      timer = setTimeout(() => {
        const subtitle = rowSubtitle(host);
        const at = origin;
        stop();
        releaseClick = swallowNextClick();
        navigator.vibrate?.(15);
        show({ ...at, align: "sheet", subtitle });
      }, HOLD_MS);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > HOLD_SLOP_PX) stop();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (releaseClick && event.pointerType === "touch") {
        releaseClick();
        releaseClick = null;
      }
      if (event.pointerId === pointerId) stop();
    };
    host.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      stop();
      releaseClick?.();
      host.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [row, show]);

  // Rows with a URI can be dragged onto any entity drop target.
  useEffect(() => {
    if (!row || !uri) return;
    const host = triggerRef.current?.closest<HTMLElement>(".action-row");
    if (!host) return;
    host.draggable = true;
    host.classList.add("action-row--draggable");
    const onDragStart = (event: DragEvent) => {
      // A nested row (e.g. a loan inside an education) is the one being dragged, not this one.
      if ((event.target as HTMLElement).closest?.(".action-row") !== host) return;
      writeEntityDrag(event, { uri, label: name });
      // Deferred: changing the DOM synchronously in dragstart makes Chrome abort the drag.
      setTimeout(() => setDragData({ uri, label: name }), 0);
    };
    const onDragEnd = () => setDragData(null);
    host.addEventListener("dragstart", onDragStart);
    host.addEventListener("dragend", onDragEnd);
    return () => {
      host.draggable = false;
      host.classList.remove("action-row--draggable");
      host.removeEventListener("dragstart", onDragStart);
      host.removeEventListener("dragend", onDragEnd);
    };
  }, [row, uri, name, setDragData]);

  // The global filter (src/lib/globalFilter.tsx) hides rows whose entity doesn't pass it, in
  // every view at once.
  const filteredOut = useGlobalFilterHides(row ? uri : undefined);
  // So do sites, for rows of entity types (or their apps, roles and aspects) the site leaves out.
  const siteShows = useSiteShows();
  const siteHides = !!row && !!uri && !siteShows.uri(uri);
  const lifecycleHidden = lifecycle.isHidden(uri);
  const lifecycleDimmed = lifecycle.isDimmed(uri);
  useLayoutEffect(() => {
    const host = triggerRef.current?.closest<HTMLElement>(".action-row");
    if (!host) return;
    const hidden = filteredOut || siteHides || lifecycleHidden;
    host.classList.toggle("action-row--filtered", hidden);
    host.classList.toggle("action-row--lifecycle-dimmed", lifecycleDimmed && !hidden);
    return () => {
      host.classList.remove("action-row--filtered", "action-row--lifecycle-dimmed");
    };
  }, [filteredOut, siteHides, lifecycleHidden, lifecycleDimmed]);

  // Measure once rendered so the menu can be clamped inside the viewport.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    if (open.align === "sheet") {
      // The sheet is laid out by CSS (docked to the bottom of the screen).
      setPosition({ left: 0, top: 0 });
      return;
    }
    const menu = menuRef.current.getBoundingClientRect();
    const margin = 8;
    let left = open.align === "trigger" ? open.x - menu.width : open.x;
    let top = open.y;
    if (left + menu.width > window.innerWidth - margin) left = window.innerWidth - margin - menu.width;
    if (top + menu.height > window.innerHeight - margin) {
      const above = open.align === "trigger" ? (triggerRef.current?.getBoundingClientRect().top ?? top) - 4 - menu.height : top - menu.height;
      top = Math.max(margin, above);
    }
    setPosition({ left: Math.max(margin, left), top });
  }, [open]);

  // Focus the first item once the menu is positioned (it's invisible, so unfocusable, before).
  useEffect(() => {
    if (position) menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
  }, [position]);

  useEffect(() => {
    if (!open) return;
    const onDismiss = () => close();
    window.addEventListener("blur", onDismiss);
    // The sheet closes from its backdrop (a click, so the tap doesn't fall through to the row
    // under it) and scrolls its own items; phones resize as the address bar slides away.
    if (open.align === "sheet") return () => window.removeEventListener("blur", onDismiss);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("blur", onDismiss);
    };
  }, [open, close]);

  function toggleFromTrigger() {
    if (open) {
      close();
      return;
    }
    if (triggerPointerRef.current === "touch") {
      const host = row ? triggerRef.current?.closest<HTMLElement>(".action-row") : null;
      show({ x: 0, y: 0, align: "sheet", subtitle: host ? rowSubtitle(host) : undefined });
      return;
    }
    const r = triggerRef.current!.getBoundingClientRect();
    show({ x: r.right, y: r.bottom + 4, align: "trigger" });
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    }
  }

  if (items.length === 0) return null;

  const parsedUri = row && uri ? parseEntityUri(uri) : null;
  const sheetUri = uri ? parseEntityUri(uri) : null;

  const menuItems = items.map((item) => (
    <button
      key={item.key}
      type="button"
      role="menuitem"
      className={item.tone === "danger" ? "action-menu__item action-menu__item--danger" : "action-menu__item"}
      disabled={item.disabled}
      onClick={(event) => {
        event.stopPropagation();
        close(true);
        item.onSelect();
      }}
    >
      {item.label}
    </button>
  ));


  return (
    <>
      {parsedUri ? (
        // Only shown in phone-width .data-table rows, which render as Spotify-style list rows
        // (cover art on the left, the entity type under the name); hidden everywhere else.
        <>
          <span className="action-row__art">
            <EntityArt type={parsedUri.entityType} title={name} size="sm" uri={uri} />
          </span>
          <span className="action-row__type">{entityTypeLabel(t, uri!)}</span>
        </>
      ) : null}
      {like?.liked ? (
        // Liked rows show the filled saved glyph (a heart by default) in the actions column; pressing
        // it opens the app's collections sheet when it has one (`like.open`), else unlikes.
        <button
          type="button"
          className="action-row__like"
          aria-pressed={like.open ? undefined : "true"}
          aria-haspopup={like.open ? "dialog" : undefined}
          aria-label={like.open ? (like.openLabel ?? name) : t("actions.unlike", { name })}
          title={like.open ? (like.openLabel ?? name) : t("actions.unlike", { name })}
          onClick={(event) => {
            event.stopPropagation();
            if (like.open) like.open();
            else like.setLiked(false);
          }}
        >
          <SavedIcon saved />
        </button>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className={row ? "action-menu-trigger action-menu-trigger--row" : "action-menu-trigger"}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        aria-label={t("actions.more", { name })}
        title={t("actions.more", { name })}
        onPointerDown={(event) => {
          triggerPointerRef.current = event.pointerType;
        }}
        onClick={(event) => {
          event.stopPropagation();
          toggleFromTrigger();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" fill="currentColor" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          <circle cx="13" cy="8" r="1.4" fill="currentColor" />
        </svg>
      </button>
      {open?.align === "sheet"
        ? createPortal(
            <div
              className="action-sheet-backdrop"
              onClick={(event) => {
                event.stopPropagation();
                close();
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div
                ref={menuRef}
                id={menuId}
                className="action-sheet"
                role="menu"
                aria-label={t("actions.for", { name })}
                onKeyDown={onMenuKeyDown}
                onClick={(event) => event.stopPropagation()}
              >
                {/* A copy of the row the menu is for, like the phone-width list rows. */}
                <div className="action-sheet__entity" aria-hidden="true">
                  {sheetUri ? <EntityArt type={sheetUri.entityType} title={name} size="sm" uri={uri} /> : null}
                  <span className="action-sheet__entity-text">
                    <span className="action-sheet__name">{name}</span>
                    {sheetUri || open.subtitle ? (
                      <span className="action-sheet__meta">
                        {[sheetUri ? entityTypeLabel(t, uri!) : null, open.subtitle].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="action-sheet__items">{menuItems}</div>
              </div>
            </div>,
            document.body,
          )
        : open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="action-menu"
              role="menu"
              aria-label={t("actions.for", { name })}
              style={position ? { left: position.left, top: position.top } : { left: open.x, top: open.y, visibility: "hidden" }}
              onKeyDown={onMenuKeyDown}
              onContextMenu={(event) => event.preventDefault()}
            >
              {menuItems}
            </div>,
            document.body,
          )
        : null}
      {scheduleOpen ? (
        <div className="entity-lifecycle-backdrop" onClick={() => setScheduleOpen(false)}>
          <form
            className="entity-lifecycle-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${menuId}-schedule-title`}
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (!uri || !scheduleAt || Number.isNaN(new Date(scheduleAt).getTime())) return;
              setSavingSchedule(true);
              void lifecycle.schedule(uri, new Date(scheduleAt).toISOString())
                .then(() => {
                  setScheduleOpen(false);
                  showToast(t("actions.deletionScheduled"));
                })
                .catch(() => showToast(t("actions.lifecycleFailed")))
                .finally(() => setSavingSchedule(false));
            }}
          >
            <h2 id={`${menuId}-schedule-title`}>{t("actions.scheduleSoftDeletion")}</h2>
            <label className="bungalow-field">
              <span className="bungalow-label">{t("actions.deletionDate")}</span>
              <input
                className="bungalow-input"
                type="datetime-local"
                required
                value={scheduleAt}
                onChange={(event) => setScheduleAt(event.target.value)}
              />
            </label>
            <div className="entity-lifecycle-dialog__actions">
              <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" tone="primary" disabled={savingSchedule}>
                {t("actions.schedule")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
