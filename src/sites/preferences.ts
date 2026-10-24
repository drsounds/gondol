import { isSiteThemeLocked, useSite, type SiteLayout, type SiteThemePart } from "./sites";

/**
 * Visitor preferences a site can set (SiteLayout): every option Account offers besides the theme
 * (which SiteTheme covers, with its own `locked`). Each one the site sets is a default for
 * visitors who haven't picked their own, or, when it is in `SiteLayout.locked`, what everyone gets
 * there; Account then shows it disabled. A layout saved before `locked` existed locks the desktop
 * layout and layout style it sets (they used to always win) and leaves the rest as defaults.
 */
export const SITE_PREFERENCES = [
  "locale",
  "player",
  "sidebarLibrary",
  "menuStyle",
  "desktopLayout",
  "layoutStyle",
  "darkTabBar",
  "darkFrame",
  "fadingTabBar",
  "savedIcon",
  "sheetStyle",
  "tableLines",
  "highContrast",
  "hideSoftDeletedEntities",
  "hideFutureEntities",
  "developerMode",
] as const;
export type SitePreference = (typeof SITE_PREFERENCES)[number];

const LEGACY_LOCKED: readonly SitePreference[] = ["desktopLayout", "layoutStyle"];

const BOOLEAN_PREFERENCES: readonly SitePreference[] = ["sidebarLibrary", "darkTabBar", "darkFrame", "fadingTabBar", "tableLines", "highContrast", "hideSoftDeletedEntities", "hideFutureEntities", "developerMode"];

/** The value a site sets for a preference, or undefined when it leaves it to the visitor. */
export function sitePreferenceValue<K extends SitePreference>(layout: SiteLayout | null | undefined, key: K): SiteLayout[K] | undefined {
  const value = layout?.[key];
  if (value == null || value === "") return undefined;
  if (BOOLEAN_PREFERENCES.includes(key) ? typeof value !== "boolean" : typeof value !== "string") return undefined;
  return value;
}

/** Whether the site's value is all visitors get (a value it sets and locks). */
export function isSitePreferenceLocked(layout: SiteLayout | null | undefined, key: SitePreference): boolean {
  if (sitePreferenceValue(layout, key) === undefined) return false;
  if (!Array.isArray(layout?.locked)) return LEGACY_LOCKED.includes(key);
  return layout.locked.includes(key);
}

/** The value in effect: a locked site value, else the visitor's own, else the site's default. */
export function resolveSitePreference<K extends SitePreference, T>(
  layout: SiteLayout | null | undefined,
  key: K,
  own: T | undefined,
): T | SiteLayout[K] | undefined {
  const siteValue = sitePreferenceValue(layout, key);
  if (siteValue !== undefined && isSitePreferenceLocked(layout, key)) return siteValue;
  return own !== undefined ? own : siteValue;
}

/** The site served here, when it locks `key` (Account disables the setting); else null. */
export function useSitePreferenceLock(key: SitePreference): { siteName: string } | null {
  const { site } = useSite();
  return site && isSitePreferenceLocked(site.layout, key) ? { siteName: site.name } : null;
}

/** The site served here, when it locks a part of its theme (Account disables the setting); else null. */
export function useSiteThemeLock(part: SiteThemePart): { siteName: string } | null {
  const { site } = useSite();
  return site && isSiteThemeLocked(site.theme, part) ? { siteName: site.name } : null;
}
