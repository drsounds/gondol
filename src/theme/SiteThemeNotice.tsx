import { useI18n } from "../i18n/i18n";
import { useSite } from "../sites/sites";
import { useUserTheme } from "./userTheme";

/**
 * Tells the visitor, above their appearance settings, that the site served here sets its own theme
 * (sites.tsx, SiteTheme), and, when the site allows it, lets them use their own theme here instead.
 * Renders nothing on a site without a theme.
 */
export function SiteThemeNotice() {
  const { t } = useI18n();
  const { site } = useSite();
  const { siteTheme, usingPersonalTheme, setUsingPersonalTheme } = useUserTheme();
  if (!site || !siteTheme) return null;
  return (
    <div className="bungalow-field site-theme-notice">
      <span className="bungalow-label">{t("appearance.siteTheme")}</span>
      {siteTheme.allowPersonal ? (
        <>
          <label className="bungalow-check">
            <input type="checkbox" checked={usingPersonalTheme} onChange={(e) => setUsingPersonalTheme(e.target.checked)} />
            <span>{t("appearance.siteTheme.personal", { site: site.name })}</span>
          </label>
          <span className="bungalow-help">
            {usingPersonalTheme ? t("appearance.siteTheme.personalOn") : t("appearance.siteTheme.personalOff", { site: site.name })}
          </span>
        </>
      ) : (
        <span className="bungalow-help">{t("appearance.siteTheme.locked", { site: site.name })}</span>
      )}
    </div>
  );
}
