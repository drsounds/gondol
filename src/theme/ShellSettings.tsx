import { Select } from "../design-system/bungalow-79d923";
import { useI18n, type MessageKey } from "../i18n/i18n";
import { DESKTOP_LAYOUTS, useUserTheme, type DesktopLayout, type ShellSettings as Shell } from "./userTheme";

/** App shell preferences: the desktop layout (every engine) and, in the simple engine, a dark
 * tab bar / frame and left menu while the rest of the app is light. */
export function ShellSettings() {
  const { t } = useI18n();
  const { engine, userTheme, updateUserTheme } = useUserTheme();
  const shell = userTheme.shell ?? {};
  const update = (partial: Partial<Shell>) => updateUserTheme({ shell: { ...shell, ...partial } });
  const layout = shell.desktopLayout ?? "modern";

  return (
    <div className="stack">
      {engine === "simple" ? (
        <div className="bungalow-field">
          <span className="bungalow-label">{t("appearance.shellDark")}</span>
          <label className="bungalow-check">
            <input type="checkbox" checked={!!shell.darkTabBar} onChange={(e) => update({ darkTabBar: e.target.checked })} />
            <span>{t("appearance.shellDark.tabBar")}</span>
          </label>
          <label className="bungalow-check">
            <input type="checkbox" checked={!!shell.darkFrame} onChange={(e) => update({ darkFrame: e.target.checked })} />
            <span>{t("appearance.shellDark.frame")}</span>
          </label>
          <span className="bungalow-help">{t("appearance.shellDark.hint")}</span>
        </div>
      ) : null}
      <Select
        label={t("appearance.desktopLayout")}
        value={layout}
        onChange={(e) => update({ desktopLayout: e.target.value as DesktopLayout })}
      >
        {DESKTOP_LAYOUTS.map((option) => (
          <option key={option} value={option}>{t(`appearance.desktopLayout.${option}` as MessageKey)}</option>
        ))}
      </Select>
      {layout === "classic" ? (
        <label className="bungalow-check">
          <input type="checkbox" checked={!!shell.classicFrame} onChange={(e) => update({ classicFrame: e.target.checked })} />
          <span>{t("appearance.desktopLayout.frame")}</span>
        </label>
      ) : null}
      <div className="bungalow-field">
        <span className="bungalow-label">{t("appearance.entityVisibility")}</span>
        <label className="bungalow-check">
          <input
            type="checkbox"
            checked={!!userTheme.hideSoftDeletedEntities}
            onChange={(e) => updateUserTheme({ hideSoftDeletedEntities: e.target.checked })}
          />
          <span>{t("appearance.hideSoftDeletedEntities")}</span>
        </label>
        <label className="bungalow-check">
          <input
            type="checkbox"
            checked={!!userTheme.hideFutureEntities}
            onChange={(e) => updateUserTheme({ hideFutureEntities: e.target.checked })}
          />
          <span>{t("appearance.hideFutureEntities")}</span>
        </label>
      </div>
    </div>
  );
}
