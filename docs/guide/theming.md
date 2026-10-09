# Theming

Gondol's theming engine lets every user restyle the whole app: light or dark, an accent colour,
palettes, corner and type styles, retro "style flavors", and two complete alternative looks (Frutiger
Aero glass and a text-mode TUI). Everything is expressed as CSS custom properties and `data-*`
attributes on `<html>`, so your own styles follow along by using the same tokens.

## Layers

| Layer | Module | What it controls |
| --- | --- | --- |
| Mode | `gondol/theme/theme` | `system`, `light` or `dark` (`data-theme` on `<html>`, and the `theme-color` meta tag). |
| Accent | `gondol/theme/accentColor` | One colour, `--bungalow-color-primary`, with a readable contrast colour. |
| Engine and user theme | `gondol/theme/userTheme` | Everything else: palettes, flavors, fonts, shell layout, and the engine. |
| Site | `gondol/sites/sites` | A [site](./sites.md) can bring its own engine, theme and layout, replacing the visitor's while they are on it. |

Their providers nest in that order in the root route (see [Getting
started](./getting-started.md#the-root-route)): `SiteProvider`, `ThemeProvider`,
`AccentColorProvider`, `UserThemeProvider`.

## Engines

| Engine | Look |
| --- | --- |
| `simple` | Light/dark mode and the accent colour only. |
| `advanced` | The full user theme: palettes, flavors, typography, shape, background tint. The default. |
| `aero` | 3D Frutiger Aero glass with glossy chrome, ambient glows and a "taste" tint (`gondol/theme/aeroTheme`). |
| `tui` | The app as a text-mode program in the Unscii pixel font: an MS-DOS `dos` style or an IBM 3270 `mainframe` style, every colour editable, with glow (`gondol/theme/tuiTheme`). |

The alternative engines turn their own settings (`UserTheme.aero`, `UserTheme.tui`) into an ordinary
user theme plus `data-theme-engine="aero"` or `"tui"`, which `styles/aero.css` and `styles/tui.css`
key off. Switching engines keeps every engine's settings, so switching back restores them.

## Reading and changing the theme

```tsx
import { useTheme } from "gondol/theme/theme";
import { useAccentColor } from "gondol/theme/accentColor";
import { useUserTheme } from "gondol/theme/userTheme";

function ThemeControls() {
  const { theme, setTheme } = useTheme();                  // "system" | "light" | "dark"
  const { accentColor, setAccentColor } = useAccentColor(); // "#rrggbb" or null for the default
  const { engine, setEngine, userTheme, updateUserTheme } = useUserTheme();

  return (
    <>
      <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>Toggle dark mode</button>
      <button onClick={() => setAccentColor("#1ed760")}>Green accent</button>
      <button onClick={() => setEngine("tui")}>Text mode</button>
      <button onClick={() => updateUserTheme({ cornerStyle: "sharp", styleFlavor: "aqua" })}>Aqua</button>
    </>
  );
}
```

`useUserTheme()` also has `replaceUserTheme(theme)` (load a saved or imported theme),
`resetUserTheme()`, `savedThemes`, `saveCurrentTheme(name)` and `deleteSavedTheme(id)`.
`encodeTheme(theme)` and `decodeTheme(text)` turn a theme into a shareable string and back.

### The user theme

`UserTheme` (in `gondol/theme/userTheme`) is a plain object; the most useful fields:

| Field | Values |
| --- | --- |
| `palette`, `paletteId`, `paletteAdjust` | A `CustomPalette` of `"H S% L%"` colours for light and dark (accent, secondary, tertiary, navigation, background, text), one of `MATERIAL_PALETTES` by id, and a hue/saturation/lightness shift. |
| `styleFlavor` | `none`, `skeuomorphic`, `bootstrap2`, `vista`, `material2`, `xp-luna`, `mac9`, `aqua`, `mountain-lion`, `itunes08`, `itunes09`, `itunes10`, `yosemite`, `neon`. |
| `cornerStyle` | `sharp`, `semi`, `full`. |
| `fontFamily`, `fontSize`, `fontWeight`, `buttonFontWeight`, `textTransform` | Typography (`FONT_OPTIONS` lists the fonts). |
| `backgroundTint`, `tintSaturation`, `bgLightnessLight`, `bgLightnessDark` | Canvas colour when the palette doesn't set one. |
| `shellStyle`, `linkStyle`, `selectionStyle`, `progressBarColor`, `hideBorders` | Smaller touches. |
| `layoutStyle` | `app`, `sidebar` or `website`. |
| `shell` | `ShellSettings`: `desktopLayout` (`modern` with a header, or `classic` with the menu running full height), `classicFrame`, `darkTabBar`, `darkFrame`. |
| `viewTransitions`, `staggeredEntries` | Motion. |
| `hideSoftDeletedEntities`, `hideFutureEntities` | Whether [lifecycle](./entity-ui.md#lifecycle)-dimmed rows are hidden. |

New users get `defaultUserTheme()`: the Frutiger Aero palette with the Vista flavor.

## Settings UI

Gondol ships the settings screens; put them on your account or settings page:

| Component | Module |
| --- | --- |
| `AppearanceSettings` | `gondol/theme/AppearanceSettings`: engine, mode, accent, palettes, flavors, typography, saved and shared themes. |
| `ShellSettings` | `gondol/theme/ShellSettings`: desktop layout and frame. |
| `AeroThemeSettings` | `gondol/theme/AeroThemeSettings`: taste, tint, accent, glass and glows. |
| `TuiThemeSettings` | `gondol/theme/TuiThemeSettings`: style, colours, glow, scanlines. |

`RangeField` (from `AppearanceSettings`) is the labelled slider they use.

## Sync across devices

`UserThemeProvider` keeps the whole appearance (mode, accent, engine, user theme and saved themes) in
`localStorage` and, while the user is signed in, syncs it to their row in the `user_themes` table, so
a new device adopts it. Signed out, it keeps working from `localStorage` alone. See
[Supabase](./supabase.md#the-base-schema) for the table.

## Avoiding a flash on load

The providers start from neutral values so server and client markup match, then adopt the stored
settings after hydration. To avoid a flash of the default look, run the same settings before first
paint with blocking scripts in `<head>`:

- `USER_THEME_INIT_SCRIPT` (exported) applies the snapshot of computed variables and attributes the
  provider stores under `USER_THEME_VARS_STORAGE_KEY`.
- A one-liner that sets `data-theme` from `THEME_STORAGE_KEY`.
- Optionally, one that sets the accent from `ACCENT_COLOR_STORAGE_KEY`, and one that creates the
  `<meta name="theme-color">` tag with `THEME_COLOR_LIGHT` or `THEME_COLOR_DARK`.

Spacify's `src/routes/__root.tsx` has all four.

## Styling your own components

Use the design system's tokens rather than fixed colours, and your components follow every engine,
palette and mode:

| Token | Use |
| --- | --- |
| `--bungalow-color-canvas`, `--bungalow-color-surface`, `--bungalow-color-surface-strong` | Page and panel backgrounds. |
| `--bungalow-color-ink`, `--bungalow-color-muted` | Text. |
| `--bungalow-color-primary`, `--bungalow-color-primary-contrast`, `-soft`, `-strong` | The accent, and text on it. |
| `--bungalow-color-secondary`, `--bungalow-color-tertiary` (and `-contrast`) | Palette accents. |
| `--bungalow-color-success`, `-warning`, `-danger`, `-info` (and `-soft`) | Status. |
| `--bungalow-color-border`, `--bungalow-focus-ring`, `--bungalow-shadow-raised` | Lines, focus, elevation. |
| `--bungalow-radius-sm`, `--bungalow-radius-pill`, `--bungalow-font-sans`, `--bungalow-space-*` | Shape, type, spacing. |
| `--chrome-bg`, `--chrome-fg`, `--chrome-fg-active` | The navigation and frame. |

For engine-specific tweaks, key off the attributes the engine sets on `<html>`:
`data-theme-engine`, `data-style-flavor`, `data-tactile`, `data-color-scheme` (the resolved
`light` or `dark`), `data-desktop-layout`, `data-layout-style`, `data-tui-style` and others.

```css
.note-card {
  background: var(--bungalow-color-surface);
  color: var(--bungalow-color-ink);
  border-radius: var(--bungalow-radius-sm);
}
html[data-theme-engine="tui"] .note-card {
  border: 1px solid var(--tui-line);
}
```

## The design system

`gondol/design-system/bungalow-79d923` is the bungalow design system: `Button`, `Input`, `Select`,
`Checkbox`, `Card`, `Badge`, `Alert`, `Accordion`, `Toast` and `Icon` (with the `IconName` union of
its icon font), plus its fonts and `theme.css`. Import components from it directly:

```tsx
import { Button, Card, Icon, Input } from "gondol/design-system/bungalow-79d923";
```
