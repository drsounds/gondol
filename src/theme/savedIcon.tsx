import { Icon } from "../design-system/bungalow-79d923";
import { useUserTheme } from "./userTheme";

/**
 * The glyph for "saved to the library" (liked): a heart (the default), a bookmark, or a plus in a
 * ring that turns into a filled accent-coloured circle with a check once saved. The user picks one
 * in their shell preferences (ShellSettings); a site can set a default (SiteLayout.savedIcon) for
 * visitors who haven't picked one.
 */
export type SavedIconStyle = "heart" | "bookmark" | "check";
export const SAVED_ICON_STYLES: SavedIconStyle[] = ["heart", "bookmark", "check"];

export function isSavedIconStyle(value: unknown): value is SavedIconStyle {
  return typeof value === "string" && (SAVED_ICON_STYLES as string[]).includes(value);
}

/** The style in effect: the site's locked choice, else the user's own, else the site's default, else the heart. */
export function useSavedIconStyle(): SavedIconStyle {
  const { preferences } = useUserTheme();
  return isSavedIconStyle(preferences.savedIcon) ? preferences.savedIcon : "heart";
}

/** The saved/unsaved glyph in the style in effect (or `style`), sized 1em like the icon font. */
export function SavedIcon({ saved, style, className }: { saved: boolean; style?: SavedIconStyle; className?: string }) {
  const current = useSavedIconStyle();
  const shown = style ?? current;
  if (shown === "heart") return <Icon name={saved ? "like-fill" : "like"} className={className} />;
  const classes = ["saved-icon", `saved-icon--${shown}`, saved ? "saved-icon--saved" : null, className].filter(Boolean).join(" ");
  return (
    <svg className={classes} width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {shown === "bookmark" ? (
        <path
          d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.6-6.5 4.6v-16a1 1 0 0 1 1-1Z"
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      ) : saved ? (
        <>
          <circle cx="12" cy="12" r="10" fill="var(--bungalow-color-primary)" />
          <path
            d="m7.5 12.3 3 3 6-6.3"
            stroke="var(--bungalow-color-primary-contrast)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 7.8v8.4M7.8 12h8.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
