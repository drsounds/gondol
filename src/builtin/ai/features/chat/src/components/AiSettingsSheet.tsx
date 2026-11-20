import { Alert, Button } from "../../../../../../design-system/bungalow-79d923";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { useI18n } from "../../../../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { AppSettingsPanel } from "../../../../../../settings/AppSettingsPanel";
import { useAiConversations, useAiToolPermissions, useRevokeAiToolPermission, type AiToolPermission } from "../../../../models";

/**
 * The AI settings as a dialog over the chat (`/ai/settings`, `/ai/<conversation>/settings`): the
 * app's settings for the user, the tools they let run without asking (to take back), and a way to
 * the services and MCP servers.
 */
export function AiSettingsSheet({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  return (
    <EntitySheet
      title={t("ai.settings")}
      subtitle={t("ai.settingsIntro")}
      onClose={onClose}
      closeLabel={t("ai.close")}
      footer={
        <div className="form-actions">
          <div className="form-actions__secondary">
            <Button type="button" variant="outline" onClick={() => go("/ai-models")}>
              {t("ai.servicesAndMcp")}
            </Button>
          </div>
          <Button type="button" tone="primary" onClick={onClose}>
            {t("ai.done")}
          </Button>
        </div>
      }
    >
      <div className="stack ai-settings">
        <AppSettingsPanel scope="user" appIds={["ai"]} title={null} />
        <ToolPermissions conversationId={conversationId} />
      </div>
    </EntitySheet>
  );
}

/** The tools the user allowed always, and in this conversation, each with a button to take it back. */
function ToolPermissions({ conversationId }: { conversationId: string | null }) {
  const { t } = useI18n();
  const permissions = useAiToolPermissions();
  const conversations = useAiConversations();
  const revoke = useRevokeAiToolPermission();
  const rows = permissions.data ?? [];
  const always = rows.filter((p) => p.conversation_id === null);
  const here = conversationId ? rows.filter((p) => p.conversation_id === conversationId) : [];
  const elsewhere = rows.filter((p) => p.conversation_id !== null && p.conversation_id !== conversationId);
  const titleOf = (id: string | null) => conversations.data?.find((c) => c.id === id)?.title || t("ai.untitled");

  const list = (items: AiToolPermission[], withConversation = false) => (
    <ul className="ai-permissions__list">
      {items.map((p) => (
        <li key={p.id} className="ai-permissions__row">
          <span className="ai-permissions__tool">
            <span>{p.title || p.tool}</span>
            <span className="muted">{withConversation ? titleOf(p.conversation_id) : p.tool}</span>
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => revoke.mutate(p.id)}>
            {t("ai.permissions.revoke")}
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="stack ai-permissions">
      <div>
        <h3 className="panel-title">{t("ai.permissions.title")}</h3>
        <p className="muted">{t("ai.permissions.intro")}</p>
      </div>
      {permissions.error ? <Alert tone="danger">{permissions.error.message}</Alert> : null}
      {revoke.error ? <Alert tone="danger">{revoke.error.message}</Alert> : null}
      {permissions.isLoading ? <p className="muted">{t("app.loading")}</p> : null}
      {permissions.data && !rows.length ? <p className="muted">{t("ai.permissions.none")}</p> : null}
      {always.length ? (
        <div>
          <h4 className="ai-permissions__heading">{t("ai.permissions.always")}</h4>
          {list(always)}
        </div>
      ) : null}
      {here.length ? (
        <div>
          <h4 className="ai-permissions__heading">{t("ai.permissions.here")}</h4>
          {list(here)}
        </div>
      ) : null}
      {elsewhere.length ? (
        <div>
          <h4 className="ai-permissions__heading">{t("ai.permissions.elsewhere")}</h4>
          {list(elsewhere, true)}
        </div>
      ) : null}
    </section>
  );
}
