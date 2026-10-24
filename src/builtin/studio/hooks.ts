import { defineHook } from "../../apps/contributions";

/**
 * How the studio asks an agent to build or change an app, and hands it a user's action on a page
 * the app doesn't run itself. The host's agents app answers it (`answer(studioAgentsHook, …)`);
 * without an answer, "Ask an agent" opens the AI chat with the request instead.
 */
export interface StudioAgent {
  /** The agent's id in the host. */
  id: string;
  name: string;
  /** e.g. its job title. */
  description?: string;
  /** Its entity URI (an app's `builder_uri`). */
  uri: string;
}

export interface StudioAgentBridge {
  /** The agents the user can ask (a React hook: read them with queries). */
  useAgents: () => { agents: StudioAgent[]; loading: boolean };
  /**
   * Sends `prompt` to the agent and starts its work; returns where to follow it (its conversation),
   * or null to stay.
   */
  ask: (input: { agent: StudioAgent; prompt: string; title: string }) => Promise<string | null>;
}

export const studioAgentsHook = defineHook<StudioAgentBridge>("studio.agents");
