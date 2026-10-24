import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Icon, Select } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { fetchAppCatalog } from "../../../../../../api/client";
import { ActionMenu, type MenuAction } from "../../../../../../entities/ActionMenu";
import { entityIdentifier, uuidFromIdentifier } from "../../../../../../entities/slugs";
import { copyText, showToast } from "../../../../../../shell/clipboard";
import {
  AiProviderError,
  aiAppCatalogKey,
  aiSourceKey,
  appToolsEnabled,
  getAiProvider,
  replyCounts,
  repliesByParent,
  scopeKey,
  threadAncestors,
  useAiAppTools,
  useAiChat,
  useAiConversations,
  useAiMessages,
  useAiModelChoices,
  useAiSettings,
  useAppRouterScope,
  useDeleteAiConversation,
  useUpdateAiMessage,
  type AiChatTarget,
  type AiMessage,
  type AiMetrics,
  type AiSettings,
  type AiToolApproval,
  type AiToolDecision,
} from "../../../../models";
import { Markdown } from "../components/Markdown";
import { AiSettingsSheet } from "../components/AiSettingsSheet";
import { AiDeletedMessagesSheet, AiMessageSheet } from "../components/AiMessageSheets";

/**
 * The AI chat (`/ai`, `/ai/new`, `/ai/<conversation id>`): the user's conversations beside the open
 * one (on wide screens; phones have them in the menu), its messages, and a box to write the next;
 * the answer streams in from the model picked. With the `composerPosition` setting at `top` the box
 * comes first and the latest exchange right under it. `/ai/settings` and
 * `/ai/<conversation id>/settings` open the AI settings over it.
 *
 * Any message can have a thread of replies, and replies threads of their own, to any depth:
 * `/ai/<id>/threads/<message>` opens one beside the conversation (in its place on phones), and the
 * model answers there from the way to it and the thread so far. Each message has a menu (⋯ on
 * hover, a right-click, or holding it on a touch screen): reply in a thread, copy, edit
 * (`/ai/<id>/messages/<message>/edit`), regenerate or retry an answer, answer a question again,
 * and delete. Deleted messages show as deleted and are restored from `/ai/<id>/deleted`.
 */
export function AiChatPage({ splat }: AppFeaturePageProps) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const parts = (splat ?? "").split("/").filter(Boolean);
  const showSettings = parts[parts.length - 1] === "settings";
  const conversationId = parts[0] && parts[0] !== "new" && parts[0] !== "settings" ? parts[0] : null;
  const here = conversationId ? `/ai/${conversationId}` : "/ai";
  const messageKey = (key: string | undefined) => (key ? (uuidFromIdentifier(key) ?? key) : null);
  const threadId = conversationId && parts[1] === "threads" ? messageKey(parts[2]) : null;
  const editingId = conversationId && parts[1] === "messages" && parts[3] === "edit" ? messageKey(parts[2]) : null;
  const showDeleted = !!conversationId && parts[1] === "deleted";
  const threadPath = (id: string) => `${here}/threads/${entityIdentifier(id)}`;
  // Sheets opened from a thread close back to it.
  const [sheetBack, setSheetBack] = useState<string | null>(null);
  const { settings } = useAiSettings();
  const conversations = useAiConversations();
  const conversation = conversations.data?.find((c) => c.id === conversationId) ?? null;
  const messages = useAiMessages(conversationId);
  const remove = useDeleteAiConversation();
  const [showApps, setShowApps] = useState(false);
  const appTools = useAiAppTools(settings);

  const current = useMemo(
    () => (conversation ? { provider: conversation.provider, serviceId: conversation.service_id ?? null, model: conversation.model } : null),
    [conversation],
  );
  const models = useAiModelChoices(settings, current);
  const sources = models.sources;
  type Picked = { provider: string; serviceId: string | null; model: string };
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => setPicked(null), [conversationId]);
  const defaultModel = typeof settings.defaultModel === "string" && settings.defaultModel.trim() ? settings.defaultModel.trim() : null;
  const fallback = models.choices.find((c) => c.name === defaultModel) ?? models.choices[0];
  const target: Picked = picked ??
    (conversation?.model ? { provider: conversation.provider, serviceId: conversation.service_id ?? null, model: conversation.model } : null) ?? {
      provider: fallback?.provider ?? sources[0]?.provider.id ?? "ollama",
      serviceId: fallback?.serviceId ?? sources[0]?.service?.id ?? null,
      model: fallback?.name ?? "",
    };
  // The service the target names; a conversation whose service is gone uses the provider's settings.
  const source = sources.find((s) => s.key === aiSourceKey(target.provider, target.serviceId));
  const service = target.serviceId ? (source?.service ?? null) : null;
  const choiceValue = (provider: string, serviceId: string | null, model: string) => [provider, serviceId ?? "", model].join("\u0000");

  const onConversationCreated = useCallback((created: { id: string }) => go(`/ai/${created.id}`), [go]);
  const chat = useAiChat(settings, { onConversationCreated, tools: appTools.tools });
  const streaming = chat.streaming && (chat.streaming.conversationId === conversationId || !conversationId) ? chat.streaming : null;
  const approval = chat.approval && streaming && chat.approval.conversationId === streaming.conversationId ? chat.approval : null;
  const update = useUpdateAiMessage();

  const onTop = settings.composerPosition === "top";
  const list = useRef<HTMLDivElement>(null);
  const all = useMemo(() => messages.data ?? [], [messages.data]);
  const byParent = useMemo(() => repliesByParent(all), [all]);
  const counts = useMemo(() => replyCounts(all), [all]);
  // The conversation's own line; replies live in threads.
  const shown = byParent.get(null) ?? [];
  const thread = threadId ? (all.find((m) => m.id === threadId) ?? null) : null;
  const inLine = streaming && streaming.parentId === null && !streaming.replacing ? streaming : null;
  // The question being answered, shown above the answer as it streams in.
  const last = shown[shown.length - 1];
  const asking = inLine && last?.role === "user" ? last : null;
  useEffect(() => {
    list.current?.scrollTo({ top: onTop ? 0 : list.current.scrollHeight });
  }, [shown.length, inLine?.content, approval, onTop]);

  const error = chat.error ?? (models.error && !models.choices.length ? models.error : null);
  const provider = getAiProvider(target.provider);

  const chatTarget: AiChatTarget = { conversation, provider: target.provider, service, model: target.model || null };
  const composer = (
    <Composer
      busy={chat.busy}
      disabled={!target.model}
      sendWith={settings.sendWith === "modEnter" ? "modEnter" : "enter"}
      onSend={(text) => {
        chat.clearError();
        void chat.send(text, chatTarget);
      }}
      onStop={chat.stop}
    />
  );

  /** A message's menu: reply in a thread, copy, edit, write an answer again, delete. */
  const actionsFor = (message: AiMessage): MenuAction[] => {
    const busy = chat.busy || !target.model;
    const fromThread = threadId ? threadPath(threadId) : here;
    return [
      { key: "thread", label: t("ai.message.reply"), onSelect: () => go(threadPath(message.id)) },
      { key: "copy", label: t("ai.message.copy"), disabled: !message.content, onSelect: () => copyText(message.content, t("ai.message.copied"), t("actions.copyFailed")) },
      ...(message.role === "user"
        ? [
            {
              key: "edit",
              label: t("actions.edit"),
              onSelect: () => {
                setSheetBack(fromThread);
                go(`${here}/messages/${entityIdentifier(message.id)}/edit`);
              },
            },
            { key: "answer-again", label: t("ai.message.answerAgain"), disabled: busy, onSelect: () => void chat.answerAgain(message, chatTarget) },
          ]
        : [
            {
              key: "regenerate",
              label: message.error ? t("ai.message.retry") : t("ai.message.regenerate"),
              disabled: busy,
              onSelect: () => void chat.regenerate(message, chatTarget),
            },
          ]),
      {
        key: "delete",
        label: t("actions.delete"),
        tone: "danger",
        onSelect: () => update.mutate({ id: message.id, deleted: true }, { onSuccess: () => showToast(t("ai.message.deletedToast")) }),
      },
    ];
  };
  /** A message where it sits: the answer being written again in its place, else the message itself. */
  const bubble = (message: AiMessage) =>
    streaming?.replacing === message.id ? (
      <div key={message.id}>{answerBeingWritten}</div>
    ) : (
      <MessageBubble
        key={message.id}
        message={message}
        showMetrics={settings.showMetrics === true}
        replies={counts.get(message.id) ?? 0}
        onOpenThread={() => go(threadPath(message.id))}
        actions={actionsFor(message)}
      />
    );

  const answerBeingWritten = streaming ? (
    <div className="ai-message ai-message--assistant ai-message--streaming" aria-live="polite">
      <div className="ai-message__body">
        {streaming.content ? <Markdown source={streaming.content} /> : approval ? null : <span className="ai-message__typing">{t("ai.thinking")}</span>}
        {approval ? <ToolApprovalCard approval={approval} onDecide={chat.decide} /> : null}
      </div>
      {streaming.tool && !approval ? <div className="ai-message__meta ai-message__tool">{t("ai.usingTool", { tool: streaming.tool })}</div> : null}
    </div>
  ) : null;

  return (
    <div className={`ai-chat${onTop ? " ai-chat--composer-top" : ""}${threadId ? " ai-chat--thread" : ""}`}>
      <aside className="ai-chat__conversations" aria-label={t("ai.conversations")}>
        <Button type="button" variant="outline" size="sm" className="ai-chat__new" onClick={() => go("/ai/new")}>
          <Icon name="plus" /> {t("ai.newConversation")}
        </Button>
        {conversations.isLoading ? <p className="muted">{t("app.loading")}</p> : null}
        {conversations.data && !conversations.data.length ? <p className="muted">{t("ai.noConversations")}</p> : null}
        <ul className="ai-chat__conversation-list">
          {(conversations.data ?? []).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="ai-chat__conversation"
                aria-current={c.id === conversationId ? "page" : undefined}
                onClick={() => go(`/ai/${c.id}`)}
              >
                <span className="ai-chat__conversation-title">{c.title || t("ai.untitled")}</span>
                {c.model ? <span className="ai-chat__conversation-model">{c.model}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="ai-chat__main">
        <header className="ai-chat__head">
          <div className="panel-title ai-chat__title">{conversation?.title || t("ai.newConversation")}</div>
          <Select
            aria-label={t("ai.model")}
            className="ai-chat__model"
            value={target.model ? choiceValue(target.provider, target.serviceId, target.model) : ""}
            onChange={(e) => {
              const [providerId, serviceId, model] = e.target.value.split("\u0000");
              setPicked(model ? { provider: providerId, serviceId: serviceId || null, model } : null);
            }}
          >
            {!target.model ? <option value="">{models.isLoading ? t("app.loading") : t("ai.pickModel")}</option> : null}
            {models.choices.map((choice) => (
              <option key={choiceValue(choice.provider, choice.serviceId, choice.name)} value={choiceValue(choice.provider, choice.serviceId, choice.name)}>
                {sources.length > 1 ? `${choice.sourceName} · ${choice.label}` : choice.label}
              </option>
            ))}
          </Select>
          <Button type="button" variant="ghost" size="sm" aria-expanded={showApps} onClick={() => setShowApps((v) => !v)}>
            <Icon name="grid" /> {t("ai.apps")}
            {appTools.tools?.tools.length ? <span className="ai-chat__apps-count">{appTools.tools.tools.length}</span> : null}
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-haspopup="dialog" onClick={() => go(`${here}/settings`)}>
            <Icon name="settings" /> {t("ai.settings")}
          </Button>
          {conversation ? (
            <ActionMenu
              row={false}
              name={conversation.title || t("ai.untitled")}
              actions={[
                { key: "deleted", label: t("ai.deletedMessages"), onSelect: () => go(`${here}/deleted`) },
                {
                  key: "delete",
                  label: t("ai.delete"),
                  tone: "danger",
                  disabled: remove.isPending,
                  onSelect: () => {
                    if (!window.confirm(t("ai.confirmDelete"))) return;
                    remove.mutate(conversation.id, { onSuccess: () => go("/ai") });
                  },
                },
              ]}
            />
          ) : null}
        </header>

        {showApps ? (
          <AppsPanel
            settings={settings}
            onAddServer={() => go("/ai-models/mcp/new")}
            toolSupport={!!provider?.supportsTools}
            error={appTools.error instanceof Error ? appTools.error.message : null}
          />
        ) : null}

        {error ? (
          <Alert tone="danger" className="ai-chat__error">
            <span>
              {error.message}
              {error instanceof AiProviderError && error.kind === "unreachable" ? (
                <>
                  {" "}
                  {t("ai.unreachableHint", { address: provider?.describe?.(settings, service) || t("ai.serverDefault") })}
                </>
              ) : null}
            </span>
          </Alert>
        ) : null}

        {onTop ? composer : null}

        <div className={`ai-chat__messages${onTop ? " ai-chat__messages--newest-first" : ""}`} ref={list}>
          {!conversationId && !inLine ? <p className="ai-chat__intro muted">{t("ai.intro")}</p> : null}
          {conversationId && messages.isLoading ? <p className="muted">{t("app.loading")}</p> : null}
          {onTop ? (
            <>
              {inLine ? (
                <div className="ai-chat__exchange">
                  {asking ? bubble(asking) : null}
                  {answerBeingWritten}
                </div>
              ) : null}
              {exchanges(asking ? shown.slice(0, -1) : shown)
                .reverse()
                .map((exchange) => (
                  <div key={exchange[0].id} className="ai-chat__exchange">
                    {exchange.map(bubble)}
                  </div>
                ))}
            </>
          ) : (
            <>
              {shown.map(bubble)}
              {inLine ? answerBeingWritten : null}
            </>
          )}
        </div>

        {onTop ? null : composer}
      </section>

      {threadId && conversationId ? (
        <ThreadPane
          message={thread}
          loading={messages.isLoading}
          ancestors={thread ? threadAncestors(all, thread.id) : []}
          replies={byParent.get(threadId) ?? []}
          bubble={bubble}
          answerBeingWritten={streaming && streaming.parentId === threadId && !streaming.replacing ? answerBeingWritten : null}
          onOpen={(id) => go(threadPath(id))}
          onClose={() => go(thread?.parent_id ? threadPath(thread.parent_id) : here)}
          composer={
            <Composer
              key={threadId}
              busy={chat.busy}
              disabled={!target.model || !thread}
              rows={2}
              placeholder={t("ai.thread.placeholder")}
              sendWith={settings.sendWith === "modEnter" ? "modEnter" : "enter"}
              onSend={(text) => {
                chat.clearError();
                void chat.send(text, chatTarget, { parentId: threadId });
              }}
              onStop={chat.stop}
            />
          }
        />
      ) : null}

      {showSettings ? <AiSettingsSheet conversationId={conversationId} onClose={() => go(here)} /> : null}
      {editingId && conversationId ? (
        <AiMessageSheet
          message={all.find((m) => m.id === editingId) ?? null}
          loading={messages.isLoading}
          answer={(() => {
            const edited = all.find((m) => m.id === editingId);
            const siblings = edited ? (byParent.get(edited.parent_id ?? null) ?? []) : [];
            const next = siblings[siblings.findIndex((m) => m.id === editingId) + 1];
            return next?.role === "assistant" && !next.soft_deleted_at ? next : null;
          })()}
          canRegenerate={!chat.busy && !!target.model}
          onRegenerate={(answer) => void chat.regenerate(answer, chatTarget)}
          onClose={() => {
            go(sheetBack ?? here);
            setSheetBack(null);
          }}
        />
      ) : null}
      {showDeleted ? <AiDeletedMessagesSheet messages={all} onClose={() => go(here)} onOpenThread={(id) => go(threadPath(id))} /> : null}
    </div>
  );
}

/** Messages in exchanges: a question with the answers after it (for the newest-first layout). */
function exchanges(messages: AiMessage[]): AiMessage[][] {
  const out: AiMessage[][] = [];
  for (const message of messages) {
    if (message.role === "user" || !out.length) out.push([message]);
    else out[out.length - 1].push(message);
  }
  return out;
}

/** A tool call the model wants to make, asked about in the answer: what it runs, with what, and the choices. */
function ToolApprovalCard({ approval, onDecide }: { approval: AiToolApproval; onDecide: (decision: AiToolDecision) => void }) {
  const { t } = useI18n();
  const { tool } = approval;
  const title = tool.title ?? tool.annotations?.title ?? tool.name;
  const entries = Object.entries(approval.arguments);
  const [app] = tool.name.split("__");
  const changes = !tool.annotations?.readOnlyHint || !!tool.annotations?.destructiveHint;
  return (
    <div className="ai-tool-ask" role="group" aria-label={t("ai.toolAsk.title", { tool: title })}>
      <div className="ai-tool-ask__head">
        <Icon name="grid" />
        <div>
          <div className="ai-tool-ask__title">{t("ai.toolAsk.title", { tool: title })}</div>
          <div className="ai-tool-ask__sub muted">
            {[app && app !== tool.name ? app : null, t(tool.annotations?.destructiveHint ? "ai.toolAsk.destructive" : changes ? "ai.toolChanges" : "ai.toolReadOnly")]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>
      {tool.description ? <p className="ai-tool-ask__description muted">{tool.description}</p> : null}
      {entries.length ? (
        <details className="ai-tool-ask__args" open={entries.length <= 4}>
          <summary>{t("ai.toolAsk.arguments")}</summary>
          <dl>
            {entries.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === "string" ? value : <code>{JSON.stringify(value, null, 2)}</code>}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      <div className="ai-tool-ask__actions">
        <Button type="button" size="sm" tone="primary" onClick={() => onDecide("once")} autoFocus>
          {t("ai.toolAsk.once")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onDecide("conversation")}>
          {t("ai.toolAsk.conversation")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onDecide("always")}>
          {t("ai.toolAsk.always")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDecide("deny")}>
          {t("ai.toolAsk.deny")}
        </Button>
      </div>
    </div>
  );
}

function formatMetrics(metrics: AiMetrics): string {
  const parts: string[] = [];
  if (metrics.completionTokens !== undefined) parts.push(`${metrics.completionTokens} tokens`);
  if (metrics.tokensPerSecond !== undefined) parts.push(`${metrics.tokensPerSecond} tok/s`);
  if (metrics.durationMs !== undefined) parts.push(`${(metrics.durationMs / 1000).toFixed(1)} s`);
  return parts.join(" · ");
}

function MessageBubble({
  message,
  showMetrics,
  replies = 0,
  onOpenThread,
  actions,
}: {
  message: AiMessage;
  showMetrics: boolean;
  replies?: number;
  onOpenThread?: () => void;
  actions?: MenuAction[];
}) {
  const { t } = useI18n();
  const tools = message.metrics?.tools ?? [];
  const repliesLink =
    replies && onOpenThread ? (
      <button type="button" className="ai-message__replies" onClick={onOpenThread}>
        {t(replies === 1 ? "ai.thread.replyOne" : "ai.thread.replies", { count: replies })}
      </button>
    ) : null;
  if (message.soft_deleted_at) {
    return (
      <div className={`ai-message ai-message--${message.role} ai-message--deleted`}>
        <div className="ai-message__body">{t("ai.message.deleted")}</div>
        {repliesLink}
      </div>
    );
  }
  return (
    <div className={`ai-message ai-message--${message.role} action-row`}>
      <div className="ai-message__row">
        {message.content ? (
          <div className="ai-message__body">{message.role === "assistant" ? <Markdown source={message.content} /> : message.content}</div>
        ) : null}
        {actions?.length ? <ActionMenu name={t(message.role === "user" ? "ai.message.yours" : "ai.message.answer")} actions={actions} /> : null}
      </div>
      {tools.length ? (
        <div className="ai-message__meta ai-message__tool">
          {t("ai.usedTools", {
            tools: tools.map((tool) => `${tool.title ?? tool.name}${tool.denied ? ` (${t("ai.toolDenied")})` : tool.ok ? "" : " ✕"}`).join(", "),
          })}
        </div>
      ) : null}
      {message.error ? <div className="ai-message__error">{message.error === "Stopped" ? t("ai.stopped") : message.error}</div> : null}
      {(message.role === "assistant" && (showMetrics || message.model)) || message.edited_at ? (
        <div className="ai-message__meta">
          {[
            message.role === "assistant" ? message.model : null,
            message.role === "assistant" && showMetrics && message.metrics ? formatMetrics(message.metrics) : "",
            message.edited_at ? t(message.role === "assistant" ? "ai.message.regenerated" : "ai.message.edited") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
      {repliesLink}
    </div>
  );
}

/**
 * A message's thread, beside the conversation: the messages it sits under (each opens its own
 * thread), the message, its replies (each with its own thread) and a box to reply.
 */
function ThreadPane({
  message,
  loading,
  ancestors,
  replies,
  bubble,
  answerBeingWritten,
  composer,
  onOpen,
  onClose,
}: {
  message: AiMessage | null;
  loading: boolean;
  ancestors: AiMessage[];
  replies: AiMessage[];
  bubble: (message: AiMessage) => ReactNode;
  answerBeingWritten: ReactNode;
  composer: ReactNode;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [replies.length, !!answerBeingWritten]);
  return (
    <aside className="ai-chat__thread" aria-label={t("ai.thread.title")}>
      <header className="ai-chat__thread-head">
        <button type="button" className="ai-chat__thread-back" onClick={onClose} aria-label={t("ai.thread.back")}>
          ←
        </button>
        <strong className="ai-chat__thread-title">{t("ai.thread.title")}</strong>
        <span className="muted">{t(replies.length === 1 ? "ai.thread.replyOne" : "ai.thread.replies", { count: replies.length })}</span>
      </header>
      <div className="ai-chat__thread-body" ref={body}>
        {ancestors.length ? (
          <nav className="ai-chat__ancestors" aria-label={t("ai.thread.inReplyTo")}>
            <div className="muted ai-chat__ancestors-label">{t("ai.thread.inReplyTo")}</div>
            {ancestors.map((a) => (
              <button key={a.id} type="button" className="ai-chat__ancestor" onClick={() => onOpen(a.id)}>
                <strong>{t(a.role === "user" ? "ai.message.yours" : "ai.message.answer")}</strong>
                <span>{a.soft_deleted_at ? t("ai.message.deleted") : a.content}</span>
              </button>
            ))}
          </nav>
        ) : null}
        {loading ? <p className="muted">{t("app.loading")}</p> : !message ? <p className="muted">{t("ai.thread.notFound")}</p> : bubble(message)}
        {message ? <div className="ai-chat__thread-divider muted">{t("ai.thread.repliesHeading")}</div> : null}
        {replies.map(bubble)}
        {answerBeingWritten}
      </div>
      {message ? composer : null}
    </aside>
  );
}

/** What the apps offer the AI: each app with its tools, from the app router's catalogue. */
function AppsPanel({ settings, toolSupport, error, onAddServer }: { settings: AiSettings; toolSupport: boolean; error: string | null; onAddServer: () => void }) {
  const { t } = useI18n();
  const enabled = appToolsEnabled(settings);
  const scope = useAppRouterScope();
  const catalog = useQuery({ queryKey: [...aiAppCatalogKey, scopeKey(scope)], enabled, retry: false, staleTime: 5 * 60_000, queryFn: ({ signal }) => fetchAppCatalog(signal) });
  const apps = (catalog.data?.apps ?? []).filter((app) => app.tools.length || app.ownMcpServer);
  const problem = error ?? (catalog.error instanceof Error ? catalog.error.message : null);
  return (
    <section className="ai-chat__apps" aria-label={t("ai.appsTitle")}>
      <div className="panel-head ai-chat__apps-head">
        <div>
          <strong>{t("ai.appsTitle")}</strong>
          <p className="muted">{t("ai.appsIntro")}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onAddServer}>
          <Icon name="plus" /> {t("ai.mcp.new")}
        </Button>
      </div>
      {!enabled ? <p className="muted">{t("ai.appsOff")}</p> : null}
      {enabled && !toolSupport ? <p className="muted">{t("ai.appsNoToolSupport")}</p> : null}
      {enabled && problem ? <p className="muted">{t("ai.appsUnavailable", { message: problem })}</p> : null}
      {enabled && catalog.isLoading ? <p className="muted">{t("app.loading")}</p> : null}
      {enabled && catalog.data && !apps.length ? <p className="muted">{t("ai.appsNone")}</p> : null}
      <ul className="ai-chat__app-list">
        {apps.map((app) => (
          <li key={app.id} className="ai-chat__app">
            <div className="ai-chat__app-name">
              {app.name}
              {app.userServer ? <span className="muted"> · {t("ai.mcp.yours")}</span> : null}
            </div>
            {app.description ? <div className="muted ai-chat__app-description">{app.description}</div> : null}
            {app.error ? <div className="ai-chat__app-description ai-message__error">{app.error}</div> : null}
            <ul className="ai-chat__tool-list">
              {app.tools.map((tool) => (
                <li key={tool.name} title={tool.description}>
                  <span>{tool.title ?? tool.name}</span>
                  <span className="muted"> · {t(tool.annotations?.readOnlyHint ? "ai.toolReadOnly" : "ai.toolChanges")}</span>
                </li>
              ))}
              {app.ownMcpServer && !app.userServer ? <li className="muted">MCP · {app.mcp}</li> : null}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Composer({
  busy,
  disabled,
  sendWith,
  rows = 3,
  placeholder,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  sendWith: "enter" | "modEnter";
  rows?: number;
  placeholder?: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim() || busy || disabled) return;
    onSend(text);
    setText("");
  };
  return (
    <form
      className="ai-chat__composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="bungalow-input ai-chat__input"
        rows={rows}
        aria-label={t("ai.message")}
        placeholder={placeholder ?? t(sendWith === "enter" ? "ai.placeholder" : "ai.placeholderMod")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          const mod = e.metaKey || e.ctrlKey;
          if (sendWith === "enter" ? !e.shiftKey && !mod : mod) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {busy ? (
        <Button type="button" variant="outline" onClick={onStop}>
          <Icon name="stop" /> {t("ai.stop")}
        </Button>
      ) : (
        <Button type="submit" tone="primary" disabled={disabled || !text.trim()}>
          {t("ai.send")}
        </Button>
      )}
    </form>
  );
}
