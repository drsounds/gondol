import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../design-system/bungalow-79d923";
import { useI18n } from "../i18n/i18n";
import { copyText } from "../shell/clipboard";
import { useCollectionActions } from "./extensions";
import { useDragEntity, writeEntityDrag } from "./dragEntity";
import { EntityArt } from "./EntityArt";
import { entityTypeLabel } from "./lookup";
import { parseEntityUri } from "./uri";
import { shareUri, shareUrl, useShareKey } from "./shareUri";
import { useGlobalFilterHides } from "../search/globalFilterState";
import { useEntityLifecycle } from "./lifecycle";
import { showToast } from "../shell/clipboard";

export interface MenuAction {
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

type OpenState = { x: number; y: number; align: "pointer" | "trigger" } | null;

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

  const collectionActions = useCollectionActions(uri, name);
  const lifecycle = useEntityLifecycle();
  const { setDragData } = useDragEntity();
  // The slug is looked up once the menu opens; until then the copies use the identifier.
  const shareKey = useShareKey(uri, open !== null);
  const url = uri && shareKey ? shareUrl(uri, shareKey) : null;
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const lifecycleState = lifecycle.stateFor(uri);
  const hasScheduledDeletion = !!lifecycleState?.soft_deleted_at;
  const deletionHasPassed = hasScheduledDeletion && Date.parse(lifecycleState.soft_deleted_at!) <= Date.now();
  const lifecycleActions: MenuAction[] = uri
    ? [
        {
          key: "soft-delete",
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
  // Destructive items stay last, just before the automatic "Copy URI" / "Copy URL".
  const items: MenuAction[] = uri
    ? [
        ...actions.filter((a) => a.tone !== "danger"),
        ...collectionActions,
        ...lifecycleActions,
        ...actions.filter((a) => a.tone === "danger"),
        {
          key: "copy-uri",
          label: t("actions.copyUri"),
          onSelect: () => copyText(shareKey ? shareUri(uri, shareKey) : uri, t("actions.uriCopied"), t("actions.copyFailed")),
        },
        ...(url ? [{ key: "copy-url", label: t("actions.copyUrl"), onSelect: () => copyText(url, t("actions.urlCopied"), t("actions.copyFailed")) }] : []),
      ]
    : actions;

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
      show({ x: event.clientX, y: event.clientY, align: "pointer" });
    };
    host.addEventListener("contextmenu", onContextMenu);
    return () => host.removeEventListener("contextmenu", onContextMenu);
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
  const lifecycleHidden = lifecycle.isHidden(uri);
  const lifecycleDimmed = lifecycle.isDimmed(uri);
  useLayoutEffect(() => {
    const host = triggerRef.current?.closest<HTMLElement>(".action-row");
    if (!host) return;
    const hidden = filteredOut || lifecycleHidden;
    host.classList.toggle("action-row--filtered", hidden);
    host.classList.toggle("action-row--lifecycle-dimmed", lifecycleDimmed && !hidden);
    return () => {
      host.classList.remove("action-row--filtered", "action-row--lifecycle-dimmed");
    };
  }, [filteredOut, lifecycleHidden, lifecycleDimmed]);

  // Measure once rendered so the menu can be clamped inside the viewport.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
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
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onDismiss = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("blur", onDismiss);
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
      <button
        ref={triggerRef}
        type="button"
        className={row ? "action-menu-trigger action-menu-trigger--row" : "action-menu-trigger"}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        aria-label={t("actions.more", { name })}
        title={t("actions.more", { name })}
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
      {open
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
              {items.map((item) => (
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
              ))}
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
