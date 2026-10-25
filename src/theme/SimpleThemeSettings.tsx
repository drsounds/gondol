import { Button } from "../design-system/bungalow-79d923";
import { useI18n } from "../i18n/i18n";
import { SIMPLE_DEFAULT_COLORS, useThemeEditor, type SimpleColors } from "./userTheme";

const SCHEMES = ["light", "dark"] as const;
const PARTS = ["foreground", "background"] as const;

/**
 * The simple engine's own text and background colours, one pair for light mode and one for dark.
 * Each shows the design system's colour until it is changed, and resets back to it.
 */
export function SimpleThemeSettings() {
  const { t } = useI18n();
  const { userTheme, updateUserTheme } = useThemeEditor();
  const simple = userTheme.simple ?? {};
  const setColors = (scheme: (typeof SCHEMES)[number], colors: SimpleColors | null) =>
    updateUserTheme({ simple: { ...simple, [scheme]: colors } });

  return (
    <div className="stack">
      {SCHEMES.map((scheme) => {
        const own = simple[scheme] ?? {};
        const changed = !!(own.foreground || own.background);
        return (
          <div key={scheme} className="bungalow-field">
            <span className="bungalow-label">{t(scheme === "light" ? "appearance.simple.light" : "appearance.simple.dark")}</span>
            <div className="simple-color-grid">
              {PARTS.map((part) => (
                <label key={part} className="simple-color-grid__item">
                  <input
                    type="color"
                    className="accent-color-picker__swatch"
                    value={own[part] ?? SIMPLE_DEFAULT_COLORS[scheme][part]}
                    onChange={(event) => setColors(scheme, { ...own, [part]: event.target.value })}
                  />
                  <span>{t(part === "foreground" ? "appearance.simple.foreground" : "appearance.simple.background")}</span>
                </label>
              ))}
              {changed ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setColors(scheme, null)}>
                  {t("appearance.simple.reset")}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
