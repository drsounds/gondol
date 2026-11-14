import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";

export type * from "./models/types";

/**
 * The mastodon app, built into gondol: a Mastodon server and client. The user runs servers on their
 * own domains (`mastodon_instances`), sets up profiles on them (signing up, approved by moderators
 * when the server asks for that), and posts, follows, favourites, boosts and reads timelines; the
 * `mastodon` edge function federates all of it over ActivityPub (WebFinger, actors, signed
 * inbox/outbox deliveries) and answers Mastodon apps through a subset of the client API. Other
 * Mastodon servers can be signed in to and used from the same client. Every account, status, list,
 * follow and the rest is an entity of its own.
 *
 * Switch it on like the other built-ins: `gondolApps({ builtin: ["mastodon"] })`, and write its
 * server with `gondol-api --builtin mastodon`. Its tables, functions and server setup are in
 * docs/guide/mastodon.md.
 */
export const mastodonApp = defineApp({
  manifest,
  pages: {
    mastodon: () => import("./features/mastodon/src/pages/MastodonPage").then((m) => m.MastodonPage),
    "mastodon-instances": () => import("./features/mastodon-instances/src/pages/InstancesPage").then((m) => m.InstancesPage),
  },
});

export default mastodonApp;
