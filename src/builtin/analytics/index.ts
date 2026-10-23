import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";

/**
 * The analytics app, built into gondol: analyses of what the other apps record. Its first feature
 * reads the streams app's streams (`/analytics`): a period and time of day, the object's entity
 * types and conditions on subject, predicate, object, context, motivation and task, with totals, a
 * chart over time, a breakdown and the matching streams.
 *
 * It needs the streams app: `gondolApps({ builtin: ["streams", "analytics"] })`, or
 * `configureGondol({ apps: [...apps, streamsApp, analyticsApp] })`. See docs/guide/analytics.md.
 */
export const analyticsApp = defineApp({
  manifest,
  pages: {
    streams: () => import("./features/streams/src/pages/StreamAnalyticsPage").then((m) => m.StreamAnalyticsPage),
  },
});

export default analyticsApp;
