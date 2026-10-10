import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useUserThemeSync } from "./useUserThemeSync";
import { setForcedTheme, useTheme } from "./theme";
import { accentColorVars, useAccentColor } from "./accentColor";
import { setNavigationViewTransitions } from "../navigation/navigationProgress";
import { aeroUserTheme, resolveAeroColors, type AeroSettings } from "./aeroTheme";
import { tuiStyleOf, tuiUserTheme, tuiVars, type TuiSettings } from "./tuiTheme";
import { useSite, type SiteTheme } from "../sites/sites";
import { resolveSitePreference, isSitePreferenceLocked, sitePreferenceValue } from "../sites/preferences";
import { namespaced } from "../shell/storage";
import type { SavedIconStyle } from "./savedIcon";

/**
 * User theming engine, ported from gantt-resume-pro (useCustomTheme /
 * useUIPreferences / useSavedThemes) and mapped onto the bungalow design-system
 * tokens instead of shadcn's. Light/dark mode (src/lib/theme.tsx) and the single
 * accent override (src/lib/accentColor.tsx) stay as they are; this layers
 * palettes, shape, typography and background tinting on top.
 *
 * Everything is stored in localStorage. The computed CSS variables are also
 * snapshotted so the inline script in src/routes/__root.tsx can apply them
 * before first paint (see USER_THEME_INIT_SCRIPT).
 */

export type CornerStyle = "sharp" | "semi" | "full";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";
export type BackgroundTint = "none" | "brown" | "green" | "blue" | "red";
export type ShellStyle = "auto" | "dark" | "tinted";
export type SelectionStyle = "subtle" | "primary";
export type LinkStyle = "foreground" | "accent";
export type LayoutStyle = "app" | "sidebar" | "website";
export type ProgressBarColor = "default" | "accent" | "destructive";
export type StyleFlavor =
  | "none" | "skeuomorphic" | "bootstrap2" | "vista" | "material2" | "xp-luna" | "mac9"
  | "aqua" | "mountain-lion" | "itunes08" | "itunes09" | "itunes10" | "yosemite" | "neon";
/** Flavors that get the glossy "tactile" chrome, cards, inputs and row stripes. */
export const TACTILE_FLAVORS: StyleFlavor[] = [
  "skeuomorphic", "bootstrap2", "vista", "xp-luna", "mac9", "aqua", "mountain-lion",
  "itunes08", "itunes09", "itunes10", "yosemite",
];
export const STYLE_FLAVORS: StyleFlavor[] = ["none", ...TACTILE_FLAVORS.slice(0, 3), "material2", ...TACTILE_FLAVORS.slice(3), "neon"];
export type FontFamily = "default" | "winui-classic" | "unscii" | "inter" | "dm-sans" | "jakarta" | "outfit" | "nunito" | "rubik" | "albert-sans";

/** Colors are "H S% L%" triplets, as in the source engine. */
export interface CustomPalette {
  accent?: string;
  navBg?: string;
  navFg?: string;
  bg?: string;
  fg?: string;
  /** Secondary accent (badges) and tertiary accent (sliders, highlights). */
  secondaryAccent?: string;
  tertiaryAccent?: string;
  darkSecondaryAccent?: string;
  darkTertiaryAccent?: string;
  darkAccent?: string;
  darkNavBg?: string;
  darkNavFg?: string;
  darkBg?: string;
  darkFg?: string;
}

/** Whole-palette HSL adjustment, applied on top of every palette color. */
export interface PaletteAdjust {
  /** Hue rotation in degrees, -180–180. */
  hue?: number;
  /** Saturation, percent of the palette's own, 0–200. */
  saturation?: number;
  /** Lightness offset in percentage points, -30–30. */
  lightness?: number;
}

export interface UserTheme {
  palette?: CustomPalette | null;
  paletteId?: string | null;
  paletteAdjust?: PaletteAdjust | null;
  cornerStyle?: CornerStyle;
  textTransform?: TextTransform;
  backgroundTint?: BackgroundTint;
  shellStyle?: ShellStyle;
  styleFlavor?: StyleFlavor;
  linkStyle?: LinkStyle;
  layoutStyle?: LayoutStyle;
  selectionStyle?: SelectionStyle;
  progressBarColor?: ProgressBarColor;
  viewTransitions?: boolean;
  /** Lightness offset (0–30) of neutral buttons in tactile flavors. */
  skeuoBtnLightness?: number;
  /** 0–200, percent of the tint's base saturation. */
  tintSaturation?: number;
  /** Canvas lightness overrides (%), null/undefined = design-system default. */
  bgLightnessLight?: number | null;
  bgLightnessDark?: number | null;
  buttonFontWeight?: number;
  hideBorders?: boolean;
  staggeredEntries?: boolean;
  hideSoftDeletedEntities?: boolean;
  hideFutureEntities?: boolean;
  fontFamily?: FontFamily;
  /** px, 12–24. */
  fontSize?: number;
  fontWeight?: number;
  /** Settings of the 3D Frutiger Aero engine (src/lib/aeroTheme.ts); ignored by the advanced engine. */
  aero?: AeroSettings | null;
  /** Settings of the TUI engine (src/lib/tuiTheme.ts); ignored by the other engines. */
  tui?: TuiSettings | null;
  /** Only set on the theme an alternative engine derives (aeroUserTheme, tuiUserTheme), never stored. */
  engine?: "aero" | "tui";
  /** Neon flavor: glow strength, percent (0–200, default 100). */
  neonGlow?: number;
  /** Neon flavor: CRT scanline overlay. */
  neonScanlines?: boolean;
  /** App shell preferences (src/lib/userTheme.tsx, ShellSettings); kept across every engine. */
  shell?: ShellSettings | null;
}

/** "modern" is the Spotify-style shell: a header across the top (back/forward, search, account)
 * over the sidebar and content. "classic" drops the header: the left menu runs the full height
 * with back/forward and search at its top. Desktop only; phones always get the tab bar. */
export type DesktopLayout = "modern" | "classic";
export const DESKTOP_LAYOUTS: DesktopLayout[] = ["modern", "classic"];

/**
 * The bottom player (the apps' bottom widgets, e.g. the task player): always there, only while
 * something plays or is queued, or never.
 */
export type PlayerVisibility = "always" | "auto" | "hidden";
export const PLAYER_VISIBILITIES: PlayerVisibility[] = ["always", "auto", "hidden"];

export interface ShellSettings {
  /** Simple engine, light mode: dark bottom tab bar on phones. */
  darkTabBar?: boolean;
  /** Simple engine, light mode: dark frame and left menu on desktop. */
  darkFrame?: boolean;
  desktopLayout?: DesktopLayout;
  /** Classic layout: floating panels inside a frame (true) or flush, edge to edge (default). */
  classicFrame?: boolean;
  /** The "saved to library" glyph (savedIcon.tsx); unset follows the site's default, else the heart. */
  savedIcon?: SavedIconStyle;
  /** Unset follows the site's default, else "always". */
  player?: PlayerVisibility;
}

/**
 * The shell preferences and entity visibility in effect: the visitor's own (UserTheme.shell and
 * the hide* flags) combined with what the site served here sets (sites/preferences.ts).
 */
export interface EffectivePreferences extends ShellSettings {
  hideSoftDeletedEntities?: boolean;
  hideFutureEntities?: boolean;
}

export interface PaletteDefinition extends CustomPalette {
  id: string;
  label: string;
  category: "solid" | "rotated";
}

export const FONT_OPTIONS: { id: FontFamily; label: string; value: string | null }[] = [
  { id: "default", label: "Default", value: null },
  /** Tahoma at 11px with no bold text. Also sets data-winui-classic (see styles.css). */
  { id: "winui-classic", label: "WinUI Classic Mode", value: "Tahoma, Geneva, sans-serif" },
  /** Bundled pixel font (src/assets/fonts/unscii-16.*, public domain / CC0), 8×16 like a text terminal. */
  { id: "unscii", label: "Unscii (pixel terminal)", value: "'Unscii', ui-monospace, monospace" },
  { id: "inter", label: "Inter", value: "'Inter', sans-serif" },
  { id: "dm-sans", label: "DM Sans", value: "'DM Sans', sans-serif" },
  { id: "jakarta", label: "Plus Jakarta Sans", value: "'Plus Jakarta Sans', sans-serif" },
  { id: "outfit", label: "Outfit", value: "'Outfit', sans-serif" },
  { id: "nunito", label: "Nunito", value: "'Nunito', sans-serif" },
  { id: "rubik", label: "Rubik", value: "'Rubik', sans-serif" },
  { id: "albert-sans", label: "Albert Sans", value: "'Albert Sans', sans-serif" },
];

const TINT_HUE: Record<Exclude<BackgroundTint, "none">, number> = { brown: 30, green: 140, blue: 215, red: 0 };
/** Base saturation of a tinted canvas at tintSaturation = 100. */
const TINT_BASE_SATURATION = 25;

export const MATERIAL_PALETTES: PaletteDefinition[] = [
  { id: "slate", label: "Slate", category: "solid",
    accent: "215 20% 45%", navBg: "215 25% 15%", navFg: "215 15% 92%", bg: "215 15% 97%", fg: "215 25% 12%",
    darkAccent: "215 25% 60%", darkNavBg: "215 30% 8%", darkNavFg: "215 15% 90%", darkBg: "215 25% 10%", darkFg: "215 15% 90%" },
  // Frutiger Aero: sky-blue tinted surfaces, fresh-green text, aqua accent.
  { id: "frutiger-aero", label: "Frutiger Aero", category: "solid",
    accent: "200 85% 48%", secondaryAccent: "140 60% 42%", tertiaryAccent: "190 80% 45%",
    navBg: "205 70% 88%", navFg: "150 45% 22%", bg: "205 70% 96%", fg: "150 55% 18%",
    darkAccent: "195 85% 55%", darkSecondaryAccent: "140 55% 50%", darkTertiaryAccent: "185 75% 55%",
    darkNavBg: "212 60% 6%", darkNavFg: "145 40% 80%", darkBg: "210 55% 9%", darkFg: "145 55% 82%" },
  { id: "stone", label: "Stone", category: "solid",
    accent: "25 10% 45%", navBg: "25 15% 12%", navFg: "25 10% 92%", bg: "25 10% 97%", fg: "25 15% 12%",
    darkAccent: "25 15% 58%", darkNavBg: "25 15% 7%", darkNavFg: "25 10% 90%", darkBg: "25 15% 9%", darkFg: "25 10% 90%" },
  { id: "ocean", label: "Ocean", category: "solid",
    accent: "200 80% 45%", navBg: "210 60% 12%", navFg: "200 20% 95%", bg: "200 20% 97%", fg: "210 40% 12%",
    darkAccent: "200 70% 55%", darkNavBg: "210 50% 7%", darkNavFg: "200 20% 92%", darkBg: "210 40% 9%", darkFg: "200 15% 90%" },
  { id: "forest", label: "Forest", category: "solid",
    accent: "150 50% 35%", navBg: "150 40% 10%", navFg: "150 15% 92%", bg: "150 15% 97%", fg: "150 30% 12%",
    darkAccent: "150 45% 48%", darkNavBg: "150 35% 7%", darkNavFg: "150 15% 90%", darkBg: "150 25% 9%", darkFg: "150 15% 90%" },
  { id: "wine", label: "Wine", category: "solid",
    accent: "340 60% 40%", navBg: "340 50% 10%", navFg: "340 15% 92%", bg: "340 15% 97%", fg: "340 40% 12%",
    darkAccent: "340 55% 55%", darkNavBg: "340 45% 7%", darkNavFg: "340 15% 90%", darkBg: "340 30% 9%", darkFg: "340 15% 90%" },
  { id: "amber", label: "Amber", category: "solid",
    accent: "35 85% 45%", navBg: "30 50% 10%", navFg: "35 15% 92%", bg: "35 15% 97%", fg: "30 40% 12%",
    darkAccent: "35 80% 55%", darkNavBg: "30 45% 7%", darkNavFg: "35 15% 90%", darkBg: "30 30% 9%", darkFg: "35 15% 90%" },
  { id: "indigo", label: "Indigo", category: "solid",
    accent: "240 60% 55%", navBg: "240 50% 12%", navFg: "240 15% 95%", bg: "240 15% 97%", fg: "240 40% 12%",
    darkAccent: "240 55% 65%", darkNavBg: "240 45% 8%", darkNavFg: "240 15% 92%", darkBg: "240 30% 9%", darkFg: "240 15% 92%" },
  // Neon: the sci-fi "diode" look from Soartify/soarfulness. Dark in both
  // modes; cyan glow, magenta and yellow highlights on a deep blue-black.
  { id: "neon", label: "Neon", category: "solid",
    accent: "185 100% 55%", secondaryAccent: "315 100% 62%", tertiaryAccent: "55 100% 58%",
    navBg: "245 55% 4%", navFg: "185 70% 78%", bg: "240 45% 6%", fg: "185 60% 90%",
    darkAccent: "185 100% 55%", darkSecondaryAccent: "315 100% 62%", darkTertiaryAccent: "55 100% 58%",
    darkNavBg: "245 55% 4%", darkNavFg: "185 70% 78%", darkBg: "240 45% 6%", darkFg: "185 60% 90%" },
  { id: "rose-blue", label: "Rosé & Azure", category: "rotated",
    accent: "220 75% 50%", navBg: "340 50% 15%", navFg: "340 20% 92%", bg: "340 30% 95%", fg: "340 50% 18%",
    darkAccent: "340 60% 60%", darkNavBg: "220 50% 10%", darkNavFg: "220 20% 92%", darkBg: "220 35% 10%", darkFg: "220 15% 92%" },
  { id: "mint-coral", label: "Mint & Coral", category: "rotated",
    accent: "5 70% 55%", navBg: "165 45% 12%", navFg: "165 15% 92%", bg: "165 25% 95%", fg: "165 40% 15%",
    darkAccent: "165 50% 50%", darkNavBg: "5 40% 10%", darkNavFg: "5 15% 92%", darkBg: "5 25% 10%", darkFg: "5 15% 92%" },
  { id: "lavender-gold", label: "Lavender & Gold", category: "rotated",
    accent: "42 80% 48%", navBg: "270 35% 15%", navFg: "270 15% 92%", bg: "270 20% 96%", fg: "270 35% 18%",
    darkAccent: "270 50% 65%", darkNavBg: "42 40% 10%", darkNavFg: "42 15% 90%", darkBg: "42 20% 9%", darkFg: "42 15% 90%" },
  { id: "teal-peach", label: "Teal & Peach", category: "rotated",
    accent: "20 80% 55%", navBg: "175 45% 12%", navFg: "175 15% 92%", bg: "175 20% 96%", fg: "175 35% 14%",
    darkAccent: "175 50% 50%", darkNavBg: "20 40% 10%", darkNavFg: "20 15% 92%", darkBg: "20 25% 10%", darkFg: "20 15% 90%" },
  { id: "plum-lime", label: "Plum & Lime", category: "rotated",
    accent: "80 60% 40%", navBg: "300 35% 12%", navFg: "300 15% 92%", bg: "300 15% 96%", fg: "300 30% 16%",
    darkAccent: "300 45% 60%", darkNavBg: "80 35% 10%", darkNavFg: "80 15% 90%", darkBg: "80 20% 9%", darkFg: "80 15% 90%" },
  { id: "sunset", label: "Sunset", category: "rotated",
    accent: "25 90% 50%", navBg: "280 40% 12%", navFg: "280 15% 92%", bg: "15 30% 95%", fg: "280 35% 16%",
    darkAccent: "280 50% 60%", darkNavBg: "25 50% 10%", darkNavFg: "25 15% 90%", darkBg: "25 25% 9%", darkFg: "25 15% 90%" },
];

export function paletteFromId(id: string): CustomPalette | null {
  const found = MATERIAL_PALETTES.find((p) => p.id === id);
  if (!found) return null;
  const { id: _id, label: _label, category: _category, ...palette } = found;
  return palette;
}

/** What a user with no stored theme gets: the Frutiger Aero palette with the
 * glossy Vista flavor. Also the baseline the cross-device sync compares
 * against, so a fresh device adopts the user's saved theme instead of pushing this. */
export function defaultUserTheme(): UserTheme {
  return { palette: paletteFromId("frutiger-aero"), paletteId: "frutiger-aero", styleFlavor: "vista" };
}

const STORAGE_KEY = "cashflow-user-theme";
/** Snapshot of the computed CSS, read by the blocking script in __root.tsx. */
export const USER_THEME_VARS_STORAGE_KEY = "cashflow-user-theme-vars";
const ENGINE_STORAGE_KEY = "cashflow-theme-engine";

/** "simple" is the original engine: light/dark mode plus one accent color
 * (src/lib/theme.tsx, src/lib/accentColor.tsx). "advanced" layers this file's
 * palettes, flavors and preferences on top. Switching to "simple" applies
 * nothing from the advanced theme but keeps it stored, so switching back
 * restores it. */
export type ThemeEngine = "simple" | "advanced" | "aero" | "tui";
export const THEME_ENGINES: ThemeEngine[] = ["simple", "advanced", "aero", "tui"];

export function isThemeEngine(value: unknown): value is ThemeEngine {
  return typeof value === "string" && (THEME_ENGINES as string[]).includes(value);
}

const SAVED_THEMES_STORAGE_KEY = "cashflow-saved-themes";

// ── Color helpers ──────────────────────────────────────────────────────────

const hsl = (triplet: string) => `hsl(${triplet})`;

function lightnessOf(triplet: string): number {
  const parts = triplet.match(/[\d.]+/g);
  return parts && parts.length >= 3 ? parseFloat(parts[2]) / 100 : 0.5;
}

/** Black on light colors, white on dark ones (same threshold as the source). */
function contrastFor(triplet: string): string {
  return lightnessOf(triplet) > 0.35 ? "#111111" : "#ffffff";
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Shifts an "H S% L%" triplet by a palette adjustment; unchanged when there's nothing to do. */
function adjustTriplet(triplet: string, adjust: PaletteAdjust | null | undefined): string {
  if (!adjust) return triplet;
  const { hue = 0, saturation = 100, lightness = 0 } = adjust;
  if (hue === 0 && saturation === 100 && lightness === 0) return triplet;
  const parts = triplet.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return triplet;
  const h = (((parseFloat(parts[0]) + hue) % 360) + 360) % 360;
  const s = clamp((parseFloat(parts[1]) * saturation) / 100, 0, 100);
  const l = clamp(parseFloat(parts[2]) + lightness, 0, 100);
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

/** "#rrggbb" → "H S% L%" so the native color input can drive the palette. */
export function hexToHslTriplet(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** "H S% L%" → "#rrggbb", for seeding the native color input. */
export function hslTripletToHex(triplet: string): string {
  const parts = triplet.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return "#000000";
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// ── Engine ─────────────────────────────────────────────────────────────────

/** Every inline property this engine may set on <html>, so it can clear them all. */
const MANAGED_VARS = [
  "--bungalow-color-primary",
  "--bungalow-color-primary-contrast",
  "--bungalow-color-canvas",
  "--bungalow-color-ink",
  "--bungalow-color-muted",
  "--bungalow-color-surface",
  "--bungalow-color-surface-strong",
  "--chrome-bg",
  "--chrome-fg",
  "--chrome-fg-active",
  "--bungalow-color-secondary",
  "--bungalow-color-secondary-contrast",
  "--bungalow-color-tertiary",
  "--bungalow-color-tertiary-contrast",
  "--skeuo-btn-l-offset",
  "--bungalow-radius-sm",
  "--bungalow-radius-pill",
  "--bungalow-font-sans",
  "--button-text-transform",
  "--button-font-weight",
  "--font-weight",
  "--aero-tint",
  "--aero-accent",
  "--neon-glow",
  // src/lib/tuiTheme.ts, tuiVars()
  "--tui-background",
  "--tui-text",
  "--tui-bright",
  "--tui-dim",
  "--tui-line",
  "--tui-accent",
  "--tui-bar",
  "--tui-bar-text",
  "--tui-dialog",
  "--tui-dialog-text",
  "--tui-button",
  "--tui-button-text",
  "--tui-shadow",
  "--tui-text-glow",
  "--tui-line-glow",
  "--tui-element-glow",
];

export type ComputedVars = Record<string, string>;

/** Pure: which CSS custom properties a theme produces for light or dark. */
export function computeThemeVars(theme: UserTheme, isDark: boolean, accentOverridden: boolean): ComputedVars {
  const vars: ComputedVars = {};
  const p = theme.palette;

  // Shell (sidebar / tab bar / frame). "auto" keeps the stylesheet defaults.
  if (theme.shellStyle === "dark") {
    vars["--chrome-bg"] = "#000000";
    vars["--chrome-fg"] = "#f8f8f8";
    vars["--chrome-fg-active"] = "#ffffff";
  } else if (theme.shellStyle === "tinted") {
    vars["--chrome-bg"] = "color-mix(in srgb, var(--bungalow-color-ink) 6%, var(--bungalow-color-canvas))";
    vars["--chrome-fg"] = "var(--bungalow-color-muted)";
    vars["--chrome-fg-active"] = "var(--bungalow-color-ink)";
  }

  if (p) {
    const pick = (light?: string, dark?: string) => {
      const triplet = isDark ? dark || light : light;
      return triplet ? adjustTriplet(triplet, theme.paletteAdjust) : triplet;
    };
    const accent = pick(p.accent, p.darkAccent);
    const navBg = pick(p.navBg, p.darkNavBg);
    const navFg = pick(p.navFg, p.darkNavFg);
    const bg = pick(p.bg, p.darkBg);
    const fg = pick(p.fg, p.darkFg);

    // An explicit accent color from the accent picker wins over the palette's.
    if (accent && !accentOverridden) {
      vars["--bungalow-color-primary"] = hsl(accent);
      vars["--bungalow-color-primary-contrast"] = contrastFor(accent);
    }
    const secondary = pick(p.secondaryAccent, p.darkSecondaryAccent);
    const tertiary = pick(p.tertiaryAccent, p.darkTertiaryAccent);
    if (secondary) {
      vars["--bungalow-color-secondary"] = hsl(secondary);
      vars["--bungalow-color-secondary-contrast"] = contrastFor(secondary);
    }
    if (tertiary) {
      vars["--bungalow-color-tertiary"] = hsl(tertiary);
      vars["--bungalow-color-tertiary-contrast"] = contrastFor(tertiary);
    }
    if (navBg) {
      vars["--chrome-bg"] = hsl(navBg);
      vars["--chrome-fg-active"] = contrastFor(navBg);
    }
    if (navFg) vars["--chrome-fg"] = hsl(navFg);
    if (bg) vars["--bungalow-color-canvas"] = hsl(bg);
    if (fg) vars["--bungalow-color-ink"] = hsl(fg);
  }

  // Background tint / lightness only apply when the palette hasn't chosen a canvas.
  if (!vars["--bungalow-color-canvas"]) {
    const lightness = isDark ? theme.bgLightnessDark : theme.bgLightnessLight;
    const tint = theme.backgroundTint && theme.backgroundTint !== "none" ? theme.backgroundTint : null;
    if (tint || lightness != null) {
      const hue = tint ? TINT_HUE[tint] : 0;
      const sat = tint ? (TINT_BASE_SATURATION * (theme.tintSaturation ?? 100)) / 100 : 0;
      const l = lightness ?? (isDark ? 7 : 97);
      vars["--bungalow-color-canvas"] = `hsl(${hue} ${sat}% ${l}%)`;
    }
  }

  // Derive muted/surface tones from the (possibly new) canvas + ink so custom
  // backgrounds stay coherent instead of clashing with the stock greys.
  if (vars["--bungalow-color-canvas"] || vars["--bungalow-color-ink"]) {
    const canvas = "var(--bungalow-color-canvas)";
    const ink = "var(--bungalow-color-ink)";
    vars["--bungalow-color-surface"] = `color-mix(in srgb, ${ink} 5%, ${canvas})`;
    vars["--bungalow-color-surface-strong"] = `color-mix(in srgb, ${ink} 12%, ${canvas})`;
    vars["--bungalow-color-muted"] = `color-mix(in srgb, ${ink} 55%, ${canvas})`;
  }

  if (theme.cornerStyle === "sharp") {
    vars["--bungalow-radius-sm"] = "0rem";
    vars["--bungalow-radius-pill"] = "0rem";
  } else if (theme.cornerStyle === "semi") {
    vars["--bungalow-radius-sm"] = "0.375rem";
    vars["--bungalow-radius-pill"] = "0.375rem";
  }

  if (theme.skeuoBtnLightness != null) vars["--skeuo-btn-l-offset"] = String(theme.skeuoBtnLightness);

  if (theme.textTransform && theme.textTransform !== "none") vars["--button-text-transform"] = theme.textTransform;
  if (theme.buttonFontWeight != null) vars["--button-font-weight"] = String(theme.buttonFontWeight);
  if (theme.fontWeight != null) vars["--font-weight"] = String(theme.fontWeight);

  if (theme.neonGlow != null && theme.neonGlow !== 100) vars["--neon-glow"] = String(theme.neonGlow / 100);

  const font = FONT_OPTIONS.find((f) => f.id === theme.fontFamily);
  if (font?.value) vars["--bungalow-font-sans"] = font.value;

  if (theme.engine === "aero") {
    const { tint, accent } = resolveAeroColors(theme.aero);
    vars["--aero-tint"] = tint;
    vars["--aero-accent"] = accent;
    if (!font?.value) vars["--bungalow-font-sans"] = "'Plus Jakarta Sans', 'Segoe UI', Tahoma, Geneva, sans-serif";
  }

  if (theme.engine === "tui") Object.assign(vars, tuiVars(theme.tui));

  return vars;
}

function applyVars(vars: ComputedVars) {
  const style = document.documentElement.style;
  for (const name of MANAGED_VARS) {
    if (name in vars) style.setProperty(name, vars[name]);
    else style.removeProperty(name);
  }
}

/** Attributes for the shell preferences (see "Shell preferences" in styles.css). The dark
 * tab bar/frame options belong to the simple engine; the desktop layout applies to every engine. */
function shellAttributesFor(shell: ShellSettings | null | undefined, engine: ThemeEngine): Record<string, string | null> {
  const classic = shell?.desktopLayout === "classic";
  return {
    "data-dark-tab-bar": engine === "simple" && shell?.darkTabBar ? "" : null,
    "data-dark-frame": engine === "simple" && shell?.darkFrame ? "" : null,
    "data-desktop-layout": classic ? "classic" : null,
    "data-classic-frame": classic && shell?.classicFrame ? "" : null,
  };
}

/** Non-color attributes the stylesheet keys off (see "User theme engine" in styles.css). */
function attributesFor(theme: UserTheme, shell: Record<string, string | null> = {}): Record<string, string | null> {
  const flavor = theme.styleFlavor ?? "none";
  return {
    ...shell,
    "data-style-flavor": flavor === "none" ? null : flavor,
    "data-tactile": TACTILE_FLAVORS.includes(flavor) ? "" : null,
    "data-link-style": theme.linkStyle && theme.linkStyle !== "foreground" ? theme.linkStyle : null,
    "data-layout-style": theme.layoutStyle && theme.layoutStyle !== "app" ? theme.layoutStyle : null,
    "data-selection-style": theme.selectionStyle ?? null,
    "data-progress-color": theme.progressBarColor && theme.progressBarColor !== "default" ? theme.progressBarColor : null,
    "data-winui-classic": theme.fontFamily === "winui-classic" ? "" : null,
    "data-hide-borders": theme.hideBorders ? "" : null,
    "data-staggered-entries": theme.staggeredEntries ? "" : null,
    "data-theme-engine": theme.engine ?? null,
    "data-aero-ambient": theme.engine === "aero" && theme.aero?.ambient !== false ? "" : null,
    "data-aero-glass": theme.engine === "aero" && theme.aero?.glass !== false ? "" : null,
    "data-neon-scanlines": (flavor === "neon" && theme.neonScanlines) || (theme.engine === "tui" && theme.tui?.scanlines) ? "" : null,
    "data-tui-style": theme.engine === "tui" ? tuiStyleOf(theme.tui) : null,
    "data-pixel-font": theme.fontFamily === "unscii" ? "" : null,
  };
}

function applyAttributes(attributes: Record<string, string | null>, theme: UserTheme, isDark: boolean) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
  // Resolved light/dark (mode + OS preference), for CSS that can't use data-theme alone.
  root.setAttribute("data-color-scheme", isDark ? "dark" : "light");
  // WinUI Classic Mode forces an 11px base size, whatever the size preference says.
  const basePx = theme.fontFamily === "winui-classic" ? 11 : theme.fontSize;
  root.style.fontSize = basePx != null && basePx !== 16 ? `${(basePx / 16) * 100}%` : "";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function loadTheme(): UserTheme {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return defaultUserTheme();
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as UserTheme) : defaultUserTheme();
  } catch {
    return defaultUserTheme();
  }
}

/** Runs before first paint; mirrors applyVars()/applyAttributes() using the
 * snapshot written by the provider below. Keep in sync with both. */
export const USER_THEME_INIT_SCRIPT = `(function(){try{
  var raw=localStorage.getItem(${JSON.stringify(USER_THEME_VARS_STORAGE_KEY)});
  if(!raw)return;
  var s=JSON.parse(raw);
  var root=document.documentElement;
  if(s.mode==="light"||s.mode==="dark")root.setAttribute("data-theme",s.mode);
  else if(s.mode==="system")root.removeAttribute("data-theme");
  var t=root.getAttribute("data-theme");
  var dark=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
  var vars=dark?s.dark:s.light;
  for(var k in vars)root.style.setProperty(k,vars[k]);
  if(s.fontSize)root.style.fontSize=s.fontSize;
  for(var a in s.attrs){if(s.attrs[a]!==null)root.setAttribute(a,s.attrs[a]);}
  root.setAttribute("data-color-scheme",dark?"dark":"light");
}catch(e){}})();`;

// ── Saved themes (named snapshots) ─────────────────────────────────────────

export interface SavedTheme {
  id: string;
  name: string;
  theme: UserTheme;
  createdAt: string;
}

function loadSavedThemes(): SavedTheme[] {
  try {
    const raw = window.localStorage.getItem(SAVED_THEMES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Shareable string for a theme (base64 JSON, like the source's ?theme= param). */
export function encodeTheme(theme: UserTheme): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(theme))));
}

export function decodeTheme(encoded: string): UserTheme | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(encoded.trim()))));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as UserTheme) : null;
  } catch {
    return null;
  }
}

// ── Provider ───────────────────────────────────────────────────────────────

interface UserThemeValue {
  engine: ThemeEngine;
  setEngine: (engine: ThemeEngine) => void;
  userTheme: UserTheme;
  /** Merges a partial change into the current theme. */
  updateUserTheme: (partial: Partial<UserTheme>) => void;
  /** Replaces the whole theme (e.g. loading a saved or imported one). */
  replaceUserTheme: (theme: UserTheme) => void;
  resetUserTheme: () => void;
  savedThemes: SavedTheme[];
  saveCurrentTheme: (name: string) => void;
  deleteSavedTheme: (id: string) => void;
  /** The theme the site served here sets (sites.tsx), whether or not it is applied right now. */
  siteTheme: SiteTheme | null;
  /** True while the visitor uses their own theme on a site that lets them (SiteTheme.allowPersonal). */
  usingPersonalTheme: boolean;
  /** Switches between the site's theme and the visitor's own, remembered per site on this device. */
  setUsingPersonalTheme: (on: boolean) => void;
  /** The shell preferences in effect here, the site's defaults and locks applied. */
  preferences: EffectivePreferences;
}

const personalThemeKey = (siteId: string) => namespaced(`site-theme:personal:${siteId}`);

const UserThemeContext = createContext<UserThemeValue | null>(null);

export function UserThemeProvider({ children }: { children: ReactNode }) {
  const { theme: mode, setTheme: setMode } = useTheme();
  const { accentColor, setAccentColor } = useAccentColor();
  // Empty on first render so server and client markup match; the blocking
  // script already applied the stored theme's variables before hydration.
  const [userTheme, setUserTheme] = useState<UserTheme>({});
  const [engine, setEngineState] = useState<ThemeEngine>("advanced");
  const [savedThemes, setSavedThemes] = useState<SavedTheme[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setUserTheme(loadTheme());
    try {
      const storedEngine = window.localStorage.getItem(ENGINE_STORAGE_KEY);
      if (isThemeEngine(storedEngine)) setEngineState(storedEngine);
    } catch {
      /* default engine */
    }
    setSavedThemes(loadSavedThemes());
    setSystemDark(systemPrefersDark());
    setHydrated(true);
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Cross-device sync via public.user_themes (see src/hooks/useUserThemeSync.ts).
  useUserThemeSync({
    ready: hydrated,
    current: { mode, accentColor, engine, theme: userTheme, savedThemes },
    adopt: (remote) => {
      const store = (key: string, value: unknown) => {
        try {
          window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* ignore */
        }
      };
      if (remote.mode) setMode(remote.mode);
      if (remote.accentColor !== undefined) setAccentColor(remote.accentColor);
      if (remote.engine) {
        try {
          window.localStorage.setItem(ENGINE_STORAGE_KEY, remote.engine);
        } catch {
          /* ignore */
        }
        setEngineState(remote.engine);
      }
      if (remote.theme) {
        store(STORAGE_KEY, remote.theme);
        setUserTheme(remote.theme);
      }
      if (remote.savedThemes) {
        store(SAVED_THEMES_STORAGE_KEY, remote.savedThemes);
        setSavedThemes(remote.savedThemes);
      }
    },
  });

  const router = useRouter();
  // A site served on this domain (src/lib/sites.tsx) can bring its own theme, colour scheme, accent
  // and base layout, which replace the visitor's while they're on it; their own settings stay
  // stored as they are. A site that allows it lets the visitor switch back to their own theme.
  const { site } = useSite();
  const siteId = site?.id ?? null;
  const declaredSiteTheme = site?.theme ?? null;
  const [personalOnSite, setPersonalOnSite] = useState(false);
  useEffect(() => {
    try {
      setPersonalOnSite(!!siteId && window.localStorage.getItem(personalThemeKey(siteId)) === "true");
    } catch {
      setPersonalOnSite(false);
    }
  }, [siteId]);
  const usingPersonalTheme = !!declaredSiteTheme?.allowPersonal && personalOnSite;
  const siteTheme = usingPersonalTheme ? null : declaredSiteTheme;
  const siteLayout = site?.layout;
  const appliedEngine = siteTheme?.engine ?? engine;
  const appliedTheme = useMemo<UserTheme>(() => {
    if (!siteTheme?.engine) return userTheme;
    const theme = siteTheme.theme ?? {};
    // A site may name its palette only by id.
    return !theme.palette && theme.paletteId ? { ...theme, palette: paletteFromId(theme.paletteId) } : theme;
  }, [siteTheme, userTheme]);
  // The site's colour scheme wins over the visitor's light/dark choice (theme.tsx).
  const siteMode = siteTheme?.mode ?? null;
  useEffect(() => {
    setForcedTheme(siteMode);
  }, [siteMode]);
  // The site's accent, else the visitor's when the site leaves the theme to them.
  const effectiveAccent = siteTheme?.accentColor ?? (siteTheme?.engine ? null : accentColor);
  // What actually gets applied: nothing from the advanced theme in simple mode,
  // and only what the aero/TUI engine derives from its own settings in those modes.
  const activeTheme = useMemo<UserTheme>(() => {
    const base =
      appliedEngine === "advanced"
        ? appliedTheme
        : appliedEngine === "aero"
          ? aeroUserTheme(appliedTheme.aero)
          : appliedEngine === "tui"
            ? tuiUserTheme(appliedTheme.tui)
            : {};
    // The site's layout style: locked, or a default where the theme sets none.
    const layoutStyle = resolveSitePreference(siteLayout, "layoutStyle", base.layoutStyle);
    return layoutStyle ? { ...base, layoutStyle } : base;
  }, [appliedEngine, appliedTheme, siteLayout]);
  const viewTransitions = !!activeTheme.viewTransitions;

  // TanStack Router wraps navigations in document.startViewTransition() when
  // this option is on (the keyframes live in styles.css).
  useEffect(() => {
    router.update({ ...router.options, defaultViewTransition: viewTransitions });
    setNavigationViewTransitions(viewTransitions);
  }, [router, viewTransitions]);

  const effectiveMode = siteMode ?? mode;
  const isDark = effectiveMode === "dark" || (effectiveMode === "system" && systemDark);
  const preferences = useMemo<EffectivePreferences>(() => {
    const own = userTheme.shell ?? {};
    // The classic layout's frame goes with whichever desktop layout is in effect.
    const siteDesktop = sitePreferenceValue(siteLayout, "desktopLayout");
    const desktopFromSite = siteDesktop !== undefined && (isSitePreferenceLocked(siteLayout, "desktopLayout") || own.desktopLayout === undefined);
    return {
      ...own,
      desktopLayout: desktopFromSite ? siteDesktop : own.desktopLayout,
      classicFrame: desktopFromSite ? !!siteLayout?.classicFrame : own.classicFrame,
      darkTabBar: resolveSitePreference(siteLayout, "darkTabBar", own.darkTabBar),
      darkFrame: resolveSitePreference(siteLayout, "darkFrame", own.darkFrame),
      savedIcon: resolveSitePreference(siteLayout, "savedIcon", own.savedIcon),
      player: resolveSitePreference(siteLayout, "player", own.player),
      hideSoftDeletedEntities: resolveSitePreference(siteLayout, "hideSoftDeletedEntities", userTheme.hideSoftDeletedEntities),
      hideFutureEntities: resolveSitePreference(siteLayout, "hideFutureEntities", userTheme.hideFutureEntities),
    };
  }, [userTheme.shell, userTheme.hideSoftDeletedEntities, userTheme.hideFutureEntities, siteLayout]);
  const shell = preferences;

  useEffect(() => {
    if (!hydrated) return;
    // A site's theme wins over the visitor's own accent color, and the TUI engine has its own
    // accent among its colours.
    const accentOverridden = effectiveAccent != null && appliedEngine !== "tui";
    // applyVars() clears every managed property it isn't given, --bungalow-color-primary
    // included, so the chosen accent has to be part of the vars or any settings change
    // would reset it to the default.
    const varsFor = (dark: boolean): ComputedVars => {
      const vars = computeThemeVars(activeTheme, dark, accentOverridden);
      if (accentOverridden && effectiveAccent) {
        delete vars["--bungalow-color-primary-contrast"];
        Object.assign(vars, accentColorVars(effectiveAccent));
      }
      return vars;
    };
    const attributes = attributesFor(activeTheme, shellAttributesFor(shell, appliedEngine));
    applyVars(varsFor(isDark));
    applyAttributes(attributes, activeTheme, isDark);
    try {
      window.localStorage.setItem(
        USER_THEME_VARS_STORAGE_KEY,
        JSON.stringify({
          light: varsFor(false),
          dark: varsFor(true),
          fontSize: document.documentElement.style.fontSize,
          attrs: attributes,
          // The site's colour scheme, applied by the blocking script before first paint.
          mode: siteMode,
        }),
      );
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
  }, [hydrated, activeTheme, isDark, effectiveAccent, shell, appliedEngine, siteMode]);

  const value = useMemo<UserThemeValue>(() => {
    const persist = (next: UserTheme) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      setUserTheme(next);
    };
    const persistSaved = (next: SavedTheme[]) => {
      try {
        window.localStorage.setItem(SAVED_THEMES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      setSavedThemes(next);
    };
    return {
      engine,
      setEngine: (next) => {
        try {
          window.localStorage.setItem(ENGINE_STORAGE_KEY, next);
        } catch {
          /* ignore */
        }
        setEngineState(next);
      },
      userTheme,
      updateUserTheme: (partial) => persist({ ...userTheme, ...partial }),
      // The aero and TUI engines' settings and the shell preferences ride along on the same
      // object; loading or resetting an advanced theme keeps them.
      replaceUserTheme: (next) => persist({ aero: userTheme.aero, tui: userTheme.tui, shell: userTheme.shell, ...next }),
      resetUserTheme: () => persist({ ...defaultUserTheme(), aero: userTheme.aero, tui: userTheme.tui, shell: userTheme.shell }),
      savedThemes,
      saveCurrentTheme: (name) =>
        persistSaved([
          { id: crypto.randomUUID(), name, theme: userTheme, createdAt: new Date().toISOString() },
          ...savedThemes,
        ]),
      deleteSavedTheme: (id) => persistSaved(savedThemes.filter((s) => s.id !== id)),
      siteTheme: declaredSiteTheme,
      usingPersonalTheme,
      setUsingPersonalTheme: (on) => {
        if (!siteId) return;
        try {
          if (on) window.localStorage.setItem(personalThemeKey(siteId), "true");
          else window.localStorage.removeItem(personalThemeKey(siteId));
        } catch {
          /* still switches for this visit */
        }
        setPersonalOnSite(on);
      },
      preferences,
    };
  }, [engine, userTheme, savedThemes, declaredSiteTheme, usingPersonalTheme, siteId, preferences]);

  return <UserThemeContext.Provider value={value}>{children}</UserThemeContext.Provider>;
}

export function useUserTheme(): UserThemeValue {
  const ctx = useContext(UserThemeContext);
  if (!ctx) throw new Error("useUserTheme must be used inside UserThemeProvider");
  return ctx;
}

/** useUserTheme() outside a UserThemeProvider is null rather than an error. */
export function useOptionalUserTheme(): UserThemeValue | null {
  return useContext(UserThemeContext);
}

// ── Theme editor ───────────────────────────────────────────────────────────

/**
 * What the theme settings (AppearanceSettings, AeroThemeSettings, TuiThemeSettings) edit: the
 * visitor's own theme by default, or, inside a ThemeEditorProvider, another one such as a site's.
 * Without `saveCurrentTheme`/`deleteSavedTheme` the saved themes can only be applied.
 */
export interface ThemeEditor {
  userTheme: UserTheme;
  updateUserTheme: (partial: Partial<UserTheme>) => void;
  replaceUserTheme: (theme: UserTheme) => void;
  resetUserTheme: () => void;
  savedThemes: SavedTheme[];
  saveCurrentTheme?: (name: string) => void;
  deleteSavedTheme?: (id: string) => void;
}

const ThemeEditorContext = createContext<ThemeEditor | null>(null);

/** Points the theme settings inside it at `value` instead of the visitor's own theme. */
export function ThemeEditorProvider({ value, children }: { value: ThemeEditor; children: ReactNode }) {
  return <ThemeEditorContext.Provider value={value}>{children}</ThemeEditorContext.Provider>;
}

export function useThemeEditor(): ThemeEditor {
  const own = useUserTheme();
  return useContext(ThemeEditorContext) ?? own;
}
