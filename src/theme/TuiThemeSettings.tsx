import type { CSSProperties } from "react";
import { Button } from "../design-system/bungalow-79d923";
import { RangeField } from "./AppearanceSettings";
import { useI18n, type MessageKey } from "../i18n/i18n";
import {
  TUI_COLOR_KEYS,
  TUI_DEFAULT_COLORS,
  TUI_STYLES,
  resolveTuiColors,
  resolveTuiGlow,
  tuiStyleOf,
  type TuiSettings,
  type TuiStyle,
} from "./tuiTheme";
import { useThemeEditor } from "./userTheme";

/** Style (DOS / mainframe), colour, glow and scanline controls of the TUI engine. */
export function TuiThemeSettings() {
  const { t } = useI18n();
  const { userTheme, updateUserTheme } = useThemeEditor();
  const tui = userTheme.tui ?? {};
  const style = tuiStyleOf(tui);
  const colors = resolveTuiColors(tui);
  const glow = resolveTuiGlow(tui);
  const update = (partial: Partial<TuiSettings>) => updateUserTheme({ tui: { ...tui, ...partial } });
  // A new style starts from its own colours and glow; scanlines are kept.
  const pickStyle = (next: TuiStyle) => updateUserTheme({ tui: { style: next, scanlines: tui.scanlines } });

  return (
    <div className="stack">
      <div className="bungalow-field">
        <span className="bungalow-label">{t("appearance.tui.style")}</span>
        <div className="palette-grid">
          {TUI_STYLES.map((option) => {
            const c = TUI_DEFAULT_COLORS[option];
            return (
              <button
                key={option}
                type="button"
                className="palette-grid__item"
                aria-pressed={style === option}
                onClick={() => pickStyle(option)}
              >
                <span
                  className={`tui-swatch tui-swatch--${option}`}
                  style={{ "--sw-bg": c.background, "--sw-fg": c.text, "--sw-bar": c.bar, "--sw-bar-fg": c.barText, "--sw-line": c.line } as CSSProperties}
                  aria-hidden
                >
                  <span className="tui-swatch__bar">{option === "dos" ? " File  Edit" : "READY"}</span>
                  <span className="tui-swatch__body">{option === "dos" ? "C:\\>_" : "LOGON ===>_"}</span>
                </span>
                <span className="palette-grid__label">{t(`appearance.tui.style.${option}` as MessageKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="bungalow-field">
        <span className="bungalow-label">{t("appearance.tui.colors")}</span>
        <div className="tui-color-grid">
          {TUI_COLOR_KEYS.map((key) => (
            <label key={key} className="tui-color-grid__item">
              <input
                type="color"
                className="accent-color-picker__swatch"
                value={colors[key]}
                onChange={(event) => update({ colors: { ...tui.colors, [key]: event.target.value } })}
              />
              <span>{t(`appearance.tui.color.${key}` as MessageKey)}</span>
            </label>
          ))}
        </div>
        {tui.colors && Object.keys(tui.colors).length > 0 ? (
          <div>
            <Button size="sm" variant="outline" onClick={() => update({ colors: undefined })}>
              {t("appearance.tui.resetColors")}
            </Button>
          </div>
        ) : null}
      </div>
      <RangeField label={t("appearance.tui.textGlow")} min={0} max={200} value={glow.text} onChange={(textGlow) => update({ textGlow })} />
      <RangeField label={t("appearance.tui.lineGlow")} min={0} max={200} value={glow.lines} onChange={(lineGlow) => update({ lineGlow })} />
      <RangeField
        label={t("appearance.tui.elementGlow")}
        min={0}
        max={200}
        value={glow.elements}
        onChange={(elementGlow) => update({ elementGlow })}
      />
      <label className="bungalow-check">
        <input type="checkbox" checked={!!tui.scanlines} onChange={(e) => update({ scanlines: e.target.checked })} />
        <span>{t("appearance.tui.scanlines")}</span>
      </label>
    </div>
  );
}
