import { useId } from "react";
import { useI18n } from "../i18n/i18n";
import { SiteLockHint } from "../sites/SiteLockHint";
import { useSitePreferenceLock, useSiteThemeLock } from "../sites/preferences";
import { DEFAULT_ACCENT_COLOR, useAccentColor } from "./accentColor";
import { useUserTheme } from "./userTheme";

/** An accent choice: the theme's own accent, the foreground (text) colour, or a colour (#rrggbb). */
export type AccentChoice = "theme" | "foreground" | string;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Picks an accent: the theme's own, the foreground colour (accented things read as plain ink on
 * the background), or a colour of one's own. Used by Account and by the site sheet.
 */
export function AccentColorField({
  value,
  onChange,
  disabled,
  label,
}: {
  value: AccentChoice;
  onChange: (value: AccentChoice) => void;
  disabled?: boolean;
  label?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const custom = HEX_COLOR.test(value) ? value : null;
  return (
    <div className="bungalow-field">
      <span className="bungalow-label" id={`${id}-label`}>
        {label ?? t("accent.label")}
      </span>
      <div className="accent-choice" role="radiogroup" aria-labelledby={`${id}-label`}>
        <label className="bungalow-check">
          <input type="radio" name={id} checked={value === "theme"} disabled={disabled} onChange={() => onChange("theme")} />
          <span>{t("accent.theme")}</span>
        </label>
        <label className="bungalow-check">
          <input type="radio" name={id} checked={value === "foreground"} disabled={disabled} onChange={() => onChange("foreground")} />
          <span>{t("accent.foreground")}</span>
        </label>
        <div className="accent-choice__custom">
          <label className="bungalow-check">
            <input
              type="radio"
              name={id}
              checked={custom != null}
              disabled={disabled}
              onChange={() => onChange(custom ?? DEFAULT_ACCENT_COLOR)}
            />
            <span>{t("accent.custom")}</span>
          </label>
          <input
            type="color"
            className="accent-color-picker__swatch"
            aria-label={t("accent.custom")}
            value={custom ?? DEFAULT_ACCENT_COLOR}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Account's accent and contrast settings: the accent (AccentColorField; the foreground choice is
 * stored in UserTheme.shell.accentForeground, a colour in accentColor.tsx) and high contrast, where
 * every shade is only the foreground or the background colour. Each shows the value in effect, and
 * what the site served here locks is disabled.
 */
export function AccentColorSettings() {
  const { t } = useI18n();
  const { setAccentColor } = useAccentColor();
  const { userTheme, updateUserTheme, applied, preferences } = useUserTheme();
  const shell = userTheme.shell ?? {};
  const accentLocked = !!useSiteThemeLock("accentColor");
  const contrastLocked = !!useSitePreferenceLock("highContrast");
  const value: AccentChoice = applied.accent ?? "theme";

  const setAccent = (next: AccentChoice) => {
    if (next === "foreground") {
      // The colour stays stored, so picking "custom" again brings it back.
      updateUserTheme({ shell: { ...shell, accentForeground: true } });
      return;
    }
    if (shell.accentForeground) updateUserTheme({ shell: { ...shell, accentForeground: false } });
    setAccentColor(next === "theme" ? null : next);
  };

  return (
    <div className="stack">
      <AccentColorField value={value} onChange={setAccent} disabled={accentLocked} />
      <SiteLockHint themePart="accentColor" />
      <div className="bungalow-field">
        <label className="bungalow-check">
          <input
            type="checkbox"
            checked={!!preferences.highContrast}
            disabled={contrastLocked}
            onChange={(e) => updateUserTheme({ shell: { ...shell, highContrast: e.target.checked } })}
          />
          <span>{t("appearance.highContrast")}</span>
        </label>
        <span className="bungalow-help">{t("appearance.highContrast.hint")}</span>
        <SiteLockHint preference="highContrast" />
      </div>
    </div>
  );
}
