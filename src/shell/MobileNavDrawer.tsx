import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { Icon } from "../design-system/bungalow-79d923";
import { useI18n } from "../i18n/i18n";
import type { AppSidebarWidgetProps, DynamicMenuSection } from "../apps/types";
import { Widgets } from "../apps/navigation";
import { NavItem } from "./NavItem";

/**
 * Phone-only left drawer with the same dynamic navigation as the desktop sidebar: the app's
 * `primary` items, the apps' sidebar widgets, its `extra` groups and every active app's section.
 * Closes on backdrop click, Escape, or navigating (AppShell closes it on pathname change).
 */
export function MobileNavDrawer({
  currentPath,
  navSections,
  sidebarNavWidgets,
  primary,
  extra,
  onNavigate,
  onClose,
  onOpenUri,
}: {
  currentPath: string;
  navSections: DynamicMenuSection[];
  sidebarNavWidgets: ComponentType<AppSidebarWidgetProps>[];
  primary: ReactNode;
  extra?: ReactNode;
  onNavigate: (path: string) => void;
  onClose: () => void;
  onOpenUri: (uri: string) => void;
}) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="nav-drawer-backdrop" onClick={onClose}>
      <nav
        className="nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.menu")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nav-drawer__header">
          <span className="nav-drawer__title">{t("app.name")}</span>
          <button ref={closeRef} type="button" className="sheet__close" onClick={onClose} aria-label={t("nav.closeMenu")}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="nav-drawer__body">
          <div className="nav-group">{primary}</div>
          <Widgets widgets={sidebarNavWidgets} props={{ onOpenUri, collapsed: false }} />
          {extra}
          {navSections.map((section) => (
            <div key={section.id} className="nav-group">
              <div className="nav-group__label">{section.title}</div>
              {section.items.map((item) => (
                <NavItem
                  key={item.id}
                  icon={<Icon name={item.iconName} />}
                  label={item.name}
                  active={currentPath === item.path || currentPath.startsWith(item.path + "/")}
                  onClick={() => onNavigate(item.path)}
                />
              ))}
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
