import { Icon } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import type { AppMenuWidgetProps } from "../../../../../../apps/types";
import { NavItem } from "../../../../../../shell/NavItem";
import { useAiConversations } from "../../../../models";

/** Conversations listed in the menu; the chat page lists every one. */
const RECENT = 5;

/**
 * Below the AI app's pages in the menu (sidebar, apps submenu, menu drawer): "New conversation"
 * and the most recent conversations. A collapsed sidebar keeps only "New conversation".
 */
export function AiMenuConversations({ pathname, onNavigate, extra, collapsed }: AppMenuWidgetProps) {
  const { t } = useI18n();
  const conversations = useAiConversations();
  const recent = collapsed ? [] : (conversations.data ?? []).slice(0, RECENT);
  return (
    <>
      <NavItem
        icon={<Icon name="plus" />}
        label={t("ai.newConversation")}
        extra={extra}
        active={pathname === "/ai/new"}
        onClick={() => onNavigate("/ai/new")}
      />
      {recent.map((c) => (
        <NavItem
          key={c.id}
          icon={<Icon name="chat" />}
          label={c.title || t("ai.untitled")}
          extra={extra}
          active={pathname === `/ai/${c.id}` || pathname.startsWith(`/ai/${c.id}/`)}
          onClick={() => onNavigate(`/ai/${c.id}`)}
        />
      ))}
    </>
  );
}
