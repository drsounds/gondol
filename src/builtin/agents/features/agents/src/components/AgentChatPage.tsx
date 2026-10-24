import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Icon } from "../../../../../../design-system/bungalow-79d923";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { entityIdentifier, entityKey, uuidFromIdentifier } from "../../../../../../entities/slugs";
import { closeEditBackTo, useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { PageNotFound } from "../../../../../../shell/PageNotFound";
import { supabase } from "../../../../models/db";
import { useAgentEgos } from "../../../../models/host";
import { useI18n } from "../../../../../../i18n/i18n";
import { toEntityUri } from "../../../../../../entities/uri";
import {
  agentConversationsKey,
  agentConversationPath,
  createAgentConversation,
  findAgent,
  openAgentConversation,
  useAgentAvailability,
  useAgentConversation,
  useAgentConversations,
  type Agent,
  type AgentConversation,
  type AgentMessage,
} from "../../../../models/agents";
import { setVisibleAgentConversation } from "../../../../models/intercom";
import { AgentAvatar } from "./AgentAvatar";
import { AgentChat } from "./AgentChat";
import { AgentDeletedMessagesSheet, AgentMessageSheet } from "./AgentMessageSheets";
import { useAgentActions } from "./useAgentActions";
import { useAvailabilityText } from "./useAvailabilityText";

/**
 * Talking with an agent (`/agents/$agent`, its main conversation with you). The agent's other
 * conversations are listed beside it (on phones behind the "Conversations" button): ones you
 * started next to the main one (`/agents/$agent/conversations/$id`), the main ones with your egos
 * (`…/messages/ego/$ego`) and with other agents (`…/messages/agent/$agent`). The header has the
 * agent's menu (⋯: a new conversation, deleted messages, edit, suspend, fire, …) and a cog to its
 * settings (`/agents/$agent/settings`: profile, schedules, work log). Under a conversation's path,
 * `threads/$message` opens a thread, `message/$message/edit` edits one of your messages and
 * `deleted` lists its deleted messages to restore.
 */
export function AgentChatPage({ agent, agents, parts, onQueued }: { agent: Agent; agents: Agent[]; parts: string[]; onQueued: () => void }) {
  const { t, intlLocale } = useI18n();
  const go = useNavigateKeepingSearch();
  const queryClient = useQueryClient();
  const egos = useAgentEgos();
  const actions = useAgentActions(() => go("/agents"));
  const availability = useAgentAvailability([agent.id]).data?.get(agent.id);
  const availabilityText = useAvailabilityText();
  const conversations = useAgentConversations(agent.id);
  const [listOpen, setListOpen] = useState(false);
  const agentBase = `/agents/${entityKey(agent)}`;

  // Which conversation the path names, and what's left of it (a thread, a sheet).
  let base = agentBase;
  let rest = parts;
  let party: { kind: "account" | "ego" | "agent"; key: string | null } | null = { kind: "account", key: null };
  let byId: string | null = null;
  if (parts[0] === "conversations") {
    byId = parts[1] ? (uuidFromIdentifier(parts[1]) ?? parts[1]) : null;
    base = `${agentBase}/conversations/${parts[1] ?? ""}`;
    rest = parts.slice(2);
    party = null;
  } else if (parts[0] === "messages") {
    const kind = parts[1] === "ego" ? "ego" : parts[1] === "agent" ? "agent" : parts[1] === "me" ? "account" : null;
    const size = kind === "account" ? 2 : 3;
    party = kind ? { kind, key: kind === "account" ? null : (parts[2] ?? null) } : null;
    base = `${agentBase}/${parts.slice(0, size).join("/")}`;
    rest = parts.slice(size);
  }
  const ego = party?.kind === "ego" ? egos.data?.find((e) => e.username === party.key) : undefined;
  const other = party?.kind === "agent" ? findAgent(agents, party.key ?? "") : undefined;
  const withId = party?.kind === "ego" ? (ego?.id ?? null) : party?.kind === "agent" ? (other?.id ?? null) : null;
  const partyResolved = !!party && (party.kind === "account" || !!withId);

  const opened = useQuery({
    queryKey: ["agent-conversation-open", agent.id, party?.kind ?? "", withId],
    enabled: partyResolved,
    staleTime: Infinity,
    queryFn: async () => {
      const id = await openAgentConversation(agent.id, party!.kind, withId);
      void queryClient.invalidateQueries({ queryKey: agentConversationsKey(agent.id) });
      return id;
    },
  });
  const conversationId = byId ?? opened.data ?? null;
  const conversation = useAgentConversation(conversationId);
  const current = conversation.data ?? null;

  const threadId = rest[0] === "threads" && rest[1] ? (uuidFromIdentifier(rest[1]) ?? rest[1]) : null;
  const editingId = rest[0] === "message" && rest[2] === "edit" && rest[1] ? (uuidFromIdentifier(rest[1]) ?? rest[1]) : null;
  const showDeleted = rest[0] === "deleted";
  const threadPath = (id: string | null) => (id ? `${base}/threads/${entityIdentifier(id)}` : base);
  const [sheetBack, setSheetBack] = useState<string | null>(null);

  // A conversation just left closes the list on phones.
  useEffect(() => setListOpen(false), [conversationId]);
  // The intercom hides this conversation's bubble while it's on screen, and makes it one when it's left.
  const shownId = conversation.data?.id ?? null;
  useEffect(() => {
    setVisibleAgentConversation(shownId ? { conversationId: shownId, agentId: agent.id } : null);
    return () => setVisibleAgentConversation(null);
  }, [shownId, agent.id]);

  const start = useMutation({
    mutationFn: () => createAgentConversation(agent.id),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: agentConversationsKey(agent.id) });
      go(`${agentBase}/conversations/${entityIdentifier(created.id)}`);
    },
  });
  const removeConversation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agent_conversations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: agentConversationsKey(agent.id) });
      if (id === conversationId) go(agentBase);
    },
  });

  if ((party === null && parts[0] !== "conversations") || (party && !partyResolved && !egos.isLoading)) return <PageNotFound />;
  if (byId && conversation.isSuccess && !current) return <PageNotFound />;

  const settings = () => go(`${agentBase}/settings`);
  const edit = () => {
    closeEditBackTo(`${agentBase}/edit`, base);
    go(`${agentBase}/edit`);
  };
  const egoList = egos.data ?? [];
  const labelOf = (c: AgentConversation) => {
    if (!c.is_main) return c.title || t("agents.chat.untitled");
    if (c.with_kind === "account") return t("agents.chat.main");
    if (c.with_kind === "ego") {
      const e = egoList.find((x) => x.id === c.with_ego_id);
      return e ? t("agents.chat.asEgo", { name: e.name }) : t("agents.deletedEgo");
    }
    const o = agents.find((a) => a.id === (c.agent_id === agent.id ? c.with_agent_id : c.agent_id));
    return o ? t("agents.talkWith", { name: o.name }) : t("agents.deletedAgent");
  };
  const list = [...(conversations.data ?? [])].sort((a, b) =>
    a.is_main && a.with_kind === "account" ? -1 : b.is_main && b.with_kind === "account" ? 1 : (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at),
  );
  const nameOf = (m: AgentMessage) =>
    m.author_kind === "agent" ? (agents.find((a) => a.id === m.author_agent_id)?.name ?? t("agents.deletedAgent")) : m.author_kind === "ego" ? (ego?.name ?? "") : t("agents.withYou");
  const pairName = current?.with_kind === "agent" ? agents.find((a) => a.id === (current.agent_id === agent.id ? current.with_agent_id : current.agent_id))?.name : null;
  const title = current && (!current.is_main || current.with_kind !== "account") ? (pairName ? t("agents.agentsTalking", { a: agent.name, b: pairName }) : labelOf(current)) : agent.name;

  return (
    <Card>
      <div className={`agent-chat agent-chat-page${listOpen ? " agent-chat-page--list" : ""}`}>
        <div className="agent-chat__head">
          <button type="button" className="agent-chat__icon-button" onClick={() => go("/agents")} aria-label={t("agents.title")} title={t("agents.title")}>
            ←
          </button>
          <AgentAvatar name={agent.name} mediaId={agent.avatar_media_id} size="md" working={availability?.working} />
          <div className="agent-chat__title">
            <strong>{title}</strong>
            <span className="muted">
              {[title !== agent.name ? agent.name : agent.title, availabilityText(agent, availability), ego ? t("agents.talkingAs", { name: `${ego.name} (@${ego.username})` }) : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <button
            type="button"
            className="agent-chat__icon-button agent-chat__list-toggle"
            aria-expanded={listOpen}
            onClick={() => setListOpen((v) => !v)}
            aria-label={t("agents.chat.conversations")}
            title={t("agents.chat.conversations")}
          >
            <Icon name="chat" />
          </button>
          <button type="button" className="agent-chat__icon-button" onClick={settings} aria-label={t("agents.chat.settings")} title={t("agents.chat.settings")}>
            <Icon name="settings" />
          </button>
          <ActionMenu
            row={false}
            name={agent.name}
            uri={toEntityUri("agent", agent.id)}
            actions={[
              { key: "new-conversation", label: t("agents.chat.newConversation"), disabled: agent.status === "fired", onSelect: () => start.mutate() },
              { key: "conversations", label: t("agents.chat.conversations"), onSelect: () => setListOpen(true) },
              ...(current ? [{ key: "deleted", label: t("agents.chat.deletedMessages"), onSelect: () => go(`${base}/deleted`) }] : []),
              { key: "settings", label: t("agents.chat.settings"), onSelect: settings },
              { key: "edit", label: t("actions.edit"), onSelect: edit },
              ...actions.statusActions(agent).filter((a) => a.key !== "message"),
              { key: "delete", label: t("actions.delete"), tone: "danger" as const, onSelect: () => actions.confirmDelete(agent) },
            ]}
          />
        </div>

        <div className="agent-chat-page__grid">
          <aside className="agent-chat-page__list" aria-label={t("agents.chat.conversations")}>
            <Button type="button" size="sm" variant="outline" onClick={() => start.mutate()} loading={start.isPending} disabled={agent.status === "fired"}>
              <Icon name="plus" /> {t("agents.chat.newConversation")}
            </Button>
            <ul className="agent-chat-page__conversations">
              {list.map((c) => {
                const path = agentConversationPath(agent, agents, egoList, c);
                return (
                  <li key={c.id} className="agent-chat-page__conversation-row action-row">
                    <button type="button" className="agent-chat-page__conversation" aria-current={c.id === conversationId ? "page" : undefined} disabled={!path} onClick={() => path && go(path)}>
                      <span className="agent-chat-page__conversation-title">{labelOf(c)}</span>
                      <span className="muted">
                        {c.last_message_at ? new Date(c.last_message_at).toLocaleString(intlLocale, { dateStyle: "short", timeStyle: "short" }) : t("agents.noMessages")}
                      </span>
                    </button>
                    {c.is_main ? null : (
                      <ActionMenu
                        name={labelOf(c)}
                        actions={[
                          { key: "open", label: t("actions.open"), onSelect: () => path && go(path) },
                          {
                            key: "delete",
                            label: t("agents.chat.deleteConversation"),
                            tone: "danger",
                            onSelect: () => window.confirm(t("agents.chat.confirmDeleteConversation")) && removeConversation.mutate(c.id),
                          },
                        ]}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="agent-chat-page__chat">
            {current ? (
              <AgentChat
                key={current.id}
                agent={agent}
                agents={agents}
                conversation={current}
                threadId={threadId}
                onThread={(id) => go(threadPath(id))}
                onEditMessage={(m) => {
                  setSheetBack(threadId ? threadPath(threadId) : base);
                  go(`${base}/message/${entityIdentifier(m.id)}/edit`);
                }}
                onQueued={onQueued}
              />
            ) : (
              <p className="muted">{opened.error || conversation.error ? (opened.error ?? conversation.error)?.message : t("app.loading")}</p>
            )}
          </section>
        </div>
        {start.error ? <p className="bungalow-help bungalow-help--error">{start.error.message}</p> : null}
      </div>

      {current && editingId ? (
        <AgentMessageSheet
          conversation={current}
          messageId={editingId}
          canAsk={agent.status === "active"}
          onQueued={onQueued}
          onClose={() => {
            go(sheetBack ?? base);
            setSheetBack(null);
          }}
        />
      ) : null}
      {current && showDeleted ? <AgentDeletedMessagesSheet conversation={current} nameOf={nameOf} onOpenThread={(id) => go(threadPath(id))} onClose={() => go(base)} /> : null}
    </Card>
  );
}
