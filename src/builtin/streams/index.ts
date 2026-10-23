import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";

/**
 * The streams app, built into gondol: what the user does, as streams of a subject (the user), a
 * predicate (the action), an object, a context (a task) and a motivation, from a start to an end,
 * with a quantity and yin/yang entries. The analytics app (gondol/builtin/analytics) reads them.
 *
 * Switch it on by adding it to the host's apps: `configureGondol({ apps: [...apps, streamsApp] })`,
 * or `gondolApps({ builtin: ["streams"] })` with the Vite plugin. The host can tell it about its
 * accounts and task estimates by answering `streamsHostHook`. Its tables are in docs/guide/streams.md.
 */
export const streamsApp = defineApp({
  manifest,
  pages: {
    streams: () => import("./features/streams/src/pages/StreamsPage").then((m) => m.StreamsPage),
  },
});

export default streamsApp;
