import { useI18n } from "../i18n/i18n";
import { useSitePreferenceLock, type SitePreference } from "./preferences";

/** Under an Account setting the site served here locks (./preferences.ts): says so. Else nothing. */
export function SiteLockHint({ preference }: { preference: SitePreference }) {
  const { t } = useI18n();
  const lock = useSitePreferenceLock(preference);
  if (!lock) return null;
  return <span className="bungalow-help site-lock-hint">{t("sites.preferenceLocked", { site: lock.siteName })}</span>;
}
