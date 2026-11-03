import { defineApp } from "gondol/apps/defineApp";
import manifest from "../manifest.json";

// The host's own defineApp (gondol is shared, not bundled), so the app registers in the host's registry.
export default defineApp({
  manifest,
  pages: {
    hello: () => import("./HelloPage").then((m) => m.HelloPage),
  },
});
