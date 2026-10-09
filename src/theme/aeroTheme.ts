import { hexToHslTriplet, type CustomPalette, type UserTheme } from "./userTheme";

/**
 * 3D Frutiger Aero theme engine, ported from drsounds/space-chat (its "Bungalow
 * Aero Glass & Glossy Chrome" stylesheet and the footer's "Taste" tint engine).
 * Selected as its own engine next to "simple" and "advanced" (see ThemeEngine in
 * src/lib/userTheme.tsx). The source app is dark-only; here dark mode is its deep
 * navy glass and light mode a bright sky-glass variant of the same look.
 *
 * Settings live on UserTheme.aero, so they sync across devices with the rest of
 * the appearance settings. The engine turns them into an ordinary UserTheme
 * (palette + font) plus `engine: "aero"`, which makes userTheme.tsx set
 * data-theme-engine="aero" and the --aero-* variables that
 * src/styles/aero.css keys off.
 */

export interface AeroTaste {
  id: string;
  label: string;
  /** "#rrggbb": surfaces, glows and the primary color. */
  tint: string;
  /** "#rrggbb": secondary accent and the second glow. */
  accent: string;
}

/** The space-chat taste presets, unchanged. */
export const AERO_TASTES: AeroTaste[] = [
  { id: "aero-cyan", label: "Aero Cyan (WMP1X)", tint: "#00a2ed", accent: "#38bdf8" },
  { id: "spot-green", label: "Spot 09 Emerald", tint: "#1ed760", accent: "#10b981" },
  { id: "wmp-cobalt", label: "WMP Cobalt Blue", tint: "#2563eb", accent: "#3b82f6" },
  { id: "amethyst", label: "Amethyst Glass", tint: "#9333ea", accent: "#a855f7" },
  { id: "obsidian", label: "Obsidian Noir", tint: "#475569", accent: "#64748b" },
];

export interface AeroSettings {
  /** An AERO_TASTES id, or "custom" to use `tint`/`accent`. */
  taste?: string;
  tint?: string;
  accent?: string;
  /** Ambient glows and glossy bubbles behind the panels. Default on. */
  ambient?: boolean;
  /** Frosted, translucent panels. Off gives solid panels with the same gloss. Default on. */
  glass?: boolean;
}

export const DEFAULT_AERO_TASTE = AERO_TASTES[0];

/** The tint/accent pair a settings object resolves to. */
export function resolveAeroColors(settings: AeroSettings | null | undefined): { tint: string; accent: string } {
  if (settings?.taste === "custom" && settings.tint) {
    return { tint: settings.tint, accent: settings.accent ?? settings.tint };
  }
  const taste = AERO_TASTES.find((t) => t.id === settings?.taste) ?? DEFAULT_AERO_TASTE;
  return { tint: taste.tint, accent: taste.accent };
}

function parts(triplet: string): [number, number, number] {
  const [h, s, l] = (triplet.match(/[\d.]+/g) ?? ["0", "0", "50"]).map(Number);
  return [h, s, l];
}

/** Light: sky-glass surfaces in the tint's hue. Dark: space-chat's deep navy glass, nudged toward the tint. */
function aeroPalette(tint: string, accent: string): CustomPalette {
  const tintT = hexToHslTriplet(tint);
  const accentT = hexToHslTriplet(accent);
  const [h, s] = parts(tintT);
  // Greyish tastes (Obsidian) stay greyish instead of being boosted to a saturated sky.
  const light = Math.min(s, 70);
  const dark = Math.min(s, 45);
  // space-chat's background is #0a0e17 (222° 39% 6%); keep that navy base and lean toward the tint.
  const darkHue = Math.round(222 + (((h - 222 + 540) % 360) - 180) * 0.35 + 360) % 360;
  return {
    accent: tintT,
    secondaryAccent: accentT,
    tertiaryAccent: accentT,
    navBg: `${h} ${light}% 90%`,
    navFg: `${h} ${Math.min(s, 60)}% 18%`,
    bg: `${h} ${light}% 97%`,
    fg: `${h} ${Math.min(s, 50)}% 12%`,
    darkAccent: accentT,
    darkSecondaryAccent: accentT,
    darkTertiaryAccent: tintT,
    darkNavBg: `${darkHue} ${dark}% 6%`,
    darkNavFg: "215 25% 80%",
    darkBg: `${darkHue} ${dark}% 11%`,
    darkFg: "210 40% 96%",
  };
}

/** What the aero engine actually applies, derived from the stored settings. */
export function aeroUserTheme(settings: AeroSettings | null | undefined): UserTheme {
  const { tint, accent } = resolveAeroColors(settings);
  return { engine: "aero", aero: settings ?? {}, palette: aeroPalette(tint, accent) };
}
