import { useCallback, useSyncExternalStore } from "react";
import type { AppLocaleString } from "../../../apps/types";
import { namespaced } from "../../../shell/storage";

/**
 * Cookie consent (EU GDPR and the ePrivacy directive): which kinds of non-essential storage and
 * tracking the user allows on this device. Strictly necessary storage (the session, the user's own
 * settings) needs no consent and is always on; everything else is off until the user says yes, and
 * stays off when they never answer. Code that sends telemetry or loads an analytics script checks
 * `hasConsent("analytics")` first, or waits for it with `onConsent("analytics", start)`.
 *
 * The choice is kept per device in localStorage (`<namespace>:consent`), with the policy version it
 * was given for: raising `policyVersion` (configureConsent) asks everyone again.
 */

/** A kind of storage or tracking the user can allow. `necessary` is always allowed. */
export interface ConsentCategory {
  id: string;
  label: AppLocaleString;
  description: AppLocaleString;
  /** Services that use it beyond those declared with this category (manifest `services`), shown under the switch. */
  services?: string[];
}

/** The data controller, shown in the privacy policy. Unset fields show as placeholders. */
export interface ConsentController {
  name?: string;
  organizationNumber?: string;
  address?: string;
  email?: string;
  /** A data protection officer or privacy contact, when there is one. */
  privacyContact?: string;
}

export interface ConsentConfig {
  /** Optional categories, in the order they show. `necessary` is added in front. */
  categories: ConsentCategory[];
  /** Raise it when the policy or the categories change in a way users must agree to again. */
  policyVersion: number;
  /** When the policy last changed (yyyy-mm-dd), shown on the policy page. */
  updatedOn: string;
  controller: ConsentController;
}

export const NECESSARY: ConsentCategory = {
  id: "necessary",
  label: { en: "Strictly necessary", sv: "Nödvändiga" },
  description: {
    en: "Signing in, keeping you signed in, security, and the settings you pick (language, theme, layout). Always on: the app doesn't work without them.",
    sv: "Inloggning, att hålla dig inloggad, säkerhet och inställningarna du väljer (språk, tema, layout). Alltid på: appen fungerar inte utan dem.",
  },
};

export const ANALYTICS: ConsentCategory = {
  id: "analytics",
  label: { en: "Statistics and telemetry", sv: "Statistik och telemetri" },
  description: {
    en: "Anonymous usage statistics, performance and error telemetry, and video playback analytics, so we can see what works and fix what doesn't.",
    sv: "Anonym användningsstatistik, telemetri om prestanda och fel samt analys av videouppspelning, så att vi ser vad som fungerar och kan rätta det som inte gör det.",
  },
};

let config: ConsentConfig = {
  categories: [ANALYTICS],
  policyVersion: 1,
  updatedOn: "2026-10-23",
  controller: {},
};

/** Sets the categories, policy version and controller details; call once, before anything renders. */
export function configureConsent(next: Partial<ConsentConfig>): void {
  config = {
    ...config,
    ...next,
    categories: (next.categories ?? config.categories).filter((c) => c.id !== NECESSARY.id),
    controller: { ...config.controller, ...next.controller },
  };
  cached = undefined;
}

export function getConsentConfig(): ConsentConfig {
  return config;
}

/** Every category, `necessary` first. */
export function consentCategories(): ConsentCategory[] {
  return [NECESSARY, ...config.categories];
}

/** What the user chose, and when. */
export interface ConsentState {
  /** The policy version the choice was given for. */
  version: number;
  /** ISO time of the choice. */
  decidedAt: string;
  /** Optional categories by id; missing means no. */
  categories: Record<string, boolean>;
}

const EVENT = "consent:change";
const storageKey = () => namespaced("consent");

function parse(raw: string | null): ConsentState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ConsentState>;
    if (typeof value.version !== "number" || typeof value.decidedAt !== "string" || typeof value.categories !== "object" || !value.categories) return null;
    return { version: value.version, decidedAt: value.decidedAt, categories: { ...value.categories } };
  } catch {
    return null;
  }
}

// useSyncExternalStore needs the same object until the stored choice changes.
let cached: { raw: string | null; state: ConsentState | null } | undefined;

function read(): ConsentState | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey());
  } catch {
    raw = null;
  }
  if (cached?.raw !== raw) cached = { raw, state: parse(raw) };
  return cached.state;
}

/** The user's choice on this device, or null when they haven't made one for the current policy. */
export function getConsent(): ConsentState | null {
  const state = read();
  return state && state.version >= config.policyVersion ? state : null;
}

/** Whether the user has answered the banner for the current policy. */
export function hasDecided(): boolean {
  return getConsent() !== null;
}

/** Whether `category` is allowed. `necessary` always is; anything else only after a yes. */
export function hasConsent(category: string): boolean {
  if (category === NECESSARY.id) return true;
  return getConsent()?.categories[category] === true;
}

/** Saves a choice: each optional category yes or no (missing ones are no). */
export function setConsent(categories: Record<string, boolean>): ConsentState {
  const state: ConsentState = {
    version: config.policyVersion,
    decidedAt: new Date().toISOString(),
    categories: Object.fromEntries(config.categories.map((c) => [c.id, categories[c.id] === true])),
  };
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {
    // Private mode or storage full: the choice holds until the page reloads.
    cached = { raw: JSON.stringify(state), state };
  }
  window.dispatchEvent(new Event(namespaced(EVENT)));
  return state;
}

export const acceptAllConsent = () => setConsent(Object.fromEntries(config.categories.map((c) => [c.id, true])));
export const rejectAllConsent = () => setConsent({});

/** Forgets the choice, so the banner asks again. */
export function resetConsent(): void {
  try {
    window.localStorage.removeItem(storageKey());
  } catch {
    // nothing stored
  }
  cached = undefined;
  window.dispatchEvent(new Event(namespaced(EVENT)));
}

/** Calls `listener` whenever the choice changes, in this tab or another. Returns an unsubscribe. */
export function subscribeConsent(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey()) listener();
  };
  const name = namespaced(EVENT);
  window.addEventListener(name, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(name, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Runs `start` once `category` is allowed (now, or when the user says yes later). If the user takes
 * it back, `start`'s returned function (if any) is called to stop. Returns an unsubscribe.
 *
 *   onConsent("analytics", () => { const sdk = initAnalytics(); return () => sdk.shutdown(); });
 */
export function onConsent(category: string, start: () => void | (() => void)): () => void {
  let stop: (() => void) | void | undefined;
  let running = false;
  const check = () => {
    const allowed = hasConsent(category);
    if (allowed && !running) {
      running = true;
      stop = start();
    } else if (!allowed && running) {
      running = false;
      stop?.();
      stop = undefined;
    }
  };
  check();
  const unsubscribe = subscribeConsent(check);
  return () => {
    unsubscribe();
    if (running) stop?.();
  };
}

/** The choice in React, live across components and tabs. */
export function useConsent() {
  const state = useSyncExternalStore(subscribeConsent, getConsent, () => null);
  const has = useCallback(
    (category: string) => category === NECESSARY.id || state?.categories[category] === true,
    [state],
  );
  return {
    state,
    decided: state !== null,
    has,
    set: setConsent,
    acceptAll: acceptAllConsent,
    rejectAll: rejectAllConsent,
    reset: resetConsent,
  };
}
