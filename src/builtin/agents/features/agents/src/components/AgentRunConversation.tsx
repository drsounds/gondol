import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Card } from "../../../../../../design-system/bungalow-79d923";
import { uuidFromIdentifier } from "../../../../../../entities/slugs";
import { PageNotFound } from "../../../../../../shell/PageNotFound";
import { useAgentEgos } from "../../../../models/host";
import { useI18n } from "../../../../../../i18n/i18n";
import { supabase } from "../../../../models/db";
import {
  AGENT_CONVERSATION_COLUMNS,
  agentConversationPath,
  agentConversationsKey,
  agentRunPath,
  openAgentRunConversation,
  type Agent,
  type AgentConversation,
  type AgentRun,
} from "../../../../models/agents";

/**
 * A run of an agent's work opened as a conversation (`/agents/$agent/runs/$run`, from the run log):
 * finds or makes the conversation (open_agent_run_conversation(): the one the run answered in, else
 * one of its own with the instructions and the answer) and goes on to it, so the user reads it and
 * writes on from there like in any other conversation.
 */
export function AgentRunConversation({ agent, agents, runKey }: { agent: Agent; agents: Agent[]; runKey: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const egos = useAgentEgos();
  const runId = uuidFromIdentifier(runKey) ?? runKey;

  const opened = useQuery({
    queryKey: ["agent-run-conversation", runId],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data: run, error } = await supabase.from("agent_runs").select("id, conversation_id, message_parent_id").eq("id", runId).maybeSingle();
      if (error) throw error;
      if (!run) return null;
      const conversationId = await openAgentRunConversation(run.id);
      const { data: conversation, error: conversationError } = await supabase.from("agent_conversations").select(AGENT_CONVERSATION_COLUMNS).eq("id", conversationId).single();
      if (conversationError) throw conversationError;
      void queryClient.invalidateQueries({ queryKey: agentConversationsKey(agent.id) });
      return { run: run as Pick<AgentRun, "conversation_id" | "message_parent_id">, conversation: conversation as AgentConversation };
    },
  });

  const target = opened.data && !egos.isLoading ? agentConversationPath(agent, agents, egos.data ?? [], opened.data.conversation) : null;
  useEffect(() => {
    if (target && opened.data) void navigate({ to: agentRunPath(target, opened.data.run), search: (prev: object) => prev, replace: true } as Parameters<typeof navigate>[0]);
  }, [target, opened.data, navigate]);

  if (opened.isSuccess && !opened.data) return <PageNotFound />;
  return <Card>{opened.error ? <p className="bungalow-help bungalow-help--error">{opened.error.message}</p> : <p className="stat-label">{t("app.loading")}</p>}</Card>;
}
