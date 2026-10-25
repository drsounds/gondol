import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card } from "../../../../../../design-system/bungalow-79d923";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { entityIdentifier, entityKey, findByEntityKey } from "../../../../../../entities/slugs";
import { closeEditBackTo, useEntityModal, useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { useAgentChannels } from "../../../../models/host";
import { PageNotFound } from "../../../../../../shell/PageNotFound";
import { supabase } from "../../../../models/db";
import { useAgentEgos } from "../../../../models/host";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import { toEntityUri } from "../../../../../../entities/uri";
import {
  agentConversationPath,
  agentRunCanOpen,
  agentRunTone,
  agentRunsKey,
  agentSchedulesKey,
  agentStatusTone,
  partyPath,
  queueAgentRun,
  useAgentAvailability,
  useAgentConversations,
  useAgentRuns,
  useAgentSchedules,
  type Agent,
  type AgentConversation,
  type AgentRun,
  type AgentSchedule,
} from "../../../../models/agents";
import { AgentAvatar } from "./AgentAvatar";
import { AgentScheduleSheet } from "./AgentScheduleSheet";
import { useAgentActions } from "./useAgentActions";
import { useAvailabilityText } from "./useAvailabilityText";
import { workingHoursSummary } from "./WorkingHoursField";

/** The settings page's tabs, each at `/agents/$agent/settings/<tab>` (the profile at the page itself). */
const TABS = ["profile", "conversations", "schedules", "runs"] as const;
type Tab = (typeof TABS)[number];

/**
 * An agent's settings page (`/agents/$agent/settings`, behind the cog in its chat): who it is and
 * whether it's at work on top, then tabs: its profile, its conversations (and buttons to message it
 * as the account or an ego, or let it talk with another agent), its schedules
 * (`…/settings/schedules`, whose sheets open at `…/schedules/new` and `…/schedules/$schedule/edit`)
 * and the log of its runs (`…/settings/runs`), each of which opens as a conversation
 * (`/agents/$agent/runs/$run`).
 */
export function AgentView({
  agentKey,
  agent,
  agents,
  loading,
  sub,
  onQueued,
}: {
  agentKey: string;
  agent: Agent | undefined;
  agents: Agent[];
  loading: boolean;
  sub: string[];
  onQueued: () => void;
}) {
  const { t, intlLocale } = useI18n();
  const go = useNavigateKeepingSearch();
  const queryClient = useQueryClient();
  const chat = `/agents/${agentKey}`;
  const here = `${chat}/settings`;
  const actions = useAgentActions(() => go("/agents"));
  const availability = useAgentAvailability(agent ? [agent.id] : []).data?.get(agent?.id ?? "");
  const availabilityText = useAvailabilityText();
  const egos = useAgentEgos().data ?? [];
  const channels = useAgentChannels().data ?? [];
  const schedules = useAgentSchedules(agent?.id ?? null);
  const conversations = useAgentConversations(agent?.id ?? null);
  const runs = useAgentRuns(agent?.id ?? null);
  const tab: Tab = (TABS as readonly string[]).includes(sub[0] ?? "") ? (sub[0] as Tab) : "profile";
  const scheduleModal = useEntityModal(`${here}/schedules`, `${here}/schedules`);
  const editingSchedule = scheduleModal.mode === "edit" ? findByEntityKey(schedules.data ?? [], scheduleModal.id) : undefined;

  const runSchedule = useMutation({
    mutationFn: async (schedule: AgentSchedule) => {
      await queueAgentRun({
        agentId: schedule.agent_id,
        trigger: "manual",
        instructions: schedule.instructions,
        channelId: schedule.channel_id,
        scheduleId: schedule.id,
        ignoreHours: true,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentRunsKey(agent?.id ?? null) });
      onQueued();
    },
  });
  const toggleSchedule = useMutation({
    mutationFn: async (schedule: AgentSchedule) => {
      const { error } = await supabase.from("agent_schedules").update({ enabled: !schedule.enabled }).eq("id", schedule.id);
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: agentSchedulesKey(agent?.id ?? null) }),
  });
  const removeSchedule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agent_schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: agentSchedulesKey(agent?.id ?? null) }),
  });
  const runQueuedNow = useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.from("agent_runs").update({ run_after: new Date().toISOString() }).eq("id", runId).eq("status", "queued");
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentRunsKey(agent?.id ?? null) });
      onQueued();
    },
  });

  if (!agent) {
    return loading ? (
      <Card>
        <p className="stat-label">{t("app.loading")}</p>
      </Card>
    ) : (
      <PageNotFound />
    );
  }

  const edit = () => {
    closeEditBackTo(`/agents/${entityKey(agent)}/edit`, here);
    go(`/agents/${entityKey(agent)}/edit`);
  };
  const when = (iso: string) => new Date(iso).toLocaleString(intlLocale, { dateStyle: "medium", timeStyle: "short" });
  const others = agents.filter((a) => a.id !== agent.id);
  const tabPath = (to: Tab) => (to === "profile" ? here : `${here}/${to}`);
  const scheduleTitle = (id: string | null) => (id ? (schedules.data ?? []).find((s) => s.id === id)?.title : undefined);
  const openRun = (run: AgentRun) => go(`${chat}/runs/${entityIdentifier(run.id)}`);
  const channelName = (id: string | null) => (id ? `#${channels.find((c) => c.id === id)?.name ?? "…"}` : t("agents.schedule.toDirect"));
  const partyOf = (c: AgentConversation) => {
    const path = agentConversationPath(agent, agents, egos, c)?.slice(chat.length) ?? null;
    if (!c.is_main) return { label: c.title || t("agents.chat.untitled"), path, avatar: null };
    if (c.with_kind === "account") return { label: t("agents.chat.main"), path, avatar: null };
    if (c.with_kind === "ego") {
      const ego = egos.find((e) => e.id === c.with_ego_id);
      return { label: ego ? `${ego.name} (@${ego.username})` : t("agents.deletedEgo"), path, avatar: null };
    }
    const otherId = c.agent_id === agent.id ? c.with_agent_id : c.agent_id;
    const other = agents.find((a) => a.id === otherId);
    return { label: other ? other.name : t("agents.deletedAgent"), path, avatar: other ?? null };
  };

  return (
    <>
      <Card>
        <div className="stack">
          <button type="button" className="entity-section__back" onClick={() => go(chat)}>
            ← {t("agents.chat.backToChat", { name: agent.name })}
          </button>
          <div className="agent-profile action-row">
            <AgentAvatar name={agent.name} mediaId={agent.avatar_media_id} size="xl" working={availability?.working} />
            <div className="agent-profile__text">
              <div className="entity-preview__kind">{agent.title || t("entity.agent")}</div>
              <h2 className="panel-title">{agent.name}</h2>
              <div className="muted">
                @{agent.username}
                {agent.gender ? ` · ${t(`agents.gender.${agent.gender}` as MessageKey)}` : ""}
              </div>
              <div className="row-actions agent-profile__badges">
                <Badge tone={agentStatusTone(agent.status)}>{t(`agents.status.${agent.status}` as MessageKey)}</Badge>
                <span className="muted">{availabilityText(agent, availability)}</span>
              </div>
            </div>
            <div className="row-actions agent-profile__actions">
              <Button size="sm" variant="outline" onClick={edit}>
                {t("actions.edit")}
              </Button>
              <Button size="sm" tone="primary" onClick={() => go(chat)} disabled={agent.status === "fired"}>
                {t("agents.message")}
              </Button>
              <ActionMenu
                name={agent.name}
                uri={toEntityUri("agent", agent.id)}
                actions={[
                  { key: "edit", label: t("actions.edit"), onSelect: edit },
                  ...actions.statusActions(agent),
                  { key: "delete", label: t("actions.delete"), tone: "danger" as const, onSelect: () => actions.confirmDelete(agent) },
                ]}
              />
            </div>
          </div>
          {actions.setStatus.error ? <p className="bungalow-help bungalow-help--error">{actions.setStatus.error.message}</p> : null}
          <div className="search-chips" role="tablist" aria-label={t("agents.tabs")}>
            {TABS.map((key) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className="search-chip" onClick={() => go(tabPath(key))}>
                {t(`agents.tabs.${key}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {tab === "profile" ? (
        <Card>
          <div className="stack">
            {agent.bio ? <p>{agent.bio}</p> : null}
            <dl className="agent-facts">
              <div>
                <dt>{t("agents.model")}</dt>
                <dd>{[agent.provider, agent.model].filter(Boolean).join(" · ")}</dd>
              </div>
              <div>
                <dt>{t("agents.toolAccess")}</dt>
                <dd>{t(`agents.toolAccess.${agent.tool_access}` as MessageKey)}</dd>
              </div>
              <div>
                <dt>{t("agents.workingHours")}</dt>
                <dd>
                  {workingHoursSummary(agent.working_hours, t)} ({agent.time_zone})
                </dd>
              </div>
              <div>
                <dt>{agent.status === "fired" ? t("agents.firedAt") : t("agents.hiredAt")}</dt>
                <dd>{when(agent.status === "fired" && agent.fired_at ? agent.fired_at : agent.hired_at)}</dd>
              </div>
            </dl>
          </div>
        </Card>
      ) : null}

      {tab === "conversations" ? (
        <Card>
          <section className="quest-section">
            <div className="quest-section__head">
              <h3 className="quest-section__title">{t("agents.conversations")}</h3>
            </div>
            <p className="muted">{t("agents.conversationsIntro")}</p>
            <div className="row-actions agent-talk">
              <Button size="sm" variant="outline" onClick={() => go(chat)}>
                {t("agents.messageAsYou")}
              </Button>
              {egos.map((ego) => (
                <Button key={ego.id} size="sm" variant="outline" onClick={() => go(`${chat}/messages/${partyPath("ego", ego.username)}`)}>
                  {t("agents.messageAs", { name: ego.name })}
                </Button>
              ))}
              {others.map((other) => (
                <Button key={other.id} size="sm" variant="ghost" onClick={() => go(`${chat}/messages/${partyPath("agent", entityKey(other))}`)}>
                  {t("agents.talkWith", { name: other.name })}
                </Button>
              ))}
            </div>
            {(conversations.data ?? []).length ? (
              <ul className="library-list agent-threads">
                {(conversations.data ?? []).map((c) => {
                  const party = partyOf(c);
                  return (
                    <li key={c.id}>
                      <button type="button" className="agent-thread" disabled={party.path === null} onClick={() => party.path !== null && go(`${chat}${party.path}`)}>
                        {party.avatar ? (
                          <AgentAvatar name={party.avatar.name} mediaId={party.avatar.avatar_media_id} size="sm" />
                        ) : (
                          <AgentAvatar name={agent.name} mediaId={agent.avatar_media_id} size="sm" />
                        )}
                        <span className="agent-thread__text">
                          <span>{party.label}</span>
                          <span className="muted">{c.last_message_at ? when(c.last_message_at) : t("agents.noMessages")}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        </Card>
      ) : null}

      {tab === "schedules" ? (
        <Card>
          <section className="quest-section">
            <div className="panel-head">
              <div>
                <h3 className="quest-section__title">{t("agents.schedules")}</h3>
                <p className="muted">{t("agents.schedulesIntro")}</p>
              </div>
              <Button size="sm" tone="primary" onClick={scheduleModal.openNew}>
                {t("agents.schedule.add")}
              </Button>
            </div>
            {(schedules.data ?? []).length === 0 ? (
              schedules.isLoading ? (
                <p className="stat-label">{t("app.loading")}</p>
              ) : (
                <EmptyState items={t("agents.schedule.items")} actionLabel={t("agents.schedule.add")} onAction={scheduleModal.openNew} />
              )
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("agents.schedule.title")}</th>
                      <th>{t("agents.schedule.cron")}</th>
                      <th>{t("agents.schedule.postTo")}</th>
                      <th>{t("agents.schedule.lastRun")}</th>
                      <th className="action-row-cell" aria-label={t("agents.actions")} />
                    </tr>
                  </thead>
                  <tbody>
                    {(schedules.data ?? []).map((schedule) => (
                      <tr key={schedule.id} className="action-row clickable-row" onClick={() => scheduleModal.openEdit(entityKey(schedule))}>
                        <td className="wrap">
                          {schedule.title}
                          {!schedule.enabled ? <span className="muted"> · {t("agents.schedule.paused")}</span> : null}
                        </td>
                        <td>
                          <code>{schedule.cron}</code>
                        </td>
                        <td className="wrap">{channelName(schedule.channel_id)}</td>
                        <td>{schedule.last_run_at ? when(schedule.last_run_at) : "—"}</td>
                        <td className="action-row-cell" onClick={(e) => e.stopPropagation()}>
                          <ActionMenu
                            name={schedule.title}
                            actions={[
                              { key: "run", label: t("agents.schedule.runNow"), onSelect: () => runSchedule.mutate(schedule), disabled: agent.status !== "active" },
                              { key: "edit", label: t("actions.edit"), onSelect: () => scheduleModal.openEdit(entityKey(schedule)) },
                              {
                                key: "toggle",
                                label: schedule.enabled ? t("agents.schedule.pause") : t("agents.schedule.resume"),
                                onSelect: () => toggleSchedule.mutate(schedule),
                              },
                              {
                                key: "delete",
                                label: t("actions.delete"),
                                tone: "danger" as const,
                                onSelect: () => window.confirm(t("agents.schedule.confirmDelete", { name: schedule.title })) && removeSchedule.mutate(schedule.id),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {runSchedule.error ? <p className="bungalow-help bungalow-help--error">{runSchedule.error.message}</p> : null}
          </section>
        </Card>
      ) : null}

      {tab === "runs" ? (
        <Card>
          <section className="quest-section">
            <div>
              <h3 className="quest-section__title">{t("agents.runs")}</h3>
              <p className="muted">{t("agents.runsIntro")}</p>
            </div>
            {(runs.data ?? []).length === 0 ? (
              <p className="muted">{runs.isLoading ? t("app.loading") : t("agents.noRuns")}</p>
            ) : (
              <ul className="agent-runs">
                {(runs.data ?? []).map((run) => {
                  const canOpen = agentRunCanOpen(run);
                  const label = scheduleTitle(run.schedule_id) ?? t(`agents.run.trigger.${run.trigger}` as MessageKey);
                  return (
                    <li key={run.id} className={`agent-run action-row${canOpen ? " clickable-row" : ""}`} onClick={() => canOpen && openRun(run)}>
                      <div className="agent-run__head">
                        <Badge tone={agentRunTone(run.status)}>{t(`agents.run.status.${run.status}` as MessageKey)}</Badge>
                        <span>{label}</span>
                        <span className="muted">
                          {run.status === "queued" ? t("agents.run.after", { when: when(run.run_after) }) : when(run.started_at ?? run.queued_at)}
                          {run.runner ? ` · ${t(`agents.run.runner.${run.runner}` as MessageKey)}` : ""}
                        </span>
                        <span className="agent-run__menu" onClick={(e) => e.stopPropagation()}>
                          <ActionMenu
                            name={label}
                            actions={[
                              ...(canOpen ? [{ key: "open", label: t("agents.run.open"), onSelect: () => openRun(run) }] : []),
                              ...(run.status === "queued" ? [{ key: "run", label: t("agents.schedule.runNow"), onSelect: () => runQueuedNow.mutate(run.id) }] : []),
                            ]}
                          />
                        </span>
                      </div>
                      {run.error ? <p className="bungalow-help bungalow-help--error">{run.error}</p> : null}
                      {run.output ? <p className="agent-run__output">{run.output}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </Card>
      ) : null}

      {scheduleModal.mode === "new" || editingSchedule ? (
        <AgentScheduleSheet key={editingSchedule?.id ?? "new"} agent={agent} schedule={editingSchedule} onClose={scheduleModal.close} />
      ) : null}
    </>
  );
}
