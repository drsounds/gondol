import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";

/**
 * The service-finder app, built into gondol: the Service Finder (`/service-finder`) browses and
 * searches MCP servers in MCP registries (`mcp_registries`: the official MCP registry built in, plus
 * the user's own, read through the registry v0 API) and installs them into the ai app's MCP servers
 * (`ai_mcp_servers`), the one list the AI chat and the agents take their tools from (through the app
 * router's `/mcp`). `/mcp-servers` lists the installed servers, `/mcp-registries` the registries.
 *
 * It depends on the ai app. Switch it on like the others: `configureGondol({ apps: [...apps,
 * serviceFinderApp] })`, or `gondolApps({ builtin: ["service-finder"] })`. Its table is in
 * docs/guide/service-finder.md.
 */
export const serviceFinderApp = defineApp({
  manifest,
  pages: {
    finder: () => import("./features/finder/src/pages/ServiceFinderPage").then((m) => m.ServiceFinderPage),
    installed: () => import("./features/installed/src/pages/InstalledServersPage").then((m) => m.InstalledServersPage),
    registries: () => import("./features/registries/src/pages/McpRegistriesPage").then((m) => m.McpRegistriesPage),
  },
});

export default serviceFinderApp;
