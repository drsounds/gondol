import type { CSSProperties } from "react";
import { useI18n } from "../i18n/i18n";
import { AERO_TASTES, resolveAeroColors, type AeroSettings } from "./aeroTheme";
import { useUserTheme } from "./userTheme";

/** Taste (tint) and ambience controls of the 3D Frutiger Aero engine. */
export function AeroThemeSettings() {
  const { t } = useI18n();
  const { userTheme, updateUserTheme } = useUserTheme();
  const aero = userTheme.aero ?? {};
  const colors = resolveAeroColors(aero);
  const update = (partial: Partial<AeroSettings>) => updateUserTheme({ aero: { ...aero, ...partial } });

  return (
    <div className="stack">
      <div className="bungalow-field">
        <span className="bungalow-label">{t("appearance.aero.taste")}</span>
        <div className="palette-grid">
          {AERO_TASTES.map((taste) => (
            <button
              key={taste.id}
              type="button"
              className="palette-grid__item"
              aria-pressed={(aero.taste ?? AERO_TASTES[0].id) === taste.id}
              title={taste.label}
              onClick={() => update({ taste: taste.id })}
            >
              <span className="aero-orb" style={{ "--orb-tint": taste.tint, "--orb-accent": taste.accent } as CSSProperties} />
              <span className="palette-grid__label">{taste.label}</span>
            </button>
          ))}
        </div>
        <div className="accent-color-picker">
          <input
            type="color"
            aria-label={t("appearance.aero.customTint")}
            title={t("appearance.aero.customTint")}
            className="accent-color-picker__swatch"
            value={colors.tint}
            onChange={(event) => update({ taste: "custom", tint: event.target.value, accent: aero.taste === "custom" ? aero.accent : colors.accent })}
          />
          <input
            type="color"
            aria-label={t("appearance.aero.customAccent")}
            title={t("appearance.aero.customAccent")}
            className="accent-color-picker__swatch"
            value={colors.accent}
            onChange={(event) => update({ taste: "custom", tint: colors.tint, accent: event.target.value })}
          />
          <span className="bungalow-label">{t("appearance.aero.custom")}</span>
        </div>
      </div>
      <label className="bungalow-check">
        <input type="checkbox" checked={aero.ambient !== false} onChange={(e) => update({ ambient: e.target.checked })} />
        <span>{t("appearance.aero.ambient")}</span>
      </label>
      <label className="bungalow-check">
        <input type="checkbox" checked={aero.glass !== false} onChange={(e) => update({ glass: e.target.checked })} />
        <span>{t("appearance.aero.glass")}</span>
      </label>
    </div>
  );
}
