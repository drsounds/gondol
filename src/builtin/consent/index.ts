import { defineApp, lazyWidget } from "../../apps/defineApp";
import manifest from "./manifest.json";

/**
 * The consent app, built into gondol: the cookie notice on the first visit (EU GDPR and the ePrivacy
 * directive), cookie settings (`/cookies`) to change or withdraw the choice, and the privacy policy
 * (`/privacy`) in Swedish and English. Non-essential telemetry and analytics wait for the user's yes:
 * check `hasConsent("analytics")` or start them with `onConsent("analytics", start)` from
 * `gondol/builtin/consent/models`, which also has `configureConsent()` for the controller's details.
 *
 * Switch it on with `configureGondol({ apps: [...apps, consentApp] })`, or
 * `gondolApps({ builtin: ["consent"] })` with the Vite plugin. See docs/guide/consent.md.
 */
export const consentApp = defineApp({
  manifest,
  pages: {
    privacy: () => import("./features/privacy/src/pages/PrivacyPage").then((m) => m.PrivacyPage),
    cookies: () => import("./features/cookies/src/pages/CookiesPage").then((m) => m.CookiesPage),
  },
  widgets: {
    overlayWidgets: [lazyWidget(() => import("./components/ConsentBanner").then((m) => m.ConsentBanner))],
  },
});

export default consentApp;
