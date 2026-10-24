import { useState } from "react";
import { Button, Checkbox } from "../../../../../../design-system/bungalow-79d923";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { useI18n } from "../../../../../../i18n/i18n";
import { useUpdateAiMessage, type AiMessage } from "../../../../models";
import { Markdown } from "./Markdown";

/**
 * Editing one of the user's messages (`/ai/<id>/messages/<message>/edit`). When the model answered
 * it, the answer can be written again from the edited question right after saving.
 */
export function AiMessageSheet({
  message,
  loading,
  answer,
  canRegenerate,
  onRegenerate,
  onClose,
}: {
  message: AiMessage | null;
  loading: boolean;
  /** The answer that follows it in its thread, if any. */
  answer: AiMessage | null;
  canRegenerate: boolean;
  onRegenerate: (answer: AiMessage) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const update = useUpdateAiMessage();
  const [text, setText] = useState<string | null>(null);
  const [regenerate, setRegenerate] = useState(true);
  const value = text ?? message?.content ?? "";
  const editable = !!message && message.role === "user" && !message.soft_deleted_at;

  return (
    <EntitySheet
      title={t("ai.message.editTitle")}
      subtitle={message ? new Date(message.created_at).toLocaleString() : undefined}
      onClose={onClose}
      closeLabel={t("ai.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!message || !editable || !value.trim()) return;
        update.mutate(
          { id: message.id, content: value.trim() },
          {
            onSuccess: () => {
              if (answer && regenerate && canRegenerate) onRegenerate(answer);
              onClose();
            },
          },
        );
      }}
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{t("ai.message.yours")}</div>
          <div className="ai-message ai-message--user ai-message--preview">
            <div className="ai-message__body">{value || "…"}</div>
          </div>
          {answer ? (
            <div className="ai-message ai-message--assistant ai-message--preview">
              <div className="ai-message__body">
                <Markdown source={answer.content} />
              </div>
            </div>
          ) : null}
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("ai.cancel")}
          submitLabel={t("ai.save")}
          saving={update.isPending}
          submitDisabled={!editable || !value.trim() || value.trim() === message?.content}
        />
      }
    >
      {loading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : !editable ? (
        <p className="muted">{t("ai.message.cantEdit")}</p>
      ) : (
        <div className="stack">
          <label className="bungalow-field">
            <span className="bungalow-label">{t("ai.message.text")}</span>
            <textarea className="bungalow-input ai-chat__input" rows={8} value={value} autoFocus onChange={(e) => setText(e.target.value)} />
          </label>
          {answer ? (
            <Checkbox
              label={t("ai.message.regenerateAfterEdit")}
              checked={regenerate && canRegenerate}
              disabled={!canRegenerate}
              onChange={(e) => setRegenerate(e.target.checked)}
            />
          ) : null}
          {update.error ? <p className="bungalow-help bungalow-help--error">{update.error.message}</p> : null}
        </div>
      )}
    </EntitySheet>
  );
}

/**
 * The conversation's deleted messages (`/ai/<id>/deleted`), newest deletion first, each with its
 * text, a button to restore it and one to open its thread.
 */
export function AiDeletedMessagesSheet({ messages, onClose, onOpenThread }: { messages: AiMessage[]; onClose: () => void; onOpenThread: (id: string) => void }) {
  const { t } = useI18n();
  const update = useUpdateAiMessage();
  const deleted = messages.filter((m) => m.soft_deleted_at).sort((a, b) => b.soft_deleted_at!.localeCompare(a.soft_deleted_at!));
  return (
    <EntitySheet
      title={t("ai.deletedMessages")}
      subtitle={t("ai.deletedMessagesIntro")}
      onClose={onClose}
      closeLabel={t("ai.close")}
      footer={
        <div className="form-actions">
          <Button type="button" tone="primary" onClick={onClose}>
            {t("ai.done")}
          </Button>
        </div>
      }
    >
      {deleted.length === 0 ? (
        <p className="muted">{t("ai.noDeletedMessages")}</p>
      ) : (
        <ul className="ai-deleted">
          {deleted.map((m) => (
            <li key={m.id} className="ai-deleted__item">
              <div className="ai-deleted__text">
                <span className="muted">
                  {t(m.role === "user" ? "ai.message.yours" : "ai.message.answer")} · {t("ai.message.deletedAt", { when: new Date(m.soft_deleted_at!).toLocaleString() })}
                </span>
                <span className="ai-deleted__content">{m.content || m.error || "…"}</span>
              </div>
              <div className="row-actions">
                {m.parent_id ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => onOpenThread(m.parent_id!)}>
                    {t("ai.message.showThread")}
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" loading={update.isPending && update.variables?.id === m.id} onClick={() => update.mutate({ id: m.id, deleted: false })}>
                  {t("ai.message.restore")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {update.error ? <p className="bungalow-help bungalow-help--error">{update.error.message}</p> : null}
    </EntitySheet>
  );
}
