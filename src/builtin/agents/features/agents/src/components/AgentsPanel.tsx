import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Badge, Button, Card } from "../../../../../../design-system/bungalow-79d923";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { entityKey } from "../../../../../../entities/slugs";
import { useEntityModal, useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { PageNotFound } from "../../../../../../shell/PageNotFound";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import { toEntityUri } from "../../../../../../entities/uri";
import { agentStatusTone, findAgent, useAgentAvailability, useAgents, type Agent } from "../../../../models/agents";
import { useAgentRunner } from "../../../../models/runAgent";
import { AgentAvatar } from "./AgentAvatar";
import { AgentChatPage } from "./AgentChatPage";
import { AgentSheet } from "./AgentSheet";
import { AgentView } from "./AgentView";
import { useAgentActions } from "./useAgentActions";
import { useAvailabilityText } from "./useAvailabilityText";

/**
 * Agents (`/agents`): the user's AI agents listed like their alter egos. Opening one goes straight
 * to your main conversation with it (`/agents/$agent`, AgentChatPage), beside its other
 * conversations (`…/conversations/$id`, `…/messages/ego/$ego`, `…/messages/agent/$agent`); its
 * settings page (`/agents/$agent/settings`: profile, schedules, threads, work log) is behind the
 * cog. Agents are created and edited in routed sheets (`/agents/new`, `/agents/$agent/edit`), and
 * so are their schedules (`/agents/$agent/settings/schedules/new`, `…/schedules/$schedule/edit`).
 * While it's open, the app does the agents' due work in the browser (useAgentRunner).
 */
export function AgentsPanel() {
  const { t } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const parts = pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
  const go = useNavigateKeepingSearch();
  const modal = useEntityModal("/agents");
  const { data: agents = [], isLoading } = useAgents();
  const runner = useAgentRunner();
  const editing = modal.mode === "edit" ? findAgent(agents, modal.id) : undefined;
  const agentKey = parts[0] && parts[0] !== "new" ? parts[0] : null;
  const agent = agentKey ? findAgent(agents, agentKey) : undefined;
  // The settings page's schedules used to sit right under the agent.
  const oldSchedulePath = agentKey && parts[1] === "schedules";
  useEffect(() => {
    if (oldSchedulePath) go(`/agents/${[agentKey, "settings", ...parts.slice(1)].map(encodeURIComponent).join("/")}`);
  }, [oldSchedulePath, agentKey, parts, go]);

  let body;
  if (agentKey && (parts[1] === "settings" || oldSchedulePath)) {
    body = <AgentView agentKey={agentKey} agent={agent} agents={agents} loading={isLoading} sub={parts.slice(2)} onQueued={runner.kick} />;
  } else if (agentKey) {
    body = agent ? (
      <AgentChatPage key={agent.id} agent={agent} agents={agents} parts={parts.slice(1)} onQueued={runner.kick} />
    ) : isLoading ? (
      <Card>
        <p className="stat-label">{t("app.loading")}</p>
      </Card>
    ) : (
      <PageNotFound />
    );
  } else {
    body = <AgentList agents={agents} loading={isLoading} onNew={modal.openNew} onEdit={(a) => modal.openEdit(entityKey(a))} />;
  }

  return (
    <>
      {body}
      {modal.mode === "new" || editing ? (
        <AgentSheet
          key={editing?.id ?? "new"}
          agent={editing}
          onClose={modal.close}
          onSaved={(saved) => go(`/agents/${entityKey(saved)}`)}
          onDeleted={() => go("/agents")}
        />
      ) : null}
    </>
  );
}

function AgentList({ agents, loading, onNew, onEdit }: { agents: Agent[]; loading: boolean; onNew: () => void; onEdit: (agent: Agent) => void }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const actions = useAgentActions();
  const availability = useAgentAvailability(agents.map((a) => a.id)).data;
  const availabilityText = useAvailabilityText();
  return (
    <Card>
      <div className="stack">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{t("agents.title")}</h2>
            <p className="muted">{t("agents.intro")}</p>
          </div>
          <Button size="sm" tone="primary" onClick={onNew} data-tour="create-agent">
            {t("agents.add")}
          </Button>
        </div>
        {agents.length === 0 ? (
          loading ? (
            <p className="stat-label">{t("app.loading")}</p>
          ) : (
            <EmptyState items={t("agents.items")} actionLabel={t("agents.add")} onAction={onNew} />
          )
        ) : (
          <div className="data-table-wrap">
            <table className="data-table agents-table">
              <thead>
                <tr>
                  <th>{t("agents.name")}</th>
                  <th>{t("agents.username")}</th>
                  <th>{t("agents.statusField")}</th>
                  <th>{t("agents.availability")}</th>
                  <th>{t("agents.model")}</th>
                  <th className="action-row-cell" aria-label={t("agents.actions")} />
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const now = availability?.get(agent.id);
                  return (
                    <tr key={agent.id} className="action-row clickable-row" onClick={() => go(`/agents/${entityKey(agent)}`)}>
                      <td className="wrap">
                        <span className="agent-name-cell">
                          <AgentAvatar name={agent.name} mediaId={agent.avatar_media_id} size="sm" working={now?.working} />
                          <span>
                            {agent.name}
                            {agent.title ? <span className="muted"> · {agent.title}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td className="wrap">@{agent.username}</td>
                      <td>
                        <Badge tone={agentStatusTone(agent.status)}>{t(`agents.status.${agent.status}` as MessageKey)}</Badge>
                      </td>
                      <td className="wrap">{availabilityText(agent, now)}</td>
                      <td className="wrap">{agent.model ?? "—"}</td>
                      <td className="action-row-cell" onClick={(e) => e.stopPropagation()}>
                        <ActionMenu
                          name={agent.name}
                          uri={toEntityUri("agent", agent.id)}
                          actions={[
                            { key: "open", label: t("actions.open"), onSelect: () => go(`/agents/${entityKey(agent)}`) },
                            { key: "edit", label: t("actions.edit"), onSelect: () => onEdit(agent) },
                            ...actions.statusActions(agent),
                            { key: "delete", label: t("actions.delete"), tone: "danger" as const, onSelect: () => actions.confirmDelete(agent) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {actions.setStatus.error ? <p className="bungalow-help bungalow-help--error">{actions.setStatus.error.message}</p> : null}
      </div>
    </Card>
  );
}
