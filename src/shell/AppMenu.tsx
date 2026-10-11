import { useEffect, useState } from "react";
import { Icon, type IconName } from "../design-system/bungalow-79d923";
import { useI18n } from "../i18n/i18n";
import type { DynamicMenuSection } from "../apps/types";
import { ChevronIcon } from "./icons";
import { NavItem } from "./NavItem";

/**
 * The "apps" menu styles (MenuStyle, theme/userTheme.tsx): one row per app instead of every
 * app's pages, and the picked app's pages in a second menu beside the first (AppShell) or in a
 * sub-view sliding in over it, like iPhone settings (AppShell on desktop, MobileNavDrawer always).
 */

export const isPathActive = (pathname: string, path: string) => pathname === path || pathname.startsWith(path + "/");

const sectionActive = (section: DynamicMenuSection, pathname: string) => section.items.some((item) => isPathActive(pathname, item.path));

/**
 * The app whose pages are open: the one owning the current page whenever that changes (so the
 * menu follows a deep link or a link in the content; none for an app with a single page), else
 * what its row was last set to.
 */
export function useOpenApp(sections: DynamicMenuSection[], pathname: string) {
  const current = sections.find((section) => sectionActive(section, pathname));
  const currentId = current?.id ?? null;
  const followId = current && current.items.length > 1 ? current.id : null;
  const [openId, setOpenId] = useState<string | null>(followId);
  useEffect(() => {
    if (currentId) setOpenId(followId);
  }, [currentId, followId]);
  const open = sections.find((section) => section.id === openId) ?? null;
  return { open, setOpenId };
}

/**
 * One row per app (under the app's own groups, so without a heading of its own); an app with a
 * single page goes straight to it, the others open their pages.
 */
export function AppRows({
  sections,
  pathname,
  openId,
  onOpen,
  onNavigate,
  extra,
}: {
  sections: DynamicMenuSection[];
  pathname: string;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onNavigate: (path: string) => void;
  extra?: boolean;
}) {
  return (
    <div className="nav-group bottom-nav__group app-menu__apps">
      {sections.map((section) => {
        const single = section.items.length === 1;
        return (
          <NavItem
            key={section.id}
            icon={<Icon name={(section.iconName ?? section.items[0]?.iconName ?? "three-dots-h") as IconName} />}
            label={section.title}
            extra={extra}
            active={sectionActive(section, pathname)}
            expanded={single ? undefined : openId === section.id}
            onClick={() => (single ? onNavigate(section.items[0].path) : onOpen(openId === section.id ? null : section.id))}
          />
        );
      })}
    </div>
  );
}

/** An app's pages. */
export function AppPages({
  section,
  pathname,
  onNavigate,
  extra,
}: {
  section: DynamicMenuSection;
  pathname: string;
  onNavigate: (path: string) => void;
  extra?: boolean;
}) {
  return (
    <>
      {section.items.map((item) => (
        <NavItem
          key={item.id}
          icon={<Icon name={item.iconName} />}
          label={item.name}
          extra={extra}
          active={isPathActive(pathname, item.path)}
          onClick={() => onNavigate(item.path)}
        />
      ))}
    </>
  );
}

/** The sliding sub-view: a back button to the apps, the app's name and its pages. */
export function AppInset({
  section,
  pathname,
  onBack,
  onNavigate,
}: {
  section: DynamicMenuSection;
  pathname: string;
  onBack: () => void;
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="app-menu__inset">
      <button type="button" className="nav-item app-menu__back" onClick={onBack} aria-label={t("nav.backToApps")} title={t("nav.backToApps")}>
        <span className="nav-item__icon-wrap">
          <span className="nav-item__icon"><ChevronIcon direction="left" /></span>
        </span>
        <span className="nav-item__label">{t("nav.appsMenu")}</span>
      </button>
      <div className="nav-group bottom-nav__group">
        <div className="nav-group__label">{section.title}</div>
        <AppPages section={section} pathname={pathname} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
