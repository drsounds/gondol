import { defineApp, lazyWidget } from "../../apps/defineApp";
import manifest from "./manifest.json";

export { studioAgentsHook, type StudioAgent, type StudioAgentBridge } from "./hooks";
export { STUDIO_CATALOG } from "./components/LitePageView";

/**
 * The studio app, built into gondol: lightweight apps that users, or agents they ask, build from
 * generated UI (A2UI, Open-JSON-UI and MCP-UI pages, ../../genui) with entity types, relations and
 * records of their own. Each app is an app bundle made at run time (registerDynamicApps): its pages
 * live at `/lite/<app>/<page>` and are entries in the main menu. Agents build them with the app's
 * MCP tools (`studio__save_app`, `studio__save_page`, …); the agents app answers
 * `studioAgentsHook` so "Ask an agent" reaches them.
 *
 * Switch it on like the ai app: `configureGondol({ apps: [...apps, studioApp] })`, or
 * `gondolApps({ builtin: ["studio"] })`. Its tables and functions are in docs/guide/studio.md.
 */
export const studioApp = defineApp({
  manifest,
  pages: {
    studio: () => import("./features/studio/src/pages/StudioPage").then((m) => m.StudioPage),
  },
  widgets: {
    // Registers the user's apps as bundles of their own, so their pages route and show in the menu.
    overlayWidgets: [lazyWidget(() => import("./widgets/LiteAppsRegistrar").then((m) => m.LiteAppsRegistrar))],
  },
});

export default studioApp;
