import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Icon, Select } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { AppSettingsPanel } from "../../../../../../settings/AppSettingsPanel";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { fetchAppCatalog } from "../../../../../../api/client";
import {
  AiProviderError,
  appToolsEnabled,
  enabledAiProviders,
  getAiProvider,
  useAiAppTools,
  useAiChat,
  useAiConversations,
  useAiMessages,
  useAiModelChoices,
  useAiSettings,
  useDeleteAiConversation,
  type AiMessage,
  type AiMetrics,
  type AiSettings,
  type McpTool,
} from "../../../../models";

/**
 * The AI chat (`/ai`, `/ai/new`, `/ai/<conversation id>`): the user's conversations beside the open
 * one, its messages, and a box to write the next; the answer streams in from the model picked.
 */
export function AiChatPage({ splat }: AppFeaturePageProps) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const conversationId = splat && splat !== "new" ? splat.split("/")[0] : null;
  const { settings } = useAiSettings();
  const conversations = useAiConversations();
  const conversation = conversations.data?.find((c) => c.id === conversationId) ?? null;
  const messages = useAiMessages(conversationId);
  const remove = useDeleteAiConversation();
  const [showSettings, setShowSettings] = useState(false);
  const [showApps, setShowApps] = useState(false);
  const appTools = useAiAppTools(settings);

  const providers = enabledAiProviders(settings);
  const defaultProvider = providers[0]?.id ?? "ollama";
  const current = useMemo(
    () => (conversation ? { provider: conversation.provider, model: conversation.model } : null),
    [conversation],
  );
  const models = useAiModelChoices(settings, current);
  const [picked, setPicked] = useState<{ provider: string; model: string } | null>(null);
  useEffect(() => setPicked(null), [conversationId]);
  const defaultModel = typeof settings.defaultModel === "string" && settings.defaultModel.trim() ? settings.defaultModel.trim() : null;
  const target = picked ?? (conversation?.model ? { provider: conversation.provider, model: conversation.model } : null) ?? {
    provider: defaultProvider,
    model: defaultModel ?? models.choices[0]?.name ?? "",
  };

  const confirmTool = useCallback(
    (tool: McpTool, args: Record<string, unknown>) => window.confirm(t("ai.confirmTool", { tool: tool.title ?? tool.name, args: JSON.stringify(args, null, 2) })),
    [t],
  );
  const chat = useAiChat(settings, { onConversationCreated: (created) => go(`/ai/${created.id}`), tools: appTools.tools, confirmTool });
  const streaming = chat.streaming && (chat.streaming.conversationId === conversationId || !conversationId) ? chat.streaming : null;

  const list = useRef<HTMLDivElement>(null);
  const shown = messages.data ?? [];
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [shown.length, streaming?.content]);

  const error = chat.error ?? (models.error && !models.choices.length ? models.error : null);
  const provider = getAiProvider(target.provider);

  return (
    <div className="ai-chat">
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
            value={target.model ? `${target.provider}\u0000${target.model}` : ""}
            onChange={(e) => {
              const [providerId, model] = e.target.value.split("\u0000");
              setPicked(model ? { provider: providerId, model } : null);
            }}
          >
            {!target.model ? <option value="">{models.isLoading ? t("app.loading") : t("ai.pickModel")}</option> : null}
            {models.choices.map((choice) => (
              <option key={`${choice.provider}:${choice.name}`} value={`${choice.provider}\u0000${choice.name}`}>
                {providers.length > 1 ? `${getAiProvider(choice.provider)?.name ?? choice.provider} · ${choice.label}` : choice.label}
              </option>
            ))}
          </Select>
          <Button type="button" variant="ghost" size="sm" aria-expanded={showApps} onClick={() => setShowApps((v) => !v)}>
            <Icon name="grid" /> {t("ai.apps")}
            {appTools.tools?.tools.length ? <span className="ai-chat__apps-count">{appTools.tools.tools.length}</span> : null}
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
            <Icon name="settings" /> {t("ai.settings")}
          </Button>
          {conversation ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={remove.isPending}
              onClick={() => {
                if (!window.confirm(t("ai.confirmDelete"))) return;
                remove.mutate(conversation.id, { onSuccess: () => go("/ai") });
              }}
            >
              {t("ai.delete")}
            </Button>
          ) : null}
        </header>

        {showSettings ? (
          <div className="ai-chat__settings">
            <AppSettingsPanel scope="user" appIds={["ai"]} title={null} />
          </div>
        ) : null}

        {showApps ? (
          <AppsPanel
            settings={settings}
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
                  {t("ai.unreachableHint", { address: provider?.describe?.(settings) || t("ai.serverDefault") })}
                </>
              ) : null}
            </span>
          </Alert>
        ) : null}

        <div className="ai-chat__messages" ref={list}>
          {!conversationId && !streaming ? <p className="ai-chat__intro muted">{t("ai.intro")}</p> : null}
          {conversationId && messages.isLoading ? <p className="muted">{t("app.loading")}</p> : null}
          {shown.map((message) => (
            <MessageBubble key={message.id} message={message} showMetrics={settings.showMetrics === true} />
          ))}
          {streaming ? (
            <div className="ai-message ai-message--assistant ai-message--streaming" aria-live="polite">
              <div className="ai-message__body">{streaming.content || <span className="ai-message__typing">{t("ai.thinking")}</span>}</div>
              {streaming.tool ? <div className="ai-message__meta ai-message__tool">{t("ai.usingTool", { tool: streaming.tool })}</div> : null}
            </div>
          ) : null}
        </div>

        <Composer
          busy={chat.busy}
          disabled={!target.model}
          sendWith={settings.sendWith === "modEnter" ? "modEnter" : "enter"}
          onSend={(text) => {
            chat.clearError();
            void chat.send(text, { conversation, provider: target.provider, model: target.model || null });
          }}
          onStop={chat.stop}
        />
      </section>
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

function MessageBubble({ message, showMetrics }: { message: AiMessage; showMetrics: boolean }) {
  const { t } = useI18n();
  const tools = message.metrics?.tools ?? [];
  return (
    <div className={`ai-message ai-message--${message.role}`}>
      <div className="ai-message__body">{message.content}</div>
      {tools.length ? (
        <div className="ai-message__meta ai-message__tool">
          {t("ai.usedTools", { tools: tools.map((tool) => `${tool.title ?? tool.name}${tool.ok ? "" : " ✕"}`).join(", ") })}
        </div>
      ) : null}
      {message.error ? <div className="ai-message__error">{message.error === "Stopped" ? t("ai.stopped") : message.error}</div> : null}
      {message.role === "assistant" && (showMetrics || message.model) ? (
        <div className="ai-message__meta">
          {[message.model, showMetrics && message.metrics ? formatMetrics(message.metrics) : ""].filter(Boolean).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

/** What the apps offer the AI: each app with its tools, from the app router's catalogue. */
function AppsPanel({ settings, toolSupport, error }: { settings: AiSettings; toolSupport: boolean; error: string | null }) {
  const { t } = useI18n();
  const enabled = appToolsEnabled(settings);
  const catalog = useQuery({ queryKey: ["gondol", "ai", "app-catalog"], enabled, retry: false, staleTime: 5 * 60_000, queryFn: ({ signal }) => fetchAppCatalog(signal) });
  const apps = (catalog.data?.apps ?? []).filter((app) => app.tools.length || app.ownMcpServer);
  const problem = error ?? (catalog.error instanceof Error ? catalog.error.message : null);
  return (
    <section className="ai-chat__apps" aria-label={t("ai.appsTitle")}>
      <div className="ai-chat__apps-head">
        <strong>{t("ai.appsTitle")}</strong>
        <p className="muted">{t("ai.appsIntro")}</p>
      </div>
      {!enabled ? <p className="muted">{t("ai.appsOff")}</p> : null}
      {enabled && !toolSupport ? <p className="muted">{t("ai.appsNoToolSupport")}</p> : null}
      {enabled && problem ? <p className="muted">{t("ai.appsUnavailable", { message: problem })}</p> : null}
      {enabled && catalog.isLoading ? <p className="muted">{t("app.loading")}</p> : null}
      {enabled && catalog.data && !apps.length ? <p className="muted">{t("ai.appsNone")}</p> : null}
      <ul className="ai-chat__app-list">
        {apps.map((app) => (
          <li key={app.id} className="ai-chat__app">
            <div className="ai-chat__app-name">{app.name}</div>
            {app.description ? <div className="muted ai-chat__app-description">{app.description}</div> : null}
            <ul className="ai-chat__tool-list">
              {app.tools.map((tool) => (
                <li key={tool.name} title={tool.description}>
                  <span>{tool.title ?? tool.name}</span>
                  <span className="muted"> · {t(tool.annotations?.readOnlyHint ? "ai.toolReadOnly" : "ai.toolChanges")}</span>
                </li>
              ))}
              {app.ownMcpServer ? <li className="muted">MCP · {app.mcp}</li> : null}
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
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  sendWith: "enter" | "modEnter";
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
        rows={3}
        aria-label={t("ai.message")}
        placeholder={t(sendWith === "enter" ? "ai.placeholder" : "ai.placeholderMod")}
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
