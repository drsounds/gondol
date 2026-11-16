import { defineApp, lazyWidget } from "../../apps/defineApp";
import manifest from "./manifest.json";
import { studioAgentsResolution } from "./models/studioBridge";

const AgentIntercom = lazyWidget(() => import("./features/agents/src/widgets/AgentIntercom").then((m) => m.AgentIntercom));

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/**
 * The agents app, built into gondol: AI agents the user hires on the ai app's providers. Each has a
 * name, an avatar, a gender and an @username, runs on a model with the apps' MCP tools it's allowed,
 * works in working hours, carries out instructions on schedules and has direct conversations with
 * the account, the host's alter egos and other agents (threads to any depth under any message). It
 * can be suspended, fired and rehired. The intercom (an overlay on every page) lists the agents at
 * the bottom right and keeps conversations as chat bubbles with popups.
 *
 * The host tells it about its alter egos and channels by answering `agentsHostHook`, and about its
 * media library by answering `mediaHostHook` (avatars). The server runner is the `ai-agents` edge
 * function (`gondol-api --builtin agents --functions …` writes it, and `agent-code`, the coding tools).
 * Agents code through those tools (`agents__code_*`) in a workspace connected to their conversation:
 * repositories cloned in a sandbox (an OpenHands agent server), gondol apps tried in a live sandbox
 * and published into the apps registry (`useAgentAppSources()` hands the host their sources). It needs the ai app:
 * `gondolApps({ builtin: ["ai", "agents"] })`. Its tables are in docs/guide/agents.md.
 */
export const agentsApp = defineApp({
  manifest,
  pages: {
    agents: () => import("./features/agents/src/pages/AgentsPage").then((m) => m.AgentsPage),
    // Coding: repositories, sandboxes, workspaces and the apps agents build (/code).
    code: () => import("./features/agents/src/components/CodePanel").then((m) => m.CodePage),
  },
  widgets: {
    // The intercom: the agents' launcher, chat bubbles and popups over every page.
    overlayWidgets: [AgentIntercom],
  },
  // The App Studio's "Ask an agent", when the studio app is on.
  resolutions: [studioAgentsResolution],
  entitySources: {
    agent_workspace: { table: "agent_workspaces", columns: "id, title", label: (r) => str(r.title) },
    code_repository: { table: "code_repositories", columns: "id, name, full_name", label: (r) => str(r.full_name) ?? str(r.name) },
    code_sandbox: { table: "code_sandboxes", columns: "id, name", label: (r) => str(r.name) },
    agent: {
      table: "agents",
      columns: "id, name, username",
      label: (r) => [str(r.name), r.username ? `@${str(r.username)}` : null].filter(Boolean).join(" · ") || null,
    },
  },
});

export default agentsApp;
