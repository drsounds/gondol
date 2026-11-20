import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card } from "../../../../../../design-system/bungalow-79d923";
import { EntityPicker, type EntityOption } from "../../../../../../entities/EntityPicker";
import { entityIdentifier, entityKey } from "../../../../../../entities/slugs";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { useI18n } from "../../../../../../i18n/i18n";
import { agentConversationsKey, queueAgentRun, useAgents } from "../../../../models/agents";
import { supabase } from "../../../../models/db";
import { agentWorkspacesKey, useCodeRepositories, type CodeRepository } from "../../../../models/code";
import { ensureAgentWorkspace, mentionedRepos, useKickstartWorkspace } from "../../../../models/ensure";

/**
 * The vibe-coding start page (/code): one big window to prompt an idea and kickstart development,
 * with the agent to do it picked beside it. Sending it gives the conversation its workspace — made
 * with the repositories the prompt mentions (owner/name, or ones of the user's already there),
 * prepared by the same call the "Set up" button makes (its folder, git identity, clones) — and then
 * queues the agent's first run with the idea as its instructions. No hand-made workspaces, no
 * adding and preparing repositories first: the agent starts coding once the workspace is ready, and
 * the conversation it works in opens beside it.
 */
export function CodeStart() {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const agents = useAgents().data ?? [];
  const repos = useCodeRepositories().data ?? [];
  const [idea, setIdea] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const ensure = useKickstartWorkspace();
  const queryClient = useQueryClient();
  const trim = idea.trim();
  const agent = agents.find((a) => a.id === agentId) ?? null;
  // The prompt's repositories, with the ones the user has connected marked as ready to clone.
  const mentioned = useMemo(() => mentionedRepos(trim), [trim]);
  const known = (name: string): CodeRepository | undefined =>
    repos.find((r) => r.full_name?.toLowerCase() === name.toLowerCase()) ??
    repos.find((r) => name.toLowerCase().endsWith(`/${r.name.toLowerCase()}`));

  const send = useMutation({
    mutationFn: async () => {
      if (!agent) throw new Error(t("code.start.noAgent"));
      // The agent's main conversation with the account is where the idea plays out.
      const { data: conversationId, error } = await supabase.rpc("open_agent_conversation", { p_agent_id: agent.id, p_with_kind: "account" });
      if (error) throw error;
      const { workspace } = await ensureAgentWorkspace({
        conversationId: conversationId as string,
        agentId: agent.id,
        repositoryUrls: mentioned,
        title: titleOf(trim),
      });
      await queueAgentRun({ agentId: agent.id, trigger: "message", conversationId: conversationId as string, instructions: trim });
      return { conversationId: conversationId as string, workspace };
    },
    onSuccess: ({ conversationId }) => {
      void queryClient.invalidateQueries({ queryKey: agentWorkspacesKey });
      if (agent) void queryClient.invalidateQueries({ queryKey: agentConversationsKey(agent.id) });
      setIdea("");
      go(`/agents/${entityKey(agent!)}/conversations/${entityIdentifier(conversationId)}`);
    },
  });

  const agentOptions: EntityOption[] = agents.map((a) => ({ type: "agent", id: a.id, title: a.name, subtitle: `@${a.username}` }));
  const busy = send.isPending || ensure.isPending;
  const status = busy ? (
    <p className="muted code-start__status" data-tour="code-start-status">
      {t("code.start.preparing")}
    </p>
  ) : mentioned.length ? (
    <div className="code-start__chips">
      {mentioned.map((name) => (
        <Badge key={name} tone={known(name) ? "success" : "default"}>
          {known(name) ? t("code.start.willClone", { name }) : t("code.start.willAsk", { name })}
        </Badge>
      ))}
    </div>
  ) : (
    <p className="muted code-start__status">{t("code.start.hint")}</p>
  );

  return (
    <Card className="code-start">
      <div className="code-start__head">
        <h2 className="panel-title">{t("code.start.title")}</h2>
        <p className="muted">{t("code.start.intro")}</p>
      </div>
      <textarea
        className="code-start__prompt"
        rows={7}
        placeholder={t("code.start.placeholder")}
        aria-label={t("code.start.title")}
        value={idea}
        autoFocus
        onChange={(e) => setIdea(e.target.value)}
        onKeyDown={(e) => {
          // Mod+Enter sends, like the chat composer, so a prompt can hold many lines.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && trim && agent && !busy) {
            e.preventDefault();
            send.mutate();
          }
        }}
      />
      <div className="code-start__foot">
        <EntityPicker
          label={t("code.start.agent")}
          types={["agent"]}
          options={agentOptions}
          value={agentId}
          onChange={(value) => setAgentId(value)}
          hint={t("code.start.agentHint")}
          placeholder={t("code.start.agentPlaceholder")}
        />
        <Button tone="primary" disabled={!trim || !agent || busy} loading={busy} onClick={() => send.mutate()} data-tour="code-start-go">
          {t("code.start.send")}
        </Button>
      </div>
      {status}
      {send.error ? <p className="bungalow-help bungalow-help--error">{send.error.message}</p> : null}
      {ensure.error ? <p className="bungalow-help bungalow-help--error">{ensure.error.message}</p> : null}
    </Card>
  );
}

/** A short title for the workspace from the idea's first line. */
function titleOf(idea: string): string | null {
  const line = idea.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 80 ? `${line.trimEnd().slice(0, 77)}…` : line.trim() || null;
}
