# The consent app

Gondol's `consent` app covers what the EU's GDPR and ePrivacy rules ask of an app's front end:

- **A cookie notice on the first visit.** It stays at the bottom of the screen until the user
  answers. "Reject all" and "Accept all" are equally prominent, and "Choose" picks per category.
- **Cookie settings** (`/cookies`), to change or withdraw the choice at any time.
- **A privacy policy** (`/privacy`) in Swedish and English, after the user's language: the
  controller, what data is processed and why, cookies and local storage, the providers that store
  and process data (where, and how transfers outside the EU/EEA are safeguarded), retention, the
  user's rights and how to complain to the supervisory authority.

> The policy text is a **draft**. Have it reviewed before you rely on it, and fill in the
> controller's details (below); until then they show as [bracketed placeholders], as do the
> retention periods.

## Switching it on

```ts
import { consentApp } from "gondol/builtin/consent";
configureGondol({ /* … */ apps: [...myApps, consentApp] });
```

or `gondolApps({ dir: "apps", builtin: ["consent"] })`. The notice is an overlay widget, so it shows
inside the shell. Screens outside the shell (sign-in, a public site) render it themselves, and a
route for visitors who aren't signed in can show the policy:

```tsx
import { ConsentBanner } from "gondol/builtin/consent/components/ConsentBanner";
import { PrivacyPolicy } from "gondol/builtin/consent/components/PrivacyPolicy";

<main className="bungalow-root signin-screen">
  {/* … */}
  <ConsentBanner />
</main>
```

## Categories and gating

`necessary` (the session, the user's own settings, the consent itself) is always on and needs no
consent. Everything else is off until the user says yes, and stays off if they never answer, so a
user who closes the tab, or a site that leaves the app out, gets no tracking. The default optional
category is `analytics` (statistics, performance and error telemetry, video analytics).

Code that sends telemetry or loads an analytics SDK asks first:

```ts
import { hasConsent, onConsent } from "gondol/builtin/consent/models";

if (hasConsent("analytics")) sendEvent(…);

// Starts now or when the user says yes; stops if they take it back.
onConsent("analytics", () => {
  const analytics = initAnalytics();
  return () => analytics.disable();
});
```

In React, `useConsent()` gives `{ state, decided, has(category), set, acceptAll, rejectAll, reset }`,
live across components and tabs.

The choice is stored per device in localStorage (`<namespace>:consent`) as
`{ version, decidedAt, categories }`. It counts only for the current `policyVersion`: raise it and
everyone is asked again.

## Services an app uses

An app that brings in a third party (a video host, an analytics SDK, a map provider) declares it in
its `manifest.json`, and the cookie notice lists it under its category while the privacy policy lists
it among the providers (where it processes data, which domains it contacts, the legal basis, how a
transfer outside the EU/EEA is safeguarded) and its cookies in the storage table:

```json
"services": [
  {
    "id": "mux",
    "name": "Mux",
    "provider": "Mux, Inc.",
    "category": "analytics",
    "countries": ["US", "EU"],
    "domains": ["stream.mux.com", "litix.io"],
    "purpose": { "en": "Streams video and measures playback (Mux Data).", "sv": "Strömmar video och mäter uppspelningen (Mux Data)." },
    "data": { "en": "IP address, device, playback events.", "sv": "IP-adress, enhet, uppspelningshändelser." },
    "transfer": { "en": "EU–US Data Privacy Framework or SCCs.", "sv": "EU:s och USA:s Data Privacy Framework eller standardavtalsklausuler." },
    "policyUrl": "https://www.mux.com/privacy",
    "storage": [{ "name": "muxData", "kind": "cookie", "purpose": { "en": "Anonymous viewer id" }, "duration": { "en": "As set by Mux" } }]
  }
]
```

`countries` are ISO 3166-1 alpha-2 codes (`SE`, `US`) or `EU`/`EEA`; the policy names them in the
user's language. `category` defaults to `necessary` (no consent asked; legal basis contract);
optional categories default to consent. Use a category the host configures (`analytics` by
default): a service in an unknown category is never allowed. A service with the same `id` as an
earlier one (the host's own, `DEFAULT_SERVICES`) replaces it. Services answer
`privacyServicesHook` (`gondol/apps/shellHooks`), so code can add them with `answer()` too.

The app then starts the service only when it's allowed:

```ts
import { onServiceConsent } from "gondol/builtin/consent/models";

onServiceConsent("mux", () => {
  const monitor = startMuxData(video);
  return () => monitor.destroy();
});
```

## Configuration

Once, before anything renders:

```ts
import { configureConsent, configurePolicy, ANALYTICS } from "gondol/builtin/consent/models";

configureConsent({
  controller: { name: "Example AB", organizationNumber: "556000-0000", address: "Box 1, 111 11 Stockholm", email: "privacy@example.com" },
  policyVersion: 2,          // ask everyone again
  updatedOn: "2026-11-01",   // shown on the policy
  categories: [ANALYTICS, { id: "marketing", label: { en: "Marketing", sv: "Marknadsföring" }, description: { en: "…", sv: "…" } }],
});

configurePolicy({ services: [...], storage: [...] }); // replace the platform's services and the app's own storage items
```

The platform's services are Hostup AB (hosting and storage, Sweden), Supabase, Inc. (telemetry, USA),
Google Cloud Storage (media storage, EU/USA), Firebase (SE/EU/USA) and Mux, Inc. (video and Mux Data
video analytics, USA/EU), in `DEFAULT_SERVICES`. The storage table lists the session, the consent and
the user's settings, then every service's `storage`.
