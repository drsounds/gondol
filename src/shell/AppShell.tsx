import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useI18n } from "../i18n/i18n";
import { useActiveAppWidgets, useAppNavigation, Widgets } from "../apps/navigation";
import { ActionsPalette } from "../apps/components/ActionsPalette";
import { KeyboardShortcutsDialog } from "../apps/components/KeyboardShortcutsDialog";
import { ChromeSearchForm, type ChromeSearchState } from "./ChromeSearch";
import { ChevronIcon, HamburgerIcon } from "./icons";
import { FeatureDotContext, type FeatureDot } from "./NavItem";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { AppInset, AppPages, AppRows, useOpenApp } from "./AppMenu";
import { useSiteOffers } from "../sites/capabilities";
import { useOptionalUserTheme } from "../theme/userTheme";

const NAV_COLLAPSED_STORAGE_KEY = "cashflow-nav-collapsed";

/** Whether the desktop sidebar is collapsed to its icons, remembered per device. */
export function useNavCollapsed(): [collapsed: boolean, toggle: () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (window.localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "true") setCollapsed(true);
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

/** Arrow keys, Home and End move between the navigation's items. */
function handleNavKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const nav = e.currentTarget;
  const items = Array.from(nav.querySelectorAll<HTMLButtonElement>(".nav-item:not([disabled])"));
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  if (currentIndex === -1) return;

  e.preventDefault();
  let nextIndex = currentIndex;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % items.length;
  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + items.length) % items.length;
  } else if (e.key === "Home") {
    nextIndex = 0;
  } else if (e.key === "End") {
    nextIndex = items.length - 1;
  }
  items[nextIndex]?.focus();
}

export interface AppShellProps {
  /** The chrome search field's state (useChromeSearch). */
  search: ChromeSearchState;
  /** The header's view-dependent actions (filters, …), shown left of `chromeActions`. */
  topBarActions?: ReactNode;
  /** The header's own actions on the right (home, notifications, the account menu, …). */
  chromeActions?: ReactNode;
  /** Next to back/forward at the top of the left menu (classic desktop layout). */
  sidebarChromeActions?: ReactNode;
  /** Strips under the header (update available, previews). */
  banners?: ReactNode;
  /** The strip above the content (the global filter's bar); null hides it. */
  filterStrip?: ReactNode;
  /** Content without padding (full-bleed views). */
  contentFlush?: boolean;
  /** The view. */
  children: ReactNode;
  navCollapsed: boolean;
  onToggleNav: () => void;
  /** The app's own items at the top of the navigation (NavItem), before the apps' widgets. */
  navItems: ReactNode;
  /** Groups between the apps' sidebar widgets and the apps' sections. */
  navExtra?: ReactNode;
  /** The menu drawer's (phones) own items, and its groups before the apps' sections; `navigate` also closes it. */
  drawerItems: (navigate: (path: string) => void) => ReactNode;
  drawerExtra?: (navigate: (path: string) => void) => ReactNode;
  /** The add button under the navigation; `addOpen` while its picker is open. */
  onAdd: () => void;
  addOpen: boolean;
  /** "New feature" dots on navigation targets (see NavItem). */
  featureDot?: FeatureDot;
  /** Sheets, drawers and guides, rendered over everything. */
  overlays?: ReactNode;
  onNavigate: (path: string) => void;
  onOpenUri: (uri: string) => void;
}

/**
 * The application shell: the chrome bar (back/forward, search, actions), the content, the
 * navigation (the desktop sidebar with every active app's section and its widgets, the phone tab
 * bar, the menu drawer), the apps' bottom widgets, the actions palette and the keyboard shortcuts.
 * Render it inside ActionsProvider (and ActiveAppsProvider, GlobalFilterProvider) so the palette
 * and the apps' widgets work.
 */
export function AppShell({
  search,
  topBarActions,
  chromeActions,
  sidebarChromeActions,
  banners,
  filterStrip,
  contentFlush,
  children,
  navCollapsed,
  onToggleNav,
  navItems,
  navExtra,
  drawerItems,
  drawerExtra,
  onAdd,
  addOpen,
  featureDot = () => null,
  overlays,
  onNavigate,
  onOpenUri,
}: AppShellProps) {
  const { t, intlLocale } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navSections = useAppNavigation(intlLocale);
  const canCreate = useSiteOffers()({ aspects: ["create"] });

  const { sidebarNavWidgets, sidebarPanelWidgets, bottomWidgets, overlayWidgets } = useActiveAppWidgets();
  const preferences = useOptionalUserTheme()?.preferences;
  
  // The bottom player: always, only while something plays (the widget decides), or never.
  const player = preferences?.player ?? "always";
  // "Your Library" (the apps' sidebar panels) under the desktop menu, unless turned off.
  const showLibrary = preferences?.sidebarLibrary ?? true;
  // Every app's pages in the menu, or one row per app opening its pages beside it or in place of it.
  const menuStyle = preferences?.menuStyle ?? "features";
  const appSections = navSections.filter((section) => section.items.length > 0);
  const { open: openApp, setOpenId: setOpenApp } = useOpenApp(appSections, pathname);
  const insetApp = menuStyle === "appsInset" ? openApp : null;
  const besideApp = menuStyle === "appsBeside" ? openApp : null;
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const [menuHeight, setMenuHeight] = useState<number | null>(null);
  const sidebarColumnRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const resizeDrag = useRef<{ axis: "horizontal" | "vertical"; pointerId: number; start: number; size: number } | null>(null);
  // The menu grows by what the panels under it (Your Library) can still give up, down to their own
  // min-height (128px when they set none), so it never pushes them out of the column.
  const getMaxMenuHeight = () => {
    const nav = navRef.current;
    if (!nav) return 480;
    let spare = 0;
    for (let el = nav.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.classList.contains("sidebar-resize-handle")) continue;
      const min = parseFloat(getComputedStyle(el).minHeight);
      spare += Math.max(0, el.getBoundingClientRect().height - (min > 0 ? min : 128));
    }
    return nav.getBoundingClientRect().height + spare;
  };

  const startResize = (axis: "horizontal" | "vertical", event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = axis === "horizontal" ? sidebarColumnRef.current : navRef.current;
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    resizeDrag.current = {
      axis,
      pointerId: event.pointerId,
      start: axis === "horizontal" ? event.clientX : event.clientY,
      size: axis === "horizontal" ? bounds.width : bounds.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.axis === "horizontal") {
      setSidebarWidth(Math.max(180, Math.min(480, drag.size + event.clientX - drag.start)));
    } else {
      setMenuHeight(Math.max(120, Math.min(getMaxMenuHeight(), drag.size + event.clientY - drag.start)));
    }
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeDrag.current?.pointerId === event.pointerId) resizeDrag.current = null;
  };

  const resizeWithKeyboard = (axis: "horizontal" | "vertical", event: KeyboardEvent<HTMLDivElement>) => {
    const positive = axis === "horizontal" ? "ArrowRight" : "ArrowDown";
    const negative = axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
    if (event.key !== positive && event.key !== negative) return;
    event.preventDefault();
    const amount = event.key === positive ? 16 : -16;
    if (axis === "horizontal") {
      const currentWidth = sidebarWidth ?? sidebarColumnRef.current?.getBoundingClientRect().width ?? 256;
      setSidebarWidth(Math.max(180, Math.min(480, currentWidth + amount)));
    } else {
      const currentHeight = menuHeight ?? navRef.current?.getBoundingClientRect().height ?? 240;
      setMenuHeight(Math.max(120, Math.min(getMaxMenuHeight(), currentHeight + amount)));
    }
  };

  // Mobile hamburger drawer; any navigation (drawer item, back button, deep link) closes it.
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => closeMenu(), [pathname, closeMenu]);
  const drawerNavigate = (targetPath: string) => {
    closeMenu();
    onNavigate(targetPath);
  };

  // Shared by the header (modern desktop layout) and the top of the left menu (classic layout);
  // CSS shows one or the other.
  const historyButtons = (
    <div className="chrome-bar__history">
      <button type="button" className="chrome-nav-btn" aria-label={t("chrome.back")} onClick={() => window.history.back()}>
        <ChevronIcon direction="left" />
      </button>
      <button type="button" className="chrome-nav-btn" aria-label={t("chrome.forward")} onClick={() => window.history.forward()}>
        <ChevronIcon direction="right" />
      </button>
    </div>
  );
  const searchForm = <ChromeSearchForm search={search} />;

  return (
    <FeatureDotContext.Provider value={featureDot}>
    <main className="bungalow-root app-frame">
      <header className="chrome-bar">
        {historyButtons}
        {searchForm}
        <div className="top-bar__actions">{topBarActions}</div>
        <div className="chrome-bar__actions">{chromeActions}</div>
      </header>

      {banners}

      <div className="app-frame__body">
      <div className="app-main">
            <button
              type="button"
              className="chrome-nav-btn top-bar__menu"
              aria-label={t("nav.openMenu")}
              title={t("nav.openMenu")}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              style={{ position: "fixed", top: 0, left: 0, zIndex: 100 }}
              onClick={() => setMenuOpen(true)}
            >
              <HamburgerIcon />
            </button>

      {filterStrip ? <div className="global-filter-strip">{filterStrip}</div> : null}
      <div className={contentFlush ? "app-content app-content--flush" : "app-content"}>{children}</div>
      </div>

      {/* The open app's pages in a second menu right of the first (desktop, MenuStyle "appsBeside"). */}
      {besideApp ? (
        <nav className="bottom-nav app-submenu" aria-label={besideApp.title} onKeyDown={handleNavKeyDown}>
          <div className="nav-group bottom-nav__group">
            <div className="nav-group__label">{besideApp.title}</div>
            <AppPages section={besideApp} pathname={pathname} onNavigate={onNavigate} />
          </div>
        </nav>
      ) : null}

      {/* Desktop: two stacked surfaces, like Spotify's left pane — the nav on top and "Your Library"
          filling the rest down to the bottom. On phones the column dissolves (display: contents)
          and the nav is the bottom tab bar; the library is desktop-only. */}
      <div
        ref={sidebarColumnRef}
        className={["sidebar-column", navCollapsed ? "sidebar-column--collapsed" : "", showLibrary ? "" : "sidebar-column--no-library"].filter(Boolean).join(" ")}
        style={sidebarWidth === null || navCollapsed ? undefined : { width: `${sidebarWidth}px`, flex: `0 0 ${sidebarWidth}px` }}
      >
      {/* Classic desktop layout only: back/forward and search at the top of the left menu. */}
      <div className="sidebar-chrome">
        <div className="sidebar-chrome__row">
          {historyButtons}
          {sidebarChromeActions}
        </div>
        {searchForm}
      </div>
      <nav
        ref={navRef}
        className={["bottom-nav", navCollapsed ? "bottom-nav--collapsed" : "", insetApp ? "bottom-nav--inset" : ""].filter(Boolean).join(" ")}
        aria-label={t("nav.label")}
        role="tablist"
        onKeyDown={handleNavKeyDown}
        // A dragged height replaces the app's own cap on the menu (getMaxMenuHeight() bounds it instead).
        style={menuHeight === null || navCollapsed ? undefined : { height: `${menuHeight}px`, flex: `0 0 ${menuHeight}px`, maxHeight: "none" }}
      >
        <button
          type="button"
          className="bottom-nav__collapse"
          aria-label={navCollapsed ? t("nav.expand") : t("nav.collapse")}
          aria-expanded={!navCollapsed}
          onClick={onToggleNav}
        >
          <ChevronIcon direction={navCollapsed ? "right" : "left"} />
        </button>
        {/* The app's own items (also the phone tab bar, so they stay put there: the desktop
            hides this while an app's pages have slid in). */}
        <div className="bottom-nav__main">
        {navItems}

        {/* Dynamic sidebar navigation widgets (e.g. ChatSidebar) */}
        <Widgets widgets={sidebarNavWidgets} props={{ className: "bottom-nav__chat", onOpenUri, collapsed: navCollapsed }} />

        {navExtra}

        {/* Dynamic App Menu Sections: every app's pages, or a row per app (MenuStyle). */}
        {menuStyle === "features"
          ? navSections.map((section) => (
              <div key={section.id} className="nav-group bottom-nav__group">
                <div className="nav-group__label">{section.title}</div>
                <AppPages section={section} pathname={pathname} onNavigate={onNavigate} extra collapsed={navCollapsed} />
              </div>
            ))
          : <AppRows sections={appSections} pathname={pathname} openId={openApp?.id ?? null} onOpen={setOpenApp} onNavigate={onNavigate} extra />}
        </div>
        {insetApp ? (
          <AppInset key={insetApp.id} section={insetApp} pathname={pathname} onBack={() => setOpenApp(null)} onNavigate={onNavigate} />
        ) : null}
        {/* A site that doesn't offer creating (its aspects, sites/capabilities.ts) has no plus button. */}
        {canCreate ? (
        <div className="bottom-nav__add">
          <button
            type="button"
            className="plus-button"
            aria-label={t("nav.add")}
            title={t("nav.add")}
            aria-haspopup="dialog"
            aria-expanded={addOpen}
            onClick={onAdd}
            data-tour="add-button"
          >
            {featureDot("add-button", { prefix: "create-" })}
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <span className="plus-button__text">{t("nav.add")}</span>
          </button>
        </div>
        ) : null}
      </nav>
      {showLibrary && sidebarPanelWidgets.length > 0 && !navCollapsed ? (
        <div
          className="sidebar-resize-handle sidebar-resize-handle--height"
          role="separator"
          aria-label={t("nav.resizeMenuHeight")}
          aria-orientation="horizontal"
          aria-valuemin={120}
          aria-valuemax={Math.max(120, getMaxMenuHeight())}
          aria-valuenow={Math.round(menuHeight ?? navRef.current?.getBoundingClientRect().height ?? 240)}
          tabIndex={0}
          onPointerDown={(event) => startResize("vertical", event)}
          onPointerMove={moveResize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onKeyDown={(event) => resizeWithKeyboard("vertical", event)}
        />
      ) : null}
      {/* Dynamic sidebar panel widgets (e.g. SidebarLibrary) */}
      <Widgets widgets={sidebarPanelWidgets} props={{ onOpenUri, collapsed: navCollapsed }} />
      {showLibrary
        ? sidebarPanelWidgets.map((Widget, idx) => <Widget key={idx} onOpenUri={onOpenUri} collapsed={navCollapsed} />)
        : null}
      {!navCollapsed ? (
        <div
          className="sidebar-resize-handle sidebar-resize-handle--width"
          role="separator"
          aria-label={t("nav.resizeSidebarWidth")}
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={480}
          aria-valuenow={Math.round(sidebarWidth ?? sidebarColumnRef.current?.getBoundingClientRect().width ?? 256)}
          tabIndex={0}
          onPointerDown={(event) => startResize("horizontal", event)}
          onPointerMove={moveResize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onKeyDown={(event) => resizeWithKeyboard("horizontal", event)}
        />
      ) : null}
      </div>
      </div>

      {menuOpen ? (
        <MobileNavDrawer
          currentPath={pathname}
          navSections={navSections}
          appsMenu={menuStyle !== "features"}
          sidebarNavWidgets={sidebarNavWidgets}
          primary={drawerItems(drawerNavigate)}
          extra={drawerExtra?.(drawerNavigate)}
          onNavigate={drawerNavigate}
          onClose={closeMenu}
          onOpenUri={onOpenUri}
        />
      ) : null}

      {/* Dynamic bottom widgets (e.g. TaskPlayer), unless the player is hidden (ShellSettings.player). */}
      {player === "hidden" ? null : <Widgets widgets={bottomWidgets} props={{ alwaysShow: player === "always" }} />}

      {overlays}
      {/* Sheets the apps own (e.g. an entity type that opens in its app's own sheet). */}
      <Widgets widgets={overlayWidgets} props={{}} />

      <ActionsPalette />
      <KeyboardShortcutsDialog />
    </main>
    </FeatureDotContext.Provider>
  );
}
