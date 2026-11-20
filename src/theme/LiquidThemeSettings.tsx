import { useMemo, type CSSProperties } from "react";
import { Input } from "../design-system/bungalow-79d923";
import { RangeField } from "./AppearanceSettings";
import { useI18n } from "../i18n/i18n";
import { mediaHost } from "../media/host";
import {
  LIQUID_BACKGROUNDS,
  liquidBackgroundDim,
  liquidOpacity,
  liquidStrength,
  type LiquidBackground,
  type LiquidSettings,
} from "./liquidTheme";
import { useThemeEditor } from "./userTheme";

/** A CSS stand-in for a wallpaper the backdrop paints on its canvas, for the picker's swatches. */
function wallpaperSwatch(bg: LiquidBackground): CSSProperties {
  const blobs = bg.blobs.map((b) => `radial-gradient(circle at ${b.x * 100}% ${b.y * 100}%, ${b.color}cc 0, ${b.color}00 ${b.r * 140}%)`);
  return { background: [...blobs, bg.base[0]].join(", ") };
}

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** Background, glass strength, opacity, tint and reflection controls of the Liquid engine. */
export function LiquidThemeSettings() {
  const { t } = useI18n();
  const { userTheme, updateUserTheme } = useThemeEditor();
  const liquid = userTheme.liquid ?? {};
  const update = (partial: Partial<LiquidSettings>) => updateUserTheme({ liquid: { ...liquid, ...partial } });
  const ImagePicker = useMemo(() => mediaHost().ImagePicker, []);
  const background = liquid.background ?? LIQUID_BACKGROUNDS[0].id;
  const custom = background === "custom";

  return (
    <div className="stack">
      <div className="bungalow-field">
        <span className="bungalow-label">{t("appearance.liquid.background")}</span>
        <div className="palette-grid">
          {LIQUID_BACKGROUNDS.map((bg) => (
            <button
              key={bg.id}
              type="button"
              className="palette-grid__item"
              aria-pressed={background === bg.id}
              title={bg.label}
              onClick={() => update({ background: bg.id })}
            >
              <span className="liquid-swatch" style={wallpaperSwatch(bg)} aria-hidden />
              <span className="palette-grid__label">{bg.label}</span>
            </button>
          ))}
          <button type="button" className="palette-grid__item" aria-pressed={custom} onClick={() => update({ background: "custom" })}>
            <span
              className="liquid-swatch liquid-swatch--custom"
              style={liquid.backgroundUrl && isHttpUrl(liquid.backgroundUrl) ? { backgroundImage: `url("${liquid.backgroundUrl}")` } : undefined}
              aria-hidden
            />
            <span className="palette-grid__label">{t("appearance.liquid.customBackground")}</span>
          </button>
        </div>
      </div>
      {custom ? (
        <div className="stack">
          {ImagePicker ? (
            <div className="bungalow-field">
              <span className="bungalow-label">{t("appearance.liquid.pickImage")}</span>
              <ImagePicker
                value={liquid.backgroundMediaId ?? null}
                onChange={(mediaId) => update({ backgroundMediaId: mediaId || null })}
              />
            </div>
          ) : null}
          <label className="bungalow-field">
            <span className="bungalow-label">{t("appearance.liquid.imageUrl")}</span>
            <Input
              type="url"
              placeholder="https://…"
              value={liquid.backgroundUrl ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                // A typed address replaces a picked image.
                update({ backgroundUrl: value || null, backgroundMediaId: value ? null : liquid.backgroundMediaId });
              }}
            />
          </label>
        </div>
      ) : null}
      <RangeField
        label={t("appearance.liquid.backgroundDim")}
        min={0}
        max={80}
        value={liquidBackgroundDim(liquid)}
        onChange={(backgroundDim) => update({ backgroundDim })}
      />
      <RangeField label={t("appearance.liquid.strength")} min={0} max={100} value={liquidStrength(liquid)} onChange={(strength) => update({ strength })} />
      <RangeField label={t("appearance.liquid.opacity")} min={0} max={100} value={liquidOpacity(liquid)} onChange={(opacity) => update({ opacity })} />
      <div className="bungalow-field">
        <label className="bungalow-check">
          <input
            type="checkbox"
            checked={!!liquid.tint}
            onChange={(e) => update({ tint: e.target.checked ? liquid.tint || "#0a84ff" : null })}
          />
          <span>{t("appearance.liquid.tint")}</span>
        </label>
        {liquid.tint ? (
          <div className="accent-color-picker">
            <input
              type="color"
              aria-label={t("appearance.liquid.tintColor")}
              title={t("appearance.liquid.tintColor")}
              className="accent-color-picker__swatch"
              value={liquid.tint}
              onChange={(event) => update({ tint: event.target.value })}
            />
            <span className="bungalow-label">{t("appearance.liquid.tintColor")}</span>
          </div>
        ) : null}
      </div>
      {liquid.tint ? (
        <RangeField
          label={t("appearance.liquid.tintAmount")}
          min={0}
          max={100}
          value={liquid.tintAmount ?? 25}
          onChange={(tintAmount) => update({ tintAmount })}
        />
      ) : null}
      <label className="bungalow-check">
        <input type="checkbox" checked={liquid.reflections !== false} onChange={(e) => update({ reflections: e.target.checked })} />
        <span>{t("appearance.liquid.reflections")}</span>
      </label>
    </div>
  );
}
