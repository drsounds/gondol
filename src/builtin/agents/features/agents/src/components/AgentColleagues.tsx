import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { entityKey } from "../../../../../../entities/slugs";
import { useI18n } from "../../../../../../i18n/i18n";
import { toEntityUri } from "../../../../../../entities/uri";
import { useAgentAvailability, useAgents } from "../../../../models/agents";
import { AgentAvatar } from "./AgentAvatar";

/**
 * The user's agents as colleagues in the chat sections of the menu (ChatSidebar), like their alter
 * egos: avatar with a dot while at work, name and job title. A click opens the main conversation
 * with the agent; its menu starts another conversation, or goes to its settings or sheet. Fired
 * agents are left out.
 */
export function AgentColleagues({ pathname, onNavigate }: { pathname: string; onNavigate: (path: string) => void }) {
  const { t } = useI18n();
  const agents = (useAgents().data ?? []).filter((a) => a.status !== "fired");
  const availability = useAgentAvailability(agents.map((a) => a.id)).data;
  if (!agents.length) {
    return <li className="chat-side__empty">{t("agents.noColleagues")}</li>;
  }
  return (
    <>
      {agents.map((agent) => {
        const path = `/agents/${entityKey(agent)}`;
        const active = pathname === path || pathname.startsWith(`${path}/`);
        return (
          <li key={agent.id} className="chat-side__row action-row">
            <button
              type="button"
              className="chat-side__item"
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(path)}
              title={agent.title ? `${agent.name} · ${agent.title}` : agent.name}
            >
              <AgentAvatar name={agent.name} mediaId={agent.avatar_media_id} size="sm" working={availability?.get(agent.id)?.working ?? null} />
              <span className="chat-side__label">{agent.name}</span>
              <span className="chat-side__meta">{agent.status === "suspended" ? t("agents.status.suspended") : (agent.title ?? `@${agent.username}`)}</span>
            </button>
            <ActionMenu
              name={agent.name}
              uri={toEntityUri("agent", agent.id)}
              actions={[
                { key: "open", label: t("agents.chat.open"), onSelect: () => onNavigate(path) },
                { key: "settings", label: t("agents.chat.settings"), onSelect: () => onNavigate(`${path}/settings`) },
                { key: "edit", label: t("actions.edit"), onSelect: () => onNavigate(`${path}/edit`) },
              ]}
            />
          </li>
        );
      })}
    </>
  );
}
