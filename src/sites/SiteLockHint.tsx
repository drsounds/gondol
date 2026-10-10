import { useI18n } from "../i18n/i18n";
import { useSitePreferenceLock, useSiteThemeLock, type SitePreference } from "./preferences";
import type { SiteThemePart } from "./sites";

/**
 * Under an Account setting the site served here locks (./preferences.ts): says so. Else nothing.
 * `preference` is one of the site's visitor preferences, `themePart` a part of its theme.
 */
export function SiteLockHint({ preference, themePart }: { preference?: SitePreference; themePart?: SiteThemePart }) {
  const { t } = useI18n();
  const preferenceLock = useSitePreferenceLock(preference ?? "player");
  const themeLock = useSiteThemeLock(themePart ?? "engine");
  const lock = themePart ? themeLock : preference ? preferenceLock : null;
  if (!lock) return null;
  return <span className="bungalow-help site-lock-hint">{t("sites.preferenceLocked", { site: lock.siteName })}</span>;
}
