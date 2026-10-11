import { Select } from "../design-system/bungalow-79d923";
import { useI18n, type MessageKey } from "../i18n/i18n";
import { SiteLockHint } from "../sites/SiteLockHint";
import { useSitePreferenceLock } from "../sites/preferences";
import { SAVED_ICON_STYLES, SavedIcon, isSavedIconStyle } from "./savedIcon";
import {
  DESKTOP_LAYOUTS,
  MENU_STYLES,
  PLAYER_VISIBILITIES,
  SHEET_STYLES,
  useUserTheme,
  type DesktopLayout,
  type MenuStyle,
  type PlayerVisibility,
  type SheetStyle,
  type ShellSettings as Shell,
} from "./userTheme";

/** App shell preferences: the desktop layout (every engine), the menu, Your Library, the bottom player, edit sheets as a
 * modal or a page, lines between table rows, the saved icon, which entities show and, in the simple engine, a dark tab bar / frame and left menu while the
 * rest of the app is light. Each shows the value in effect; one the site locks is disabled
 * (sites/preferences.ts). */
export function ShellSettings() {
  const { t } = useI18n();
  const { engine, userTheme, updateUserTheme, preferences } = useUserTheme();
  const shell = userTheme.shell ?? {};
  const update = (partial: Partial<Shell>) => updateUserTheme({ shell: { ...shell, ...partial } });
  const layout = preferences.desktopLayout ?? "modern";
  const locked = {
    darkTabBar: !!useSitePreferenceLock("darkTabBar"),
    darkFrame: !!useSitePreferenceLock("darkFrame"),
    desktopLayout: !!useSitePreferenceLock("desktopLayout"),
    player: !!useSitePreferenceLock("player"),
    sidebarLibrary: !!useSitePreferenceLock("sidebarLibrary"),
    menuStyle: !!useSitePreferenceLock("menuStyle"),
    savedIcon: !!useSitePreferenceLock("savedIcon"),
    sheetStyle: !!useSitePreferenceLock("sheetStyle"),
    tableLines: !!useSitePreferenceLock("tableLines"),
    hideSoftDeletedEntities: !!useSitePreferenceLock("hideSoftDeletedEntities"),
    hideFutureEntities: !!useSitePreferenceLock("hideFutureEntities"),
  };

  return (
    <div className="stack">
      {engine === "simple" ? (
        <div className="bungalow-field">
          <span className="bungalow-label">{t("appearance.shellDark")}</span>
          <label className="bungalow-check">
            <input
              type="checkbox"
              checked={!!preferences.darkTabBar}
              disabled={locked.darkTabBar}
              onChange={(e) => update({ darkTabBar: e.target.checked })}
            />
            <span>{t("appearance.shellDark.tabBar")}</span>
          </label>
          <label className="bungalow-check">
            <input
              type="checkbox"
              checked={!!preferences.darkFrame}
              disabled={locked.darkFrame}
              onChange={(e) => update({ darkFrame: e.target.checked })}
            />
            <span>{t("appearance.shellDark.frame")}</span>
          </label>
          <span className="bungalow-help">{t("appearance.shellDark.hint")}</span>
          {locked.darkTabBar ? <SiteLockHint preference="darkTabBar" /> : <SiteLockHint preference="darkFrame" />}
        </div>
      ) : null}
      <Select
        label={t("appearance.desktopLayout")}
        value={layout}
        disabled={locked.desktopLayout}
        onChange={(e) => update({ desktopLayout: e.target.value as DesktopLayout })}
      >
        {DESKTOP_LAYOUTS.map((option) => (
          <option key={option} value={option}>{t(`appearance.desktopLayout.${option}` as MessageKey)}</option>
        ))}
      </Select>
      <SiteLockHint preference="desktopLayout" />
      {layout === "classic" ? (
        <label className="bungalow-check">
          <input
            type="checkbox"
            checked={!!preferences.classicFrame}
            disabled={locked.desktopLayout}
            onChange={(e) => update({ classicFrame: e.target.checked })}
          />
          <span>{t("appearance.desktopLayout.frame")}</span>
        </label>
      ) : null}
      <Select
        label={t("appearance.menuStyle")}
        hint={t("appearance.menuStyle.hint")}
        value={preferences.menuStyle ?? "features"}
        disabled={locked.menuStyle}
        onChange={(e) => update({ menuStyle: e.target.value as MenuStyle })}
      >
        {MENU_STYLES.map((option) => (
          <option key={option} value={option}>{t(`appearance.menuStyle.${option}` as MessageKey)}</option>
        ))}
      </Select>
      <SiteLockHint preference="menuStyle" />
      <div className="bungalow-field">
        <label className="bungalow-check">
          <input
            type="checkbox"
            checked={preferences.sidebarLibrary ?? true}
            disabled={locked.sidebarLibrary}
            onChange={(e) => update({ sidebarLibrary: e.target.checked })}
          />
          <span>{t("appearance.sidebarLibrary")}</span>
        </label>
        <SiteLockHint preference="sidebarLibrary" />
      </div>
      <Select
        label={t("appearance.player")}
        hint={t("appearance.player.hint")}
        value={preferences.player ?? "always"}
        disabled={locked.player}
        onChange={(e) => update({ player: e.target.value as PlayerVisibility })}
      >
        {PLAYER_VISIBILITIES.map((option) => (
          <option key={option} value={option}>{t(`appearance.player.${option}` as MessageKey)}</option>
        ))}
      </Select>
      <SiteLockHint preference="player" />
      <Select
        label={t("appearance.sheetStyle")}
        hint={t("appearance.sheetStyle.hint")}
        value={preferences.sheetStyle ?? "modal"}
        disabled={locked.sheetStyle}
        onChange={(e) => update({ sheetStyle: e.target.value as SheetStyle })}
      >
        {SHEET_STYLES.map((option) => (
          <option key={option} value={option}>{t(`appearance.sheetStyle.${option}` as MessageKey)}</option>
        ))}
      </Select>
      <SiteLockHint preference="sheetStyle" />
      <div className="bungalow-field">
        <label className="bungalow-check">
          <input
            type="checkbox"
            checked={!!preferences.tableLines}
            disabled={locked.tableLines}
            onChange={(e) => update({ tableLines: e.target.checked })}
          />
          <span>{t("appearance.tableLines")}</span>
        </label>
        <SiteLockHint preference="tableLines" />
      </div>
      <div className="bungalow-field">
        <span className="bungalow-label" id="saved-icon-label">{t("appearance.savedIcon")}</span>
        <div className="saved-icon-choice" role="radiogroup" aria-labelledby="saved-icon-label">
          <label className="saved-icon-choice__option">
            <input
              type="radio"
              name="saved-icon"
              checked={locked.savedIcon ? false : !isSavedIconStyle(shell.savedIcon)}
              disabled={locked.savedIcon}
              onChange={() => update({ savedIcon: undefined })}
            />
            <span className="saved-icon-choice__label">{t("appearance.savedIcon.default")}</span>
          </label>
          {SAVED_ICON_STYLES.map((style) => (
            <label key={style} className="saved-icon-choice__option">
              <input
                type="radio"
                name="saved-icon"
                checked={(locked.savedIcon ? preferences.savedIcon : shell.savedIcon) === style}
                disabled={locked.savedIcon}
                onChange={() => update({ savedIcon: style })}
              />
              <span className="saved-icon-choice__glyphs" aria-hidden="true">
                <SavedIcon style={style} saved={false} />
                <SavedIcon style={style} saved />
              </span>
              <span className="saved-icon-choice__label">{t(`appearance.savedIcon.${style}` as MessageKey)}</span>
            </label>
          ))}
        </div>
        <span className="bungalow-help">{t("appearance.savedIcon.hint")}</span>
        <SiteLockHint preference="savedIcon" />
      </div>
      <div className="bungalow-field">
        <span className="bungalow-label">{t("appearance.entityVisibility")}</span>
        <label className="bungalow-check">
          <input
            type="checkbox"
            checked={!!preferences.hideSoftDeletedEntities}
            disabled={locked.hideSoftDeletedEntities}
            onChange={(e) => updateUserTheme({ hideSoftDeletedEntities: e.target.checked })}
          />
          <span>{t("appearance.hideSoftDeletedEntities")}</span>
        </label>
        <label className="bungalow-check">
          <input
            type="checkbox"
            checked={!!preferences.hideFutureEntities}
            disabled={locked.hideFutureEntities}
            onChange={(e) => updateUserTheme({ hideFutureEntities: e.target.checked })}
          />
          <span>{t("appearance.hideFutureEntities")}</span>
        </label>
        {locked.hideSoftDeletedEntities ? <SiteLockHint preference="hideSoftDeletedEntities" /> : <SiteLockHint preference="hideFutureEntities" />}
      </div>
    </div>
  );
}
