import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../../../../../design-system/bungalow-79d923";
import { ActionMenu, type MenuAction } from "../../../../../../entities/ActionMenu";
import { conversationTitle } from "../../../../../ai/models/conversations";
import { replyCounts, repliesByParent, threadAncestors } from "../../../../../ai/models/threads";
import { copyText, showToast } from "../../../../../../shell/clipboard";
import { supabase } from "../../../../models/db";
import { useAgentEgos } from "../../../../models/host";
import { useI18n } from "../../../../../../i18n/i18n";
import {
  agentConversationKey,
  agentConversationsKey,
  agentMessagesKey,
  agentPendingRunsKey,
  agentRunsKey,
  queueAgentRun,
  updateAgentMessage,
  useAgentMessages,
  type Agent,
  type AgentConversation,
  type AgentMessage,
  type AgentRun,
} from "../../../../models/agents";
import { AgentAvatar } from "./AgentAvatar";

type PendingRun = Pick<AgentRun, "id" | "status" | "run_after" | "speaker_agent_id" | "agent_id" | "message_parent_id" | "replace_message_id">;

/**
 * A conversation with an agent, messenger style: its own line of messages, and a thread under any
 * message (`threadId`), whose replies have threads of their own, to any depth. Every message has a
 * menu (⋯ on hover, a right-click, or holding it on a touch screen): reply in a thread, copy, edit
 * your own, ask again, have the agent write its answer again (or retry a failed one) and delete,
 * which leaves "This message was deleted" in its place until it's restored from the conversation's
 * deleted messages. The account or an ego writes and the agent answers (at once while it's at
 * work, else when its working hours start); in a conversation between two agents they take turns
 * on "Next message". The agent's side is on the left.
 *
 * On the Agents page the thread opens beside the conversation (`compact` false, on wide screens);
 * in the intercom's popups (`compact`) it takes the conversation's place.
 */
export function AgentChat({
  agent,
  agents,
  conversation,
  threadId,
  onThread,
  onEditMessage,
  onQueued,
  compact = false,
}: {
  agent: Agent;
  agents: Agent[];
  conversation: AgentConversation;
  threadId: string | null;
  onThread: (id: string | null) => void;
  onEditMessage: (message: AgentMessage) => void;
  onQueued: () => void;
  compact?: boolean;
}) {
  const { t, intlLocale } = useI18n();
  const queryClient = useQueryClient();
  const egos = useAgentEgos().data ?? [];
  const messages = useAgentMessages(conversation.id);
  const pending = useQuery({
    queryKey: agentPendingRunsKey(conversation.id),
    refetchInterval: 4_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_runs")
        .select("id, status, run_after, speaker_agent_id, agent_id, message_parent_id, replace_message_id")
        .eq("conversation_id", conversation.id)
        .in("status", ["queued", "running"])
        .order("run_after");
      if (error) throw error;
      return (data ?? []) as PendingRun[];
    },
  });
  const all = useMemo(() => messages.data ?? [], [messages.data]);
  const byParent = useMemo(() => repliesByParent(all), [all]);
  const counts = useMemo(() => replyCounts(all), [all]);
  const line = byParent.get(null) ?? [];
  const thread = threadId ? (all.find((m) => m.id === threadId) ?? null) : null;
  const waiting = pending.data ?? [];

  const ego = conversation.with_kind === "ego" ? egos.find((e) => e.id === conversation.with_ego_id) : undefined;
  const otherId = conversation.with_kind === "agent" ? (conversation.agent_id === agent.id ? conversation.with_agent_id : conversation.agent_id) : null;
  const other = otherId ? agents.find((a) => a.id === otherId) : undefined;
  const pair = conversation.with_kind === "agent";
  const nameOf = (m: AgentMessage) =>
    m.author_kind === "agent"
      ? (agents.find((a) => a.id === m.author_agent_id)?.name ?? t("agents.deletedAgent"))
      : m.author_kind === "ego"
        ? (ego?.name ?? "")
        : t("agents.withYou");
  const when = (iso: string) => new Date(iso).toLocaleString(intlLocale, { dateStyle: "short", timeStyle: "short" });

  const afterQueue = () => {
    void queryClient.invalidateQueries({ queryKey: agentPendingRunsKey(conversation.id) });
    void queryClient.invalidateQueries({ queryKey: agentRunsKey(agent.id) });
    onQueued();
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: agentMessagesKey(conversation.id) });
    void queryClient.invalidateQueries({ queryKey: agentConversationsKey(agent.id) });
  };
  const ask = useMutation({
    mutationFn: (input: { parentId: string | null; replaceId?: string | null; speakerAgentId?: string | null }) =>
      queueAgentRun({
        agentId: conversation.agent_id,
        trigger: "message",
        conversationId: conversation.id,
        messageParentId: input.parentId,
        replaceMessageId: input.replaceId ?? null,
        speakerAgentId: input.speakerAgentId ?? null,
      }),
    onSuccess: afterQueue,
  });
  const change = useMutation({
    mutationFn: ({ id, deleted }: { id: string; deleted: boolean }) => updateAgentMessage(id, { deleted }),
    onSuccess: (_data, { deleted }) => {
      refresh();
      if (deleted) showToast(t("agents.chat.deletedToast"));
    },
  });

  const speakerOf = (m: AgentMessage) => agents.find((a) => a.id === m.author_agent_id) ?? agent;
  const actionsFor = (m: AgentMessage): MenuAction[] => {
    const own = m.author_kind !== "agent";
    const speaker = own ? agent : speakerOf(m);
    return [
      { key: "thread", label: t("agents.chat.reply"), onSelect: () => onThread(m.id) },
      { key: "copy", label: t("agents.chat.copy"), disabled: !m.content, onSelect: () => copyText(m.content, t("agents.chat.copied"), t("actions.copyFailed")) },
      ...(own
        ? [
            { key: "edit", label: t("actions.edit"), onSelect: () => onEditMessage(m) },
            { key: "answer-again", label: t("agents.chat.answerAgain"), disabled: agent.status !== "active", onSelect: () => ask.mutate({ parentId: m.parent_id }) },
          ]
        : [
            {
              key: "regenerate",
              label: m.error ? t("agents.chat.retry") : t("agents.chat.regenerate"),
              disabled: speaker.status !== "active" || waiting.some((r) => r.replace_message_id === m.id),
              onSelect: () => ask.mutate({ parentId: m.parent_id, replaceId: m.id, speakerAgentId: pair ? speaker.id : null }),
            },
          ]),
      { key: "delete", label: t("actions.delete"), tone: "danger", onSelect: () => change.mutate({ id: m.id, deleted: true }) },
    ];
  };

  const bubble = (m: AgentMessage) => {
    const left = m.author_kind === "agent" && m.author_agent_id === agent.id;
    const author = m.author_kind === "agent" ? agents.find((a) => a.id === m.author_agent_id) : undefined;
    const replies = counts.get(m.id) ?? 0;
    const rewriting = waiting.some((r) => r.replace_message_id === m.id);
    const repliesLink =
      replies && m.id !== threadId ? (
        <button type="button" className="agent-bubble__replies" onClick={() => onThread(m.id)}>
          {t(replies === 1 ? "agents.chat.replyOne" : "agents.chat.replies", { count: replies })}
        </button>
      ) : null;
    if (m.soft_deleted_at) {
      return (
        <div key={m.id} className={`agent-bubble agent-bubble--deleted ${left ? "agent-bubble--agent" : "agent-bubble--other"}`}>
          <div className="agent-bubble__body">
            <div className="agent-bubble__text">{t("agents.chat.deleted")}</div>
            {repliesLink}
          </div>
        </div>
      );
    }
    return (
      <div key={m.id} className={`agent-bubble action-row ${left ? "agent-bubble--agent" : "agent-bubble--other"}`}>
        {m.author_kind === "agent" ? <AgentAvatar name={author?.name ?? "?"} mediaId={author?.avatar_media_id} size="sm" /> : null}
        <div className="agent-bubble__body">
          <div className="agent-bubble__meta">
            <span>{nameOf(m)}</span>
            <span className="muted">{when(m.created_at)}</span>
            {m.edited_at ? <span className="muted">{t(m.author_kind === "agent" ? "agents.chat.regenerated" : "agents.chat.edited")}</span> : null}
          </div>
          {m.content ? <div className="agent-bubble__text">{m.content}</div> : null}
          {m.error ? <p className="bungalow-help bungalow-help--error">{m.error}</p> : null}
          {m.metrics?.tools?.length ? (
            <div className="agent-bubble__tools muted">{t("agents.usedTools", { tools: m.metrics.tools.map((tool) => tool.title ?? tool.name).join(", ") })}</div>
          ) : null}
          {rewriting ? <div className="agent-bubble__tools muted">{t("agents.chat.rewriting", { name: author?.name ?? agent.name })}</div> : null}
          {repliesLink}
        </div>
        <ActionMenu name={t("agents.chat.messageFrom", { name: nameOf(m) })} actions={actionsFor(m)} />
      </div>
    );
  };

  /** Who is writing, or when they answer, in a thread (null: the conversation's line). */
  const status = (parentId: string | null) => {
    const here = waiting.filter((r) => (r.message_parent_id ?? null) === parentId && !r.replace_message_id);
    const busy = here.find((r) => r.status === "running");
    const later = here.find((r) => r.status === "queued" && new Date(r.run_after).getTime() > Date.now() + 60_000);
    const nameFor = (r: PendingRun) => agents.find((a) => a.id === (r.speaker_agent_id ?? r.agent_id))?.name ?? agent.name;
    if (busy) return <p className="muted agent-chat__typing">{t("agents.typing", { name: nameFor(busy) })}</p>;
    if (later) return <p className="muted agent-chat__typing">{t("agents.answersLater", { name: nameFor(later), when: when(later.run_after) })}</p>;
    return null;
  };

  const lineList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    lineList.current?.scrollTo({ top: lineList.current.scrollHeight });
  }, [line.length, waiting.length]);

  const empty = !messages.isLoading && !line.length ? (
    <p className="muted agent-chat__empty">{pair ? t("agents.agentsEmpty") : t("agents.chatEmpty", { name: agent.name })}</p>
  ) : null;

  const composer = (parentId: string | null) =>
    pair ? (
      <PairComposer key={parentId ?? "line"} agent={agent} other={other} conversation={conversation} parentId={parentId} messages={all} busy={waiting.some((r) => r.status === "running")} onQueued={afterQueue} />
    ) : (
      <MessageComposer
        key={parentId ?? "line"}
        agent={agent}
        conversation={conversation}
        parentId={parentId}
        egoId={conversation.with_kind === "ego" ? conversation.with_ego_id : null}
        firstMessage={!all.length}
        compact={compact}
        onSent={() => {
          refresh();
          afterQueue();
        }}
      />
    );

  const errorText = (ask.error ?? change.error)?.message;
  const main = (
    <div className="agent-chat__line">
      <div className="agent-chat__messages" ref={lineList}>
        {messages.isLoading ? <p className="muted">{t("app.loading")}</p> : null}
        {empty}
        {line.map(bubble)}
        {status(null)}
      </div>
      {composer(null)}
    </div>
  );

  return (
    <div className={`agent-chat__body${threadId ? " agent-chat__body--thread" : ""}${compact ? " agent-chat__body--compact" : ""}`}>
      {main}
      {threadId ? (
        <ThreadPane
          message={thread}
          loading={messages.isLoading}
          ancestors={thread ? threadAncestors(all, thread.id) : []}
          replies={byParent.get(threadId) ?? []}
          bubble={bubble}
          status={status(threadId)}
          composer={thread && !thread.soft_deleted_at ? composer(threadId) : null}
          nameOf={nameOf}
          onOpen={(id) => onThread(id)}
          onClose={() => onThread(thread?.parent_id ?? null)}
        />
      ) : null}
      {errorText ? <p className="bungalow-help bungalow-help--error">{errorText}</p> : null}
    </div>
  );
}

function ThreadPane({
  message,
  loading,
  ancestors,
  replies,
  bubble,
  status,
  composer,
  nameOf,
  onOpen,
  onClose,
}: {
  message: AgentMessage | null;
  loading: boolean;
  ancestors: AgentMessage[];
  replies: AgentMessage[];
  bubble: (m: AgentMessage) => ReactNode;
  status: ReactNode;
  composer: ReactNode;
  nameOf: (m: AgentMessage) => string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const body = useRef<HTMLDivElement>(null);
  const writing = !!status;
  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [replies.length, writing]);
  return (
    <aside className="agent-chat__thread" aria-label={t("agents.chat.thread")}>
      <header className="agent-chat__thread-head">
        <button type="button" className="agent-chat__icon-button" onClick={onClose} aria-label={t("agents.chat.back")} title={t("agents.chat.back")}>
          ←
        </button>
        <strong className="agent-chat__thread-title">{t("agents.chat.thread")}</strong>
        <span className="muted">{t(replies.length === 1 ? "agents.chat.replyOne" : "agents.chat.replies", { count: replies.length })}</span>
      </header>
      <div className="agent-chat__thread-body" ref={body}>
        {ancestors.length ? (
          <nav className="agent-chat__ancestors" aria-label={t("agents.chat.inReplyTo")}>
            <div className="muted agent-chat__ancestors-label">{t("agents.chat.inReplyTo")}</div>
            {ancestors.map((a) => (
              <button key={a.id} type="button" className="agent-chat__ancestor" onClick={() => onOpen(a.id)}>
                <strong>{nameOf(a)}</strong>
                <span>{a.soft_deleted_at ? t("agents.chat.deleted") : a.content}</span>
              </button>
            ))}
          </nav>
        ) : null}
        {loading ? <p className="muted">{t("app.loading")}</p> : !message ? <p className="muted">{t("agents.chat.notFound")}</p> : bubble(message)}
        {message ? <div className="agent-chat__thread-divider muted">{t("agents.chat.repliesHeading")}</div> : null}
        {replies.map(bubble)}
        {status}
      </div>
      {composer}
    </aside>
  );
}

/** The box the account or an ego writes in, on the conversation's line or in a thread. */
function MessageComposer({
  agent,
  conversation,
  parentId,
  egoId,
  firstMessage,
  compact,
  onSent,
}: {
  agent: Agent;
  conversation: AgentConversation;
  parentId: string | null;
  egoId: string | null;
  firstMessage: boolean;
  compact: boolean;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.from("agent_messages").insert({
        conversation_id: conversation.id,
        parent_id: parentId,
        author_kind: egoId ? "ego" : "account",
        author_ego_id: egoId,
        content: body,
      });
      if (error) throw error;
      // A conversation started beside the main one is named after its first message.
      if (firstMessage && !conversation.is_main && !conversation.title) {
        await supabase.from("agent_conversations").update({ title: conversationTitle(body) }).eq("id", conversation.id);
        void queryClient.invalidateQueries({ queryKey: agentConversationKey(conversation.id) });
      }
      await queueAgentRun({ agentId: agent.id, trigger: "message", conversationId: conversation.id, messageParentId: parentId });
    },
    onSuccess: () => {
      setText("");
      onSent();
    },
  });
  const submit = () => {
    if (text.trim() && !send.isPending) send.mutate(text.trim());
  };
  return (
    <form
      className="agent-chat__composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="bungalow-input form-textarea"
        rows={compact ? 1 : 2}
        placeholder={
          agent.status !== "active"
            ? t("agents.notActive", { name: agent.name })
            : parentId
              ? t("agents.chat.threadPlaceholder")
              : t("agents.messagePlaceholder", { name: agent.name })
        }
        aria-label={t("agents.message")}
        value={text}
        disabled={agent.status === "fired"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button type="submit" tone="primary" size={compact ? "sm" : undefined} disabled={!text.trim() || send.isPending || agent.status === "fired"}>
        {t("agents.send")}
      </Button>
      {send.error ? <p className="bungalow-help bungalow-help--error">{send.error.message}</p> : null}
    </form>
  );
}

/** Two agents take turns: whoever didn't write last in the thread speaks next (the agent in the URL starts). */
function PairComposer({
  agent,
  other,
  conversation,
  parentId,
  messages,
  busy,
  onQueued,
}: {
  agent: Agent;
  other: Agent | undefined;
  conversation: AgentConversation;
  parentId: string | null;
  messages: AgentMessage[];
  busy: boolean;
  onQueued: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState<string | null>(null);
  const here = messages.filter((m) => (m.parent_id ?? null) === parentId && !m.soft_deleted_at);
  const lastAgent = [...here].reverse().find((m) => m.author_kind === "agent")?.author_agent_id;
  const nextSpeaker = other && lastAgent === agent.id ? other : agent;
  const next = useMutation({
    mutationFn: async () => {
      if (!parentId && topic !== null && topic !== (conversation.topic ?? "")) {
        const { error } = await supabase.from("agent_conversations").update({ topic: topic.trim() || null }).eq("id", conversation.id);
        if (error) throw error;
        void queryClient.invalidateQueries({ queryKey: agentConversationKey(conversation.id) });
        void queryClient.invalidateQueries({ queryKey: ["agent-conversation"] });
      }
      await queueAgentRun({ agentId: conversation.agent_id, trigger: "message", conversationId: conversation.id, speakerAgentId: nextSpeaker.id, messageParentId: parentId });
    },
    onSuccess: onQueued,
  });
  return (
    <div className="agent-chat__composer">
      {parentId ? null : (
        <textarea
          className="bungalow-input form-textarea"
          rows={2}
          placeholder={t("agents.topicPlaceholder")}
          aria-label={t("agents.topic")}
          value={topic ?? conversation.topic ?? ""}
          onChange={(e) => setTopic(e.target.value)}
        />
      )}
      <Button tone="primary" disabled={next.isPending || busy || nextSpeaker.status !== "active"} onClick={() => next.mutate()}>
        {t("agents.nextMessage", { name: nextSpeaker.name })}
      </Button>
      {next.error ? <p className="bungalow-help bungalow-help--error">{next.error.message}</p> : null}
    </div>
  );
}
