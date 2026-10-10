import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type Theme = "system" | "light" | "dark";

export const THEMES: Theme[] = ["system", "light", "dark"];

const STORAGE_KEY = "cashflow-theme";

/** Kept in sync with the inline blocking script in src/routes/__root.tsx, which
 * applies the stored preference to <html> before first paint to avoid a flash. */
export const THEME_STORAGE_KEY = STORAGE_KEY;

/** Must match --bungalow-color-canvas's light/dark values in styles.css and
 * theme.css — this is what the browser's own UI (Safari's status bar, Chrome's
 * Android toolbar) is tinted to match. Also mirrored in the inline blocking
 * script in src/routes/__root.tsx, which sets the initial <meta name="theme-color">
 * before first paint. */
export const THEME_COLOR_LIGHT = "#ffffff";
export const THEME_COLOR_DARK = "#111111";

function storedTheme(): Theme | null {
  const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  return stored && THEMES.includes(stored) ? stored : null;
}

function effectiveThemeColor(theme: Theme): string {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return dark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}

function applyThemeColor(theme: Theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", effectiveThemeColor(theme));
}

/** A colour scheme the site served here sets (sites.tsx, SiteTheme.mode), which wins over the visitor's. */
let forcedTheme: Theme | null = null;
let lastTheme: Theme = "system";

/**
 * Sets (or with null, lifts) the site's colour scheme. While one is set the visitor's own choice
 * stays stored, but isn't applied.
 */
export function setForcedTheme(theme: Theme | null) {
  if (theme === forcedTheme) return;
  forcedTheme = theme;
  applyTheme(lastTheme);
}

function applyTheme(chosen: Theme) {
  lastTheme = chosen;
  const theme = forcedTheme ?? chosen;
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  applyThemeColor(theme);
}

interface ThemeValue {
  theme: Theme;
  /** Whether the visitor has picked a colour scheme themselves (a site's default yields to it). */
  chosen: boolean;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start on "system" so server and client markup match; the blocking inline
  // script already applied the stored preference to <html> before this
  // component mounts, so we only need to adopt it into React state here
  // without touching the DOM again (that would flash back to "system").
  const [theme, setThemeState] = useState<Theme>("system");
  const [chosen, setChosen] = useState(false);
  const skipNextApply = useRef(true);

  useEffect(() => {
    const stored = storedTheme();
    lastTheme = stored ?? "system";
    setThemeState(stored ?? "system");
    setChosen(stored != null);
  }, []);

  useEffect(() => {
    if (skipNextApply.current) {
      skipNextApply.current = false;
      return;
    }
    applyTheme(theme);
  }, [theme]);

  // In "system" mode, keep the browser-chrome tint in step with live OS
  // light/dark switches (media-query-based CSS already does this for
  // on-page colors; the theme-color meta tag needs the same treatment by hand).
  useEffect(() => {
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeColor(forcedTheme ?? theme);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      chosen,
      setTheme: (next) => {
        window.localStorage.setItem(STORAGE_KEY, next);
        setThemeState(next);
        setChosen(true);
      },
    }),
    [theme, chosen],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
