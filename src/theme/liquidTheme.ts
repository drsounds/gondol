import { hexToHslTriplet, type CustomPalette, type UserTheme } from "./userTheme";

/**
 * Liquid theme engine: Apple's "Liquid Glass" look. Every surface (panels, buttons, chips,
 * fields, sheets, the floating phone tab bar) is a sheet of glass over one background image, with
 * a specular rim and a sheen that follow the light as the content scrolls.
 *
 * Settings live on UserTheme.liquid, so they sync with the rest of the appearance settings.
 * liquidUserTheme() turns them into an ordinary UserTheme (palette) plus `engine: "liquid"`,
 * which makes userTheme.tsx set data-theme-engine="liquid" and the --liquid-* variables from
 * liquidVars() that src/styles/liquid.css keys off. The background and the frosted backdrop of
 * the big shell panels are drawn on a canvas by <LiquidBackdrop/> (LiquidBackdrop.tsx), which
 * also moves the light (--liquid-angle, --liquid-lx, --liquid-ly) as anything scrolls.
 */

/** A built-in background, painted on a canvas: soft blobs of colour on a base, like a wallpaper. */
export interface LiquidBackground {
  id: string;
  label: string;
  /** "#rrggbb" base, light and dark. */
  base: [string, string];
  /** Blobs: colour, centre (0–1) and radius (fraction of the longer side). */
  blobs: { color: string; x: number; y: number; r: number }[];
}

export const LIQUID_BACKGROUNDS: LiquidBackground[] = [
  {
    id: "lagoon",
    label: "Lagoon",
    base: ["#dff3ff", "#04121f"],
    blobs: [
      { color: "#2ec5ff", x: 0.15, y: 0.2, r: 0.55 },
      { color: "#7b61ff", x: 0.85, y: 0.15, r: 0.45 },
      { color: "#00d6a3", x: 0.7, y: 0.9, r: 0.55 },
      { color: "#ff7ac6", x: 0.25, y: 0.85, r: 0.35 },
    ],
  },
  {
    id: "sunset",
    label: "Sunset",
    base: ["#fff1e6", "#1a0710"],
    blobs: [
      { color: "#ff8a3d", x: 0.2, y: 0.25, r: 0.5 },
      { color: "#ff3d77", x: 0.8, y: 0.3, r: 0.5 },
      { color: "#8f4dff", x: 0.55, y: 0.95, r: 0.55 },
      { color: "#ffd166", x: 0.05, y: 0.9, r: 0.35 },
    ],
  },
  {
    id: "aurora",
    label: "Aurora",
    base: ["#e9fff5", "#020b12"],
    blobs: [
      { color: "#22e3a0", x: 0.25, y: 0.1, r: 0.5 },
      { color: "#1a8cff", x: 0.9, y: 0.45, r: 0.5 },
      { color: "#b44dff", x: 0.15, y: 0.75, r: 0.45 },
      { color: "#00f0ff", x: 0.65, y: 1, r: 0.4 },
    ],
  },
  {
    id: "meadow",
    label: "Meadow",
    base: ["#f4fbe8", "#07120a"],
    blobs: [
      { color: "#a3e635", x: 0.2, y: 0.3, r: 0.5 },
      { color: "#34d399", x: 0.85, y: 0.2, r: 0.45 },
      { color: "#facc15", x: 0.75, y: 0.9, r: 0.4 },
      { color: "#22d3ee", x: 0.1, y: 0.95, r: 0.4 },
    ],
  },
  {
    id: "graphite",
    label: "Graphite",
    base: ["#eceef2", "#0b0c0f"],
    blobs: [
      { color: "#94a3b8", x: 0.2, y: 0.2, r: 0.5 },
      { color: "#cbd5e1", x: 0.85, y: 0.35, r: 0.45 },
      { color: "#64748b", x: 0.6, y: 0.95, r: 0.5 },
    ],
  },
];

export const DEFAULT_LIQUID_BACKGROUND = LIQUID_BACKGROUNDS[0];

export interface LiquidSettings {
  /** A LIQUID_BACKGROUNDS id, or "custom" for `backgroundUrl` / `backgroundMediaId`. */
  background?: string;
  /** An http(s) image address (custom background). */
  backgroundUrl?: string | null;
  /** An image of the host's media library (custom background); wins over backgroundUrl while it resolves. */
  backgroundMediaId?: string | null;
  /** How much the background is dimmed (dark) or washed out (light), 0–100. Default 0. */
  backgroundDim?: number;
  /** Glass strength: blur, refraction and how bright the rims are, 0–100. Default 60. */
  strength?: number;
  /** How opaque the glass is, 0–100. Default 35. */
  opacity?: number;
  /** "#rrggbb" the glass is tinted with; unset = clear glass. */
  tint?: string | null;
  /** How strongly the tint colours the glass, 0–100. Default 25. */
  tintAmount?: number;
  /** The rims and sheen catch the light as the content scrolls. Default on. */
  reflections?: boolean;
}

export const LIQUID_DEFAULTS = { strength: 60, opacity: 35, tintAmount: 25, backgroundDim: 0 } as const;

/** Apple's system blue, the accent when the glass has no tint. */
const LIQUID_ACCENT = "#0a84ff";

const clamp = (value: number | null | undefined, fallback: number) =>
  Math.max(0, Math.min(100, typeof value === "number" && Number.isFinite(value) ? value : fallback));

export function liquidStrength(settings: LiquidSettings | null | undefined): number {
  return clamp(settings?.strength, LIQUID_DEFAULTS.strength);
}
export function liquidOpacity(settings: LiquidSettings | null | undefined): number {
  return clamp(settings?.opacity, LIQUID_DEFAULTS.opacity);
}
export function liquidTintAmount(settings: LiquidSettings | null | undefined): number {
  return settings?.tint ? clamp(settings?.tintAmount, LIQUID_DEFAULTS.tintAmount) : 0;
}
export function liquidBackgroundDim(settings: LiquidSettings | null | undefined): number {
  return clamp(settings?.backgroundDim, LIQUID_DEFAULTS.backgroundDim);
}

export function liquidBackgroundOf(settings: LiquidSettings | null | undefined): LiquidBackground {
  return LIQUID_BACKGROUNDS.find((b) => b.id === settings?.background) ?? DEFAULT_LIQUID_BACKGROUND;
}

/** Whether the settings use a custom image (an address or a media library image). */
export function liquidUsesCustomBackground(settings: LiquidSettings | null | undefined): boolean {
  return settings?.background === "custom" && !!(settings.backgroundUrl || settings.backgroundMediaId);
}

/** Light: near-white glass and near-black ink. Dark: smoked glass and white ink. The tint, when
 * set, is the accent too. */
function liquidPalette(tint: string | null | undefined): CustomPalette {
  const accent = hexToHslTriplet(tint || LIQUID_ACCENT);
  return {
    accent,
    secondaryAccent: accent,
    tertiaryAccent: accent,
    navBg: "0 0% 100%",
    navFg: "240 6% 12%",
    bg: "0 0% 100%",
    fg: "240 6% 10%",
    darkAccent: accent,
    darkSecondaryAccent: accent,
    darkTertiaryAccent: accent,
    darkNavBg: "240 5% 12%",
    darkNavFg: "0 0% 96%",
    darkBg: "240 5% 12%",
    darkFg: "0 0% 98%",
  };
}

/** What the liquid engine actually applies, derived from the stored settings. */
export function liquidUserTheme(settings: LiquidSettings | null | undefined): UserTheme {
  return { engine: "liquid", liquid: settings ?? {}, palette: liquidPalette(settings?.tint) };
}

/** The --liquid-* variables liquid.css reads. */
export function liquidVars(settings: LiquidSettings | null | undefined): Record<string, string> {
  const strength = liquidStrength(settings) / 100;
  const opacity = liquidOpacity(settings);
  return {
    "--liquid-blur": `${(2 + strength * 22).toFixed(1)}px`,
    "--liquid-saturate": `${Math.round(110 + strength * 80)}%`,
    "--liquid-rim": (0.25 + strength * 0.65).toFixed(2),
    "--liquid-fill": `${opacity}%`,
    "--liquid-tint": settings?.tint || "#ffffff",
    "--liquid-tint-amount": `${liquidTintAmount(settings)}%`,
  };
}
