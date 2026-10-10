import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Icon } from "../design-system/bungalow-79d923";
import { useI18n } from "../i18n/i18n";
import { useActiveAppWidgets, useAppNavigation } from "../apps/navigation";
import { ActionsPalette } from "../apps/components/ActionsPalette";
import { KeyboardShortcutsDialog } from "../apps/components/KeyboardShortcutsDialog";
import { ChromeSearchForm, type ChromeSearchState } from "./ChromeSearch";
import { ChevronIcon, HamburgerIcon } from "./icons";
import { FeatureDotContext, NavItem, type FeatureDot } from "./NavItem";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { useSiteOffers } from "../sites/capabilities";

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
  const { sidebarNavWidgets, sidebarPanelWidgets, bottomWidgets } = useActiveAppWidgets();
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

      {/* Desktop: two stacked surfaces, like Spotify's left pane — the nav on top and "Your Library"
          filling the rest down to the bottom. On phones the column dissolves (display: contents)
          and the nav is the bottom tab bar; the library is desktop-only. */}
      <div className={navCollapsed ? "sidebar-column sidebar-column--collapsed" : "sidebar-column"}>
      {/* Classic desktop layout only: back/forward and search at the top of the left menu. */}
      <div className="sidebar-chrome">
        <div className="sidebar-chrome__row">
          {historyButtons}
          {sidebarChromeActions}
        </div>
        {searchForm}
      </div>
      <nav
        className={navCollapsed ? "bottom-nav bottom-nav--collapsed" : "bottom-nav"}
        aria-label={t("nav.label")}
        role="tablist"
        onKeyDown={handleNavKeyDown}
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
        {navItems}

        {/* Dynamic sidebar navigation widgets (e.g. ChatSidebar) */}
        {sidebarNavWidgets.map((Widget, idx) => (
          <Widget key={idx} className="bottom-nav__chat" onOpenUri={onOpenUri} collapsed={navCollapsed} />
        ))}

        {navExtra}

        {/* Dynamic App Menu Sections */}
        {navSections.map((section) => (
          <div key={section.id} className="nav-group bottom-nav__group">
            <div className="nav-group__label">{section.title}</div>
            {section.items.map((item) => (
              <NavItem
                key={item.id}
                icon={<Icon name={item.iconName} />}
                label={item.name}
                extra
                active={pathname === item.path || pathname.startsWith(item.path + "/")}
                onClick={() => onNavigate(item.path)}
              />
            ))}
          </div>
        ))}
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
      {/* Dynamic sidebar panel widgets (e.g. SidebarLibrary) */}
      {sidebarPanelWidgets.map((Widget, idx) => (
        <Widget key={idx} onOpenUri={onOpenUri} collapsed={navCollapsed} />
      ))}
      </div>
      </div>

      {menuOpen ? (
        <MobileNavDrawer
          currentPath={pathname}
          navSections={navSections}
          sidebarNavWidgets={sidebarNavWidgets}
          primary={drawerItems(drawerNavigate)}
          extra={drawerExtra?.(drawerNavigate)}
          onNavigate={drawerNavigate}
          onClose={closeMenu}
          onOpenUri={onOpenUri}
        />
      ) : null}

      {/* Dynamic bottom widgets (e.g. TaskPlayer) */}
      {bottomWidgets.map((Widget, idx) => (
        <Widget key={idx} alwaysShow={true} />
      ))}

      {overlays}

      <ActionsPalette />
      <KeyboardShortcutsDialog />
    </main>
    </FeatureDotContext.Provider>
  );
}
