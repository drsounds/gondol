import { useState } from "react";
import { Button, Input, Select } from "../design-system/bungalow-79d923";
import { useI18n, type MessageKey } from "../i18n/i18n";
import {
  FONT_OPTIONS,
  MATERIAL_PALETTES,
  decodeTheme,
  encodeTheme,
  hexToHslTriplet,
  hslTripletToHex,
  paletteFromId,
  useUserTheme,
  type BackgroundTint,
  type CornerStyle,
  STYLE_FLAVORS,
  type FontFamily,
  type LayoutStyle,
  type LinkStyle,
  type ProgressBarColor,
  type SelectionStyle,
  type ShellStyle,
  type StyleFlavor,
  type TextTransform,
} from "./userTheme";

const CORNERS: CornerStyle[] = ["sharp", "semi", "full"];
const TRANSFORMS: TextTransform[] = ["none", "uppercase", "lowercase", "capitalize"];
const SHELLS: ShellStyle[] = ["auto", "dark", "tinted"];
const LAYOUTS: LayoutStyle[] = ["app", "sidebar", "website"];
const LINKS: LinkStyle[] = ["foreground", "accent"];
const SELECTIONS: SelectionStyle[] = ["subtle", "primary"];
const PROGRESS: ProgressBarColor[] = ["default", "accent", "destructive"];
const TINTS: BackgroundTint[] = ["none", "brown", "green", "blue", "red"];

/** Palette, shape, typography and background controls of the user theme engine. */
export function AppearanceSettings() {
  const { t } = useI18n();
  const { userTheme, updateUserTheme, replaceUserTheme, resetUserTheme, savedThemes, saveCurrentTheme, deleteSavedTheme } =
    useUserTheme();
  const [saveName, setSaveName] = useState("");
  const [importText, setImportText] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const customAccent = userTheme.palette?.accent;

  const setPaletteColor = (key: "secondaryAccent" | "tertiaryAccent", hex: string) => {
    const triplet = hexToHslTriplet(hex);
    const darkKey = key === "secondaryAccent" ? "darkSecondaryAccent" : "darkTertiaryAccent";
    updateUserTheme({ palette: { ...(userTheme.palette ?? {}), [key]: triplet, [darkKey]: triplet }, paletteId: null });
  };

  const flash = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 3000);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(encodeTheme(userTheme));
      flash(t("appearance.copied"));
    } catch {
      flash(t("appearance.copyFailed"));
    }
  };

  const importTheme = () => {
    const decoded = decodeTheme(importText);
    if (!decoded) {
      flash(t("appearance.importInvalid"));
      return;
    }
    replaceUserTheme(decoded);
    setImportText("");
    flash(t("appearance.imported"));
  };

  return (
    <div className="stack">
      <div className="bungalow-field">
        <span className="bungalow-label">{t("appearance.palette")}</span>
        <div className="palette-grid">
          {MATERIAL_PALETTES.map((palette) => (
            <button
              key={palette.id}
              type="button"
              className="palette-grid__item"
              aria-pressed={userTheme.paletteId === palette.id}
              title={palette.label}
              onClick={() => updateUserTheme({ palette: paletteFromId(palette.id), paletteId: palette.id })}
            >
              <span className="palette-grid__swatch" style={{ background: `hsl(${palette.bg})` }}>
                <span style={{ background: `hsl(${palette.navBg})` }} />
                <span style={{ background: `hsl(${palette.accent})` }} />
              </span>
              <span className="palette-grid__label">{palette.label}</span>
            </button>
          ))}
        </div>
        <div className="accent-color-picker">
          <input
            type="color"
            aria-label={t("appearance.paletteAccent")}
            className="accent-color-picker__swatch"
            value={customAccent ? hslTripletToHex(customAccent) : "#888888"}
            onChange={(event) => {
              const accent = hexToHslTriplet(event.target.value);
              updateUserTheme({ palette: { ...(userTheme.palette ?? {}), accent, darkAccent: accent }, paletteId: null });
            }}
          />
          <input
            type="color"
            aria-label={t("appearance.paletteSecondary")}
            className="accent-color-picker__swatch"
            value={userTheme.palette?.secondaryAccent ? hslTripletToHex(userTheme.palette.secondaryAccent) : "#888888"}
            onChange={(event) => setPaletteColor("secondaryAccent", event.target.value)}
          />
          <input
            type="color"
            aria-label={t("appearance.paletteTertiary")}
            className="accent-color-picker__swatch"
            value={userTheme.palette?.tertiaryAccent ? hslTripletToHex(userTheme.palette.tertiaryAccent) : "#888888"}
            onChange={(event) => setPaletteColor("tertiaryAccent", event.target.value)}
          />
          {userTheme.palette ? (
            <Button variant="ghost" onClick={() => updateUserTheme({ palette: null, paletteId: null })}>
              {t("appearance.paletteClear")}
            </Button>
          ) : null}
        </div>
      </div>

      {userTheme.palette ? (
        <div className="bungalow-field">
          <span className="bungalow-label">{t("appearance.paletteAdjust")}</span>
          <RangeField
            label={t("appearance.paletteHue")}
            min={-180}
            max={180}
            value={userTheme.paletteAdjust?.hue ?? 0}
            onChange={(hue) => updateUserTheme({ paletteAdjust: { ...(userTheme.paletteAdjust ?? {}), hue } })}
          />
          <RangeField
            label={t("appearance.paletteSaturation")}
            min={0}
            max={200}
            value={userTheme.paletteAdjust?.saturation ?? 100}
            onChange={(saturation) => updateUserTheme({ paletteAdjust: { ...(userTheme.paletteAdjust ?? {}), saturation } })}
          />
          <RangeField
            label={t("appearance.paletteLightness")}
            min={-30}
            max={30}
            value={userTheme.paletteAdjust?.lightness ?? 0}
            onChange={(lightness) => updateUserTheme({ paletteAdjust: { ...(userTheme.paletteAdjust ?? {}), lightness } })}
          />
          {userTheme.paletteAdjust ? (
            <div className="accent-color-picker">
              <Button variant="ghost" onClick={() => updateUserTheme({ paletteAdjust: null })}>
                {t("appearance.paletteAdjustReset")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Select
        label={t("appearance.flavor")}
        value={userTheme.styleFlavor ?? "none"}
        onChange={(e) => {
          const styleFlavor = e.target.value as StyleFlavor;
          // Switching to neon brings its palette along; the colors stay adjustable below.
          const neonPalette =
            styleFlavor === "neon" && userTheme.styleFlavor !== "neon" && userTheme.paletteId !== "neon"
              ? { palette: paletteFromId("neon"), paletteId: "neon", paletteAdjust: null }
              : {};
          updateUserTheme({ styleFlavor, ...neonPalette });
        }}
      >
        {STYLE_FLAVORS.map((f) => (
          <option key={f} value={f}>{t(`appearance.flavor.${f}` as MessageKey)}</option>
        ))}
      </Select>
      {userTheme.styleFlavor === "neon" ? (
        <>
          <RangeField
            label={t("appearance.neonGlow")}
            min={0}
            max={200}
            value={userTheme.neonGlow ?? 100}
            onChange={(neonGlow) => updateUserTheme({ neonGlow })}
          />
          <label className="bungalow-check">
            <input
              type="checkbox"
              checked={!!userTheme.neonScanlines}
              onChange={(e) => updateUserTheme({ neonScanlines: e.target.checked })}
            />
            <span>{t("appearance.neonScanlines")}</span>
          </label>
        </>
      ) : null}
      {!["none", "material2", "neon"].includes(userTheme.styleFlavor ?? "none") ? (
        <RangeField
          label={t("appearance.skeuoBtnLightness")}
          min={0}
          max={30}
          value={userTheme.skeuoBtnLightness ?? 15}
          onChange={(skeuoBtnLightness) => updateUserTheme({ skeuoBtnLightness })}
        />
      ) : null}

      <Select
        label={t("appearance.shell")}
        value={userTheme.shellStyle ?? "auto"}
        onChange={(e) => updateUserTheme({ shellStyle: e.target.value as ShellStyle })}
      >
        {SHELLS.map((v) => (
          <option key={v} value={v}>{t(`appearance.shell.${v}` as MessageKey)}</option>
        ))}
      </Select>
      <Select
        label={t("appearance.layout")}
        value={userTheme.layoutStyle ?? "app"}
        onChange={(e) => updateUserTheme({ layoutStyle: e.target.value as LayoutStyle })}
      >
        {LAYOUTS.map((v) => (
          <option key={v} value={v}>{t(`appearance.layout.${v}` as MessageKey)}</option>
        ))}
      </Select>
      <Select
        label={t("appearance.link")}
        value={userTheme.linkStyle ?? "foreground"}
        onChange={(e) => updateUserTheme({ linkStyle: e.target.value as LinkStyle })}
      >
        {LINKS.map((v) => (
          <option key={v} value={v}>{t(`appearance.link.${v}` as MessageKey)}</option>
        ))}
      </Select>
      <Select
        label={t("appearance.selection")}
        value={userTheme.selectionStyle ?? "subtle"}
        onChange={(e) => updateUserTheme({ selectionStyle: e.target.value as SelectionStyle })}
      >
        {SELECTIONS.map((v) => (
          <option key={v} value={v}>{t(`appearance.selection.${v}` as MessageKey)}</option>
        ))}
      </Select>
      <Select
        label={t("appearance.progress")}
        value={userTheme.progressBarColor ?? "default"}
        onChange={(e) => updateUserTheme({ progressBarColor: e.target.value as ProgressBarColor })}
      >
        {PROGRESS.map((v) => (
          <option key={v} value={v}>{t(`appearance.progress.${v}` as MessageKey)}</option>
        ))}
      </Select>

      <Select
        label={t("appearance.corners")}
        value={userTheme.cornerStyle ?? "full"}
        onChange={(e) => updateUserTheme({ cornerStyle: e.target.value as CornerStyle })}
      >
        {CORNERS.map((c) => (
          <option key={c} value={c}>{t(`appearance.corners.${c}` as MessageKey)}</option>
        ))}
      </Select>

      <Select
        label={t("appearance.textTransform")}
        value={userTheme.textTransform ?? "none"}
        onChange={(e) => updateUserTheme({ textTransform: e.target.value as TextTransform })}
      >
        {TRANSFORMS.map((c) => (
          <option key={c} value={c}>{t(`appearance.textTransform.${c}` as MessageKey)}</option>
        ))}
      </Select>

      <Select
        label={t("appearance.tint")}
        value={userTheme.backgroundTint ?? "none"}
        onChange={(e) => updateUserTheme({ backgroundTint: e.target.value as BackgroundTint })}
      >
        {TINTS.map((c) => (
          <option key={c} value={c}>{t(`appearance.tint.${c}` as MessageKey)}</option>
        ))}
      </Select>

      <RangeField
        label={t("appearance.tintSaturation")}
        min={0}
        max={200}
        value={userTheme.tintSaturation ?? 100}
        onChange={(tintSaturation) => updateUserTheme({ tintSaturation })}
      />
      <RangeField
        label={t("appearance.bgLightnessLight")}
        min={80}
        max={100}
        value={userTheme.bgLightnessLight ?? 97}
        onChange={(bgLightnessLight) => updateUserTheme({ bgLightnessLight })}
      />
      <RangeField
        label={t("appearance.bgLightnessDark")}
        min={0}
        max={20}
        value={userTheme.bgLightnessDark ?? 7}
        onChange={(bgLightnessDark) => updateUserTheme({ bgLightnessDark })}
      />

      <Select
        label={t("appearance.font")}
        value={userTheme.fontFamily ?? "default"}
        onChange={(e) => updateUserTheme({ fontFamily: e.target.value as FontFamily })}
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f.id} value={f.id}>{f.id === "default" ? t("appearance.font.default") : f.id === "winui-classic" ? t("appearance.font.winui") : f.id === "unscii" ? t("appearance.font.unscii") : f.label}</option>
        ))}
      </Select>
      {userTheme.fontFamily === "winui-classic" ? (
        <p className="stat-label">{t("appearance.winuiNote")}</p>
      ) : (
        <>
          <RangeField
            label={t("appearance.fontSize")}
            min={12}
            max={24}
            value={userTheme.fontSize ?? 16}
            onChange={(fontSize) => updateUserTheme({ fontSize })}
          />
          <RangeField
            label={t("appearance.fontWeight")}
            min={300}
            max={900}
            step={100}
            value={userTheme.fontWeight ?? 400}
            onChange={(fontWeight) => updateUserTheme({ fontWeight })}
          />
          <RangeField
            label={t("appearance.buttonFontWeight")}
            min={300}
            max={900}
            step={100}
            value={userTheme.buttonFontWeight ?? 700}
            onChange={(buttonFontWeight) => updateUserTheme({ buttonFontWeight })}
          />
        </>
      )}

      <label className="bungalow-check">
        <input
          type="checkbox"
          checked={!!userTheme.hideBorders}
          onChange={(e) => updateUserTheme({ hideBorders: e.target.checked })}
        />
        <span>{t("appearance.hideBorders")}</span>
      </label>
      <label className="bungalow-check">
        <input
          type="checkbox"
          checked={!!userTheme.viewTransitions}
          onChange={(e) => updateUserTheme({ viewTransitions: e.target.checked })}
        />
        <span>{t("appearance.viewTransitions")}</span>
      </label>
      <label className="bungalow-check">
        <input
          type="checkbox"
          checked={!!userTheme.staggeredEntries}
          onChange={(e) => updateUserTheme({ staggeredEntries: e.target.checked })}
        />
        <span>{t("appearance.staggeredEntries")}</span>
      </label>

      <div className="bungalow-field">
        <span className="bungalow-label">{t("appearance.saved")}</span>
        <div className="accent-color-picker">
          <Input
            aria-label={t("appearance.saveName")}
            placeholder={t("appearance.saveName")}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!saveName.trim()}
            onClick={() => {
              saveCurrentTheme(saveName.trim());
              setSaveName("");
            }}
          >
            {t("appearance.save")}
          </Button>
        </div>
        {savedThemes.map((saved) => (
          <div key={saved.id} className="accent-color-picker">
            <span>{saved.name}</span>
            <Button variant="ghost" onClick={() => replaceUserTheme(saved.theme)}>{t("appearance.apply")}</Button>
            <Button variant="ghost" onClick={() => deleteSavedTheme(saved.id)}>{t("appearance.delete")}</Button>
          </div>
        ))}
      </div>

      <div className="bungalow-field">
        <span className="bungalow-label">{t("appearance.share")}</span>
        <div className="accent-color-picker">
          <Button variant="outline" onClick={share}>{t("appearance.copy")}</Button>
          <Input
            aria-label={t("appearance.importPlaceholder")}
            placeholder={t("appearance.importPlaceholder")}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <Button variant="outline" disabled={!importText.trim()} onClick={importTheme}>{t("appearance.import")}</Button>
        </div>
      </div>

      <div className="accent-color-picker">
        <Button variant="ghost" onClick={resetUserTheme}>{t("appearance.reset")}</Button>
        {status ? <span role="status">{status}</span> : null}
      </div>
    </div>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="bungalow-field">
      <span className="bungalow-label">
        {label}: {value}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
