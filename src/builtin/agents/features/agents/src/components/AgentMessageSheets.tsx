import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox } from "../../../../../../design-system/bungalow-79d923";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { useI18n } from "../../../../../../i18n/i18n";
import { agentMessagesKey, queueAgentRun, updateAgentMessage, useAgentMessages, type AgentConversation, type AgentMessage } from "../../../../models/agents";

/**
 * Editing one of your own messages to an agent (`…/message/<message>/edit`). When the agent
 * answered it, the answer can be written again from the edited message right after saving.
 */
export function AgentMessageSheet({
  conversation,
  messageId,
  canAsk,
  onQueued,
  onClose,
}: {
  conversation: AgentConversation;
  messageId: string;
  canAsk: boolean;
  onQueued: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const messages = useAgentMessages(conversation.id);
  const all = messages.data ?? [];
  const message = all.find((m) => m.id === messageId) ?? null;
  const siblings = message ? all.filter((m) => (m.parent_id ?? null) === (message.parent_id ?? null)) : [];
  const next = siblings[siblings.findIndex((m) => m.id === messageId) + 1];
  const answer = next && next.author_kind === "agent" && !next.soft_deleted_at ? next : null;
  const [text, setText] = useState<string | null>(null);
  const [rewrite, setRewrite] = useState(true);
  const value = text ?? message?.content ?? "";
  const editable = !!message && message.author_kind !== "agent" && !message.soft_deleted_at;

  const save = useMutation({
    mutationFn: async () => {
      await updateAgentMessage(messageId, { content: value.trim() });
      if (answer && rewrite && canAsk) {
        await queueAgentRun({
          agentId: conversation.agent_id,
          trigger: "message",
          conversationId: conversation.id,
          messageParentId: answer.parent_id,
          replaceMessageId: answer.id,
        });
        onQueued();
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentMessagesKey(conversation.id) });
      onClose();
    },
  });

  return (
    <EntitySheet
      title={t("agents.chat.editTitle")}
      subtitle={message ? new Date(message.created_at).toLocaleString() : undefined}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (editable && value.trim()) save.mutate();
      }}
      preview={
        <div className="entity-preview agent-chat__preview">
          <div className="entity-preview__kind">{t("agents.chat.yourMessage")}</div>
          <div className="agent-bubble agent-bubble--other">
            <div className="agent-bubble__body">
              <div className="agent-bubble__text">{value || "…"}</div>
            </div>
          </div>
          {answer ? (
            <div className="agent-bubble agent-bubble--agent">
              <div className="agent-bubble__body">
                <div className="agent-bubble__text">{answer.content}</div>
              </div>
            </div>
          ) : null}
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={t("form.save")}
          saving={save.isPending}
          submitDisabled={!editable || !value.trim() || value.trim() === message?.content}
        />
      }
    >
      {messages.isLoading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : !editable ? (
        <p className="muted">{t("agents.chat.cantEdit")}</p>
      ) : (
        <div className="stack">
          <label className="bungalow-field">
            <span className="bungalow-label">{t("agents.message")}</span>
            <textarea className="bungalow-input form-textarea" rows={8} value={value} autoFocus onChange={(e) => setText(e.target.value)} />
          </label>
          {answer ? (
            <Checkbox label={t("agents.chat.rewriteAfterEdit")} checked={rewrite && canAsk} disabled={!canAsk} onChange={(e) => setRewrite(e.target.checked)} />
          ) : null}
          {save.error ? <p className="bungalow-help bungalow-help--error">{save.error.message}</p> : null}
        </div>
      )}
    </EntitySheet>
  );
}

/** A conversation's deleted messages (`…/deleted`), latest deletion first, each restorable. */
export function AgentDeletedMessagesSheet({
  conversation,
  nameOf,
  onOpenThread,
  onClose,
}: {
  conversation: AgentConversation;
  nameOf: (m: AgentMessage) => string;
  onOpenThread: (id: string) => void;
  onClose: () => void;
}) {
  const { t, intlLocale } = useI18n();
  const queryClient = useQueryClient();
  const messages = useAgentMessages(conversation.id);
  const deleted = (messages.data ?? []).filter((m) => m.soft_deleted_at).sort((a, b) => b.soft_deleted_at!.localeCompare(a.soft_deleted_at!));
  const restore = useMutation({
    mutationFn: (id: string) => updateAgentMessage(id, { deleted: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: agentMessagesKey(conversation.id) }),
  });
  return (
    <EntitySheet
      title={t("agents.chat.deletedMessages")}
      subtitle={t("agents.chat.deletedIntro")}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      footer={
        <div className="form-actions">
          <Button type="button" tone="primary" onClick={onClose}>
            {t("agents.chat.done")}
          </Button>
        </div>
      }
    >
      {messages.isLoading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : deleted.length === 0 ? (
        <p className="muted">{t("agents.chat.noDeleted")}</p>
      ) : (
        <ul className="ai-deleted">
          {deleted.map((m) => (
            <li key={m.id} className="ai-deleted__item">
              <div className="ai-deleted__text">
                <span className="muted">
                  {nameOf(m)} · {t("agents.chat.deletedAt", { when: new Date(m.soft_deleted_at!).toLocaleString(intlLocale, { dateStyle: "short", timeStyle: "short" }) })}
                </span>
                <span className="ai-deleted__content">{m.content || m.error || "…"}</span>
              </div>
              <div className="row-actions">
                {m.parent_id ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => onOpenThread(m.parent_id!)}>
                    {t("agents.chat.showThread")}
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" loading={restore.isPending && restore.variables === m.id} onClick={() => restore.mutate(m.id)}>
                  {t("agents.chat.restore")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {restore.error ? <p className="bungalow-help bungalow-help--error">{restore.error.message}</p> : null}
    </EntitySheet>
  );
}
