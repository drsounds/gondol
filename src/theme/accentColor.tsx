import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "cashflow-accent-color";

/** Kept in sync with the inline blocking script in src/routes/__root.tsx, which
 * applies the stored accent color to <html> before first paint to avoid a flash. */
export const ACCENT_COLOR_STORAGE_KEY = STORAGE_KEY;

/** Matches the default --bungalow-color-primary in theme.css. */
export const DEFAULT_ACCENT_COLOR = "#dbbb67";

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function detectAccentColor(): string | null {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && HEX_COLOR_RE.test(stored) ? stored : null;
}

/** True once browsers ship the CSS contrast-color() function (see theme.css),
 * which then picks black/white text for the accent on its own. Until then we
 * compute the same WCAG-style pick in JS so custom accents stay readable. */
const supportsCssContrastColor =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", "contrast-color(#fff)");

function relativeLuminance(hex: string): number {
  const toLinear = (channel8bit: number) => {
    const c = channel8bit / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(parseInt(hex.slice(1, 3), 16));
  const g = toLinear(parseInt(hex.slice(3, 5), 16));
  const b = toLinear(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Same black-vs-white pick that CSS contrast-color() makes: whichever gives
 * the higher WCAG contrast ratio against the given color. */
function pickContrastColor(hex: string): "#111111" | "#ffffff" {
  const luminance = relativeLuminance(hex);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? "#ffffff" : "#111111";
}

/** The inline properties an accent color sets on <html>. The user theme engine
 * (src/lib/userTheme.tsx) manages the same properties, so it includes these when
 * an accent is chosen instead of clearing them on every settings change. */
export function accentColorVars(color: string): Record<string, string> {
  const vars: Record<string, string> = { "--bungalow-color-primary": color };
  if (!supportsCssContrastColor) vars["--bungalow-color-primary-contrast"] = pickContrastColor(color);
  return vars;
}

function applyAccentColor(color: string | null) {
  const root = document.documentElement.style;
  if (color) {
    for (const [name, value] of Object.entries(accentColorVars(color))) root.setProperty(name, value);
  } else {
    root.removeProperty("--bungalow-color-primary");
    root.removeProperty("--bungalow-color-primary-contrast");
  }
}

interface AccentColorValue {
  /** null means "use the design system default", not a color value. */
  accentColor: string | null;
  setAccentColor: (color: string | null) => void;
}

const AccentColorContext = createContext<AccentColorValue | null>(null);

export function AccentColorProvider({ children }: { children: ReactNode }) {
  // Start on null so server and client markup match; the blocking inline
  // script already applied the stored color to <html> before this component
  // mounts, so we only need to adopt it into React state here without
  // touching the DOM again.
  const [accentColor, setAccentColorState] = useState<string | null>(null);
  const skipNextApply = useRef(true);

  useEffect(() => {
    setAccentColorState(detectAccentColor());
  }, []);

  useEffect(() => {
    if (skipNextApply.current) {
      skipNextApply.current = false;
      return;
    }
    applyAccentColor(accentColor);
  }, [accentColor]);

  const value = useMemo<AccentColorValue>(
    () => ({
      accentColor,
      setAccentColor: (next) => {
        if (next) window.localStorage.setItem(STORAGE_KEY, next);
        else window.localStorage.removeItem(STORAGE_KEY);
        setAccentColorState(next);
      },
    }),
    [accentColor],
  );

  return <AccentColorContext.Provider value={value}>{children}</AccentColorContext.Provider>;
}

export function useAccentColor(): AccentColorValue {
  const ctx = useContext(AccentColorContext);
  if (!ctx) throw new Error("useAccentColor must be used inside AccentColorProvider");
  return ctx;
}
