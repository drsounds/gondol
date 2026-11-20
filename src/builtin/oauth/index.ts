import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";

/**
 * The oauth app, built into gondol: OAuth 2 for HTML5 and other apps. Each app gets any number of
 * credentials (a client id and a secret that is shown once, stored only as a hash and can be
 * regenerated, a redirect URI and a callback URL); users allow an app access on the consent page
 * (`/oauth/authorize`) and see and disconnect the apps they've allowed at `/oauth`. The tokens it
 * issues call the apps' HTTP APIs (manifest `api`, served by gondol's API gateway, ../../api).
 *
 * Switch it on like the ai app: `configureGondol({ apps: [...apps, oauthApp] })`, or
 * `gondolApps({ builtin: ["oauth"] })`. Its tables and functions are in docs/guide/oauth.md.
 */
export const oauthApp = defineApp({
  manifest,
  pages: {
    authorize: () => import("./features/authorize/src/pages/OAuthAuthorizePage").then((m) => m.OAuthAuthorizePage),
    credentials: () => import("./features/credentials/src/pages/OAuthCredentialsPage").then((m) => m.OAuthCredentialsPage),
  },
});

export default oauthApp;
