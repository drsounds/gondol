import { useMemo } from "react";
import { answer } from "../../../apps/contributions";
import { entityIdentifier, entityKey } from "../../../entities/slugs";
import { toEntityUri } from "../../../entities/uri";
import { studioAgentsHook, type StudioAgentBridge } from "../../studio/hooks";
import { createAgentConversation, queueAgentRun, useAgents } from "./agents";
import { supabase } from "./db";

/**
 * The App Studio's agents (studioAgentsHook): "Ask an agent" starts a conversation with the agent
 * beside its main one, posts the request in it and queues its work, then opens it.
 */
export const studioAgentBridge: StudioAgentBridge = {
  useAgents: () => {
    const agents = useAgents();
    const list = useMemo(
      () =>
        (agents.data ?? [])
          .filter((agent) => agent.status === "active")
          .map((agent) => ({ id: agent.id, name: agent.name, description: agent.title ?? `@${agent.username}`, uri: toEntityUri("agent", agent.id) })),
      [agents.data],
    );
    return { agents: list, loading: agents.isLoading };
  },
  ask: async ({ agent, prompt, title }) => {
    const conversation = await createAgentConversation(agent.id, title);
    const { error } = await supabase.from("agent_messages").insert({ conversation_id: conversation.id, author_kind: "account", content: prompt });
    if (error) throw error;
    await queueAgentRun({ agentId: agent.id, trigger: "message", conversationId: conversation.id });
    const { data } = await supabase.from("agents").select("id, slug").eq("id", agent.id).maybeSingle();
    return `/agents/${data ? entityKey(data) : agent.id}/conversations/${entityIdentifier(conversation.id)}`;
  },
};

export const studioAgentsResolution = answer(studioAgentsHook, studioAgentBridge);
