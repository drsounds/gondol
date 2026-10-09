import { hexToHslTriplet, type CustomPalette, type UserTheme } from "./userTheme";

/**
 * TUI theme engine: the app as a text-mode program, set in the bundled Unscii terminal font
 * (src/assets/fonts). Selected as its own engine next to "simple", "advanced" and "aero" (see
 * ThemeEngine in src/lib/userTheme.tsx). Two looks:
 *
 * - "dos": MS-DOS EDIT / QBasic. A blue screen, a grey menu bar and status bar, windows framed
 *   with double lines, grey dialog boxes with a hard black drop shadow, buttons as `< OK >`.
 * - "mainframe": an IBM 3270 terminal. Green phosphor on black, single-line frames, underlined
 *   input fields, upper-case headings and reverse-video highlights.
 *
 * Every colour can be changed, and lines, text and the other elements (buttons, fields, badges,
 * icons) each have their own glow strength. Settings live on UserTheme.tui, so they sync across
 * devices with the rest of the appearance settings. The engine turns them into an ordinary
 * UserTheme (palette, Unscii font, sharp corners) plus `engine: "tui"`, which makes userTheme.tsx
 * set data-theme-engine="tui", data-tui-style and the --tui-* variables that src/styles/tui.css
 * keys off.
 */

export type TuiStyle = "dos" | "mainframe";
export const TUI_STYLES: TuiStyle[] = ["dos", "mainframe"];

/** Every colour of the engine, "#rrggbb". */
export interface TuiColors {
  /** The screen behind everything. */
  background: string;
  /** Ordinary text. */
  text: string;
  /** Headings, names and highlighted text. */
  bright: string;
  /** Muted text: labels, notes, column headers. */
  dim: string;
  /** Box-drawing lines: frames, rules, borders. */
  line: string;
  /** Selection, focus and primary buttons (drawn in reverse video). */
  accent: string;
  /** Menu bar and status bar background. */
  bar: string;
  /** Menu bar and status bar text. */
  barText: string;
  /** Dialog box (sheet) background. */
  dialog: string;
  /** Dialog box text. */
  dialogText: string;
  /** Buttons. */
  button: string;
  /** Button text. */
  buttonText: string;
  /** Hard drop shadow under dialogs and buttons. */
  shadow: string;
}

export const TUI_COLOR_KEYS: (keyof TuiColors)[] = [
  "background",
  "text",
  "bright",
  "dim",
  "line",
  "accent",
  "bar",
  "barText",
  "dialog",
  "dialogText",
  "button",
  "buttonText",
  "shadow",
];

/** The 16-colour CGA/EGA text-mode palette EDIT.COM draws with. */
export const DOS_COLORS: TuiColors = {
  background: "#0000aa",
  text: "#aaaaaa",
  bright: "#ffffff",
  dim: "#55ffff",
  line: "#aaaaaa",
  accent: "#00aaaa",
  bar: "#aaaaaa",
  barText: "#000000",
  dialog: "#aaaaaa",
  dialogText: "#000000",
  button: "#aaaaaa",
  buttonText: "#000000",
  shadow: "#000000",
};

/** IBM 3270: green phosphor, turquoise input fields, white intensified text. */
export const MAINFRAME_COLORS: TuiColors = {
  background: "#000000",
  text: "#33ff66",
  bright: "#ffffff",
  dim: "#1f9e40",
  line: "#33ff66",
  accent: "#40e0ff",
  bar: "#000000",
  barText: "#33ff66",
  dialog: "#000000",
  dialogText: "#33ff66",
  button: "#000000",
  buttonText: "#40e0ff",
  shadow: "#000000",
};

export const TUI_DEFAULT_COLORS: Record<TuiStyle, TuiColors> = { dos: DOS_COLORS, mainframe: MAINFRAME_COLORS };

/** Glow per kind of element, percent (0–200). The CRT phosphor glows; a VGA screen barely does. */
export const TUI_DEFAULT_GLOW: Record<TuiStyle, { text: number; lines: number; elements: number }> = {
  dos: { text: 0, lines: 0, elements: 0 },
  mainframe: { text: 100, lines: 100, elements: 100 },
};

export interface TuiSettings {
  /** Default "dos". */
  style?: TuiStyle;
  /** Changed colours only; the rest come from the style. */
  colors?: Partial<TuiColors>;
  /** Glow on text, percent (0–200). */
  textGlow?: number;
  /** Glow on lines (frames, rules, borders), percent (0–200). */
  lineGlow?: number;
  /** Glow on everything else (buttons, fields, badges, icons), percent (0–200). */
  elementGlow?: number;
  /** CRT scanline overlay. */
  scanlines?: boolean;
}

export function tuiStyleOf(settings: TuiSettings | null | undefined): TuiStyle {
  return settings?.style === "mainframe" ? "mainframe" : "dos";
}

/** The style's colours with the user's changes on top. */
export function resolveTuiColors(settings: TuiSettings | null | undefined): TuiColors {
  const base = TUI_DEFAULT_COLORS[tuiStyleOf(settings)];
  const colors = { ...base };
  for (const key of TUI_COLOR_KEYS) {
    const value = settings?.colors?.[key];
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) colors[key] = value;
  }
  return colors;
}

export function resolveTuiGlow(settings: TuiSettings | null | undefined): { text: number; lines: number; elements: number } {
  const defaults = TUI_DEFAULT_GLOW[tuiStyleOf(settings)];
  return {
    text: settings?.textGlow ?? defaults.text,
    lines: settings?.lineGlow ?? defaults.lines,
    elements: settings?.elementGlow ?? defaults.elements,
  };
}

/** The same palette in light and dark mode: a text-mode screen has only one. */
function tuiPalette(colors: TuiColors): CustomPalette {
  const accent = hexToHslTriplet(colors.accent);
  const bright = hexToHslTriplet(colors.bright);
  const bar = hexToHslTriplet(colors.bar);
  const barText = hexToHslTriplet(colors.barText);
  const bg = hexToHslTriplet(colors.background);
  const fg = hexToHslTriplet(colors.text);
  return {
    accent,
    secondaryAccent: bright,
    tertiaryAccent: bright,
    navBg: bar,
    navFg: barText,
    bg,
    fg,
    darkAccent: accent,
    darkSecondaryAccent: bright,
    darkTertiaryAccent: bright,
    darkNavBg: bar,
    darkNavFg: barText,
    darkBg: bg,
    darkFg: fg,
  };
}

/** What the TUI engine actually applies, derived from the stored settings. */
export function tuiUserTheme(settings: TuiSettings | null | undefined): UserTheme {
  return {
    engine: "tui",
    tui: settings ?? {},
    palette: tuiPalette(resolveTuiColors(settings)),
    fontFamily: "unscii",
    cornerStyle: "sharp",
  };
}

/** The --tui-* variables src/styles/tui.css reads. */
export function tuiVars(settings: TuiSettings | null | undefined): Record<string, string> {
  const colors = resolveTuiColors(settings);
  const glow = resolveTuiGlow(settings);
  const vars: Record<string, string> = {};
  for (const key of TUI_COLOR_KEYS) vars[`--tui-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = colors[key];
  // Reverse video: highlighted items are drawn in the screen colour on the highlight.
  vars["--bungalow-color-primary-contrast"] = colors.background;
  vars["--bungalow-color-muted"] = colors.dim;
  vars["--tui-text-glow"] = String(glow.text / 100);
  vars["--tui-line-glow"] = String(glow.lines / 100);
  vars["--tui-element-glow"] = String(glow.elements / 100);
  return vars;
}

