import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MessageKey } from "../register";
import { GONDOL_MESSAGES } from "./messages";
import { useSite } from "../sites/sites";
import { isSitePreferenceLocked, sitePreferenceValue } from "../sites/preferences";

export type { MessageKey };

/** A locale code of the app's catalogue ("en", "sv", …). */
export type Locale = string;

/** Flat message catalogues per locale. Placeholders use {name}. "en" is the fallback. */
export type MessageCatalogue = { en: Record<string, string> } & Record<Locale, Record<string, string>>;

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  intlLocale: string;
}

/** BCP 47 tags used for date and currency formatting, for the locales gondol ships strings in. */
export const DEFAULT_INTL_LOCALES: Record<Locale, string> = { en: "en-US", sv: "sv-SE" };

const DEFAULT_STORAGE_KEY = "cashflow-locale";

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

/** The user's stored pick, if it is one of the locales. */
function storedLocale(locales: readonly Locale[], storageKey: string): Locale | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored && locales.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The best match from the browser's language list. */
function browserLocale(locales: readonly Locale[]): Locale | null {
  const candidates: readonly string[] =
    navigator.languages?.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
  for (const tag of candidates) {
    const normalized = tag?.toLowerCase();
    const match = locales.find((l) => normalized === l || normalized?.startsWith(`${l}-`));
    if (match) return match;
  }
  return null;
}

interface I18nProviderProps {
  /** The app's catalogue, merged over gondol's own strings (GONDOL_MESSAGES). */
  messages: MessageCatalogue;
  /** The locales a user can pick; defaults to the catalogue's. */
  locales?: readonly Locale[];
  /** BCP 47 tags for date and currency formatting per locale. */
  intlLocales?: Record<Locale, string>;
  /** Where the user's pick is remembered (localStorage). */
  storageKey?: string;
  children: ReactNode;
}

export function I18nProvider({ messages, locales, intlLocales = DEFAULT_INTL_LOCALES, storageKey = DEFAULT_STORAGE_KEY, children }: I18nProviderProps) {
  // Start on "en" so server and client markup match, then adopt the stored or
  // browser language after hydration. The site served here (sites/preferences.ts) may set a
  // language: a default where the user has picked none, or, locked, the only one.
  const [picked, setPicked] = useState<Locale | null>(null);
  const [browser, setBrowser] = useState<Locale | null>(null);
  const available = useMemo(() => locales ?? Object.keys(messages), [locales, messages]);

  const merged = useMemo(() => {
    const out: Record<Locale, Record<string, string>> = {};
    for (const l of new Set([...Object.keys(GONDOL_MESSAGES), ...Object.keys(messages)])) {
      out[l] = { ...(GONDOL_MESSAGES as Record<Locale, Record<string, string>>)[l], ...messages[l] };
    }
    return out;
  }, [messages]);

  useEffect(() => {
    setPicked(storedLocale(available, storageKey));
    setBrowser(browserLocale(available));
  }, [available, storageKey]);

  const { site } = useSite();
  const siteLocale = sitePreferenceValue(site?.layout, "locale");
  const siteChoice = siteLocale && available.includes(siteLocale) ? siteLocale : null;
  const siteLocked = !!siteChoice && isSitePreferenceLocked(site?.layout, "locale");
  const locale: Locale = (siteLocked ? siteChoice : null) ?? picked ?? siteChoice ?? browser ?? "en";

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      intlLocale: intlLocales[locale] ?? locale,
      setLocale: (next) => {
        try {
          window.localStorage.setItem(storageKey, next);
        } catch {
          /* still switches for this visit */
        }
        setPicked(next);
      },
      t: (key, vars) => interpolate(merged[locale]?.[key] ?? merged.en[key] ?? key, vars),
    }),
    [locale, merged, intlLocales, storageKey],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
