import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Checkbox, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { sessionUserId } from "../../../../../../supabase/session";
import { useAiModelChoices, useAiSettings } from "../../../../../ai/models/models";
import { aiSourceKey, useAiSources } from "../../../../../ai/models/services";
import { mediaHost } from "../../../../../../media/host";
import { supabase } from "../../../../models/db";
import { isValidUsername, normalizeUsername } from "../../../../models/host";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import { toEntityUri } from "../../../../../../entities/uri";
import type { Json } from "../../../../../../supabase/types";
import {
  AGENT_GENDERS,
  AGENT_TOOL_ACCESS,
  OFFICE_HOURS,
  agentIsWorking,
  agentStatusTone,
  agentsQueryKey,
  timeZones,
  validWorkingHours,
  type Agent,
  type AgentGender,
  type AgentToolAccess,
  type WorkingWindow,
} from "../../../../models/agents";
import { AgentAvatar } from "./AgentAvatar";
import { WorkingHoursField, workingHoursSummary } from "./WorkingHoursField";
import { useAgentActions } from "./useAgentActions";

interface Draft {
  name: string;
  username: string;
  title: string;
  gender: AgentGender | "";
  avatar_media_id: string | null;
  bio: string;
  instructions: string;
  /** The AI source: a service id, or a provider id for the provider's settings. */
  source: string;
  model: string;
  temperature: string;
  tool_access: AgentToolAccess;
  time_zone: string;
  working_hours: WorkingWindow[];
}

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Stockholm";
  } catch {
    return "Europe/Stockholm";
  }
};

const emptyDraft = (): Draft => ({
  name: "",
  username: "",
  title: "",
  gender: "",
  avatar_media_id: null,
  bio: "",
  instructions: "",
  source: "",
  model: "",
  temperature: "",
  tool_access: "read",
  time_zone: browserTimeZone(),
  working_hours: OFFICE_HOURS,
});

const draftFromAgent = (agent: Agent): Draft => ({
  name: agent.name,
  username: agent.username,
  title: agent.title ?? "",
  gender: agent.gender ?? "",
  avatar_media_id: agent.avatar_media_id,
  bio: agent.bio ?? "",
  instructions: agent.instructions ?? "",
  source: aiSourceKey(agent.provider, agent.service_id),
  model: agent.model ?? "",
  temperature: agent.temperature === null ? "" : String(agent.temperature),
  tool_access: agent.tool_access,
  time_zone: agent.time_zone,
  working_hours: agent.working_hours,
});

/** Postgres unique_violation: the @username is taken (by an agent or an ego). */
const isUsernameTaken = (error: unknown) => (error as { code?: string } | null)?.code === "23505";

/**
 * The create/edit sheet of an agent: who it is (name, @username, job title, gender, avatar, bio),
 * what it does (its instructions), what it runs on (an AI service or provider and a model, the
 * temperature, how far it may use the apps' tools) and when it works (time zone and working hours).
 */
export function AgentSheet({ agent, onClose, onSaved, onDeleted }: { agent?: Agent; onClose: () => void; onSaved: (agent: Agent) => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const { MediaPicker } = mediaHost();
  const queryClient = useQueryClient();
  const { settings } = useAiSettings();
  const { sources } = useAiSources(settings);
  const [draft, setDraft] = useState<Draft>(() => (agent ? draftFromAgent(agent) : emptyDraft()));
  const actions = useAgentActions(onDeleted);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // A new agent starts on the first source the user has.
  useEffect(() => {
    if (!draft.source && sources[0]) update({ source: sources[0].key });
  }, [draft.source, sources]);

  const source = sources.find((s) => s.key === draft.source);
  const provider = source?.provider.id ?? agent?.provider ?? "openai";
  const serviceId = source?.service?.id ?? (source ? null : (agent?.service_id ?? null));
  const models = useAiModelChoices(settings, agent ? { provider: agent.provider, serviceId: agent.service_id, model: agent.model } : null);
  const modelChoices = useMemo(() => models.choices.filter((c) => aiSourceKey(c.provider, c.serviceId) === draft.source), [models.choices, draft.source]);
  const zones = useMemo(() => timeZones(), []);
  const username = normalizeUsername(draft.username);
  const usernameValid = isValidUsername(username);
  const temperature = draft.temperature.trim() === "" ? null : Number(draft.temperature);
  const temperatureValid = temperature === null || (Number.isFinite(temperature) && temperature >= 0 && temperature <= 2);
  const hoursValid = validWorkingHours(draft.working_hours);

  const save = useMutation({
    mutationFn: async (d: Draft): Promise<Agent> => {
      const payload = {
        name: d.name.trim(),
        username,
        title: d.title.trim() || null,
        gender: d.gender || null,
        avatar_media_id: d.avatar_media_id,
        bio: d.bio.trim() || null,
        instructions: d.instructions.trim() || null,
        provider,
        service_id: serviceId,
        model: d.model.trim() || null,
        temperature,
        tool_access: d.tool_access,
        time_zone: d.time_zone.trim() || "UTC",
        working_hours: d.working_hours as unknown as Json,
      };
      const query = agent
        ? supabase.from("agents").update(payload).eq("id", agent.id)
        : supabase.from("agents").insert({ ...payload, user_id: await sessionUserId() });
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return data as unknown as Agent;
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: agentsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["agent-availability"] });
      onSaved(saved);
    },
  });

  const saveError = save.error ? (isUsernameTaken(save.error) ? t("agents.usernameTaken") : save.error.message) : null;
  const statusLabel = agent ? t(`agents.status.${agent.status}` as MessageKey) : null;
  const working = agentIsWorking({ status: agent?.status ?? "active", working_hours: draft.working_hours, time_zone: draft.time_zone });

  return (
    <EntitySheet
      title={agent ? agent.name : t("agents.add")}
      subtitle={agent ? `@${agent.username}` : undefined}
      uri={agent ? toEntityUri("agent", agent.id) : undefined}
      actions={agent ? actions.statusActions(agent) : undefined}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(draft);
      }}
      footer={
        <FormActions
          onDelete={agent ? () => actions.confirmDelete(agent) : undefined}
          deleteLabel={t("agents.delete")}
          deleting={actions.remove.isPending}
          onCancel={agent ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={agent ? t("form.save") : t("agents.create")}
          saving={save.isPending}
          submitDisabled={!draft.name.trim() || !usernameValid || !temperatureValid || !hoursValid}
        />
      }
      preview={
        <div className="entity-preview agent-preview">
          <div className="agent-preview__head">
            <AgentAvatar name={draft.name.trim() || "?"} mediaId={draft.avatar_media_id} size="lg" working={working} />
            <div>
              <div className="entity-preview__kind">{draft.title.trim() || t("entity.agent")}</div>
              <div className="entity-preview__label">{draft.name.trim() || t("agents.namePlaceholder")}</div>
              <div className="muted">@{username || t("agents.usernamePlaceholder")}</div>
            </div>
          </div>
          {statusLabel && agent ? (
            <div>
              <Badge tone={agentStatusTone(agent.status)}>{statusLabel}</Badge>
            </div>
          ) : null}
          {draft.bio.trim() ? <p className="entity-preview__note">{draft.bio.trim()}</p> : null}
          <dl className="entity-preview__meta">
            {draft.gender ? (
              <div>
                <dt>{t("agents.gender")}</dt>
                <dd>{t(`agents.gender.${draft.gender}` as MessageKey)}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("agents.model")}</dt>
              <dd>{[source?.name, draft.model.trim()].filter(Boolean).join(" · ") || "—"}</dd>
            </div>
            <div>
              <dt>{t("agents.toolAccess")}</dt>
              <dd>{t(`agents.toolAccess.${draft.tool_access}` as MessageKey)}</dd>
            </div>
            <div>
              <dt>{t("agents.workingHours")}</dt>
              <dd>{workingHoursSummary(draft.working_hours, t)}</dd>
            </div>
            <div>
              <dt>{t("agents.timeZone")}</dt>
              <dd>{draft.time_zone}</dd>
            </div>
          </dl>
          {draft.instructions.trim() ? <p className="entity-preview__note agent-preview__instructions">{draft.instructions.trim()}</p> : null}
        </div>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Input
            label={t("agents.name")}
            required
            autoFocus={!agent}
            maxLength={100}
            placeholder={t("agents.namePlaceholder")}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            onBlur={() => {
              if (!agent && !draft.username.trim() && draft.name.trim()) update({ username: normalizeUsername(draft.name).replace(/[^a-z0-9_-]/g, "").slice(0, 30) });
            }}
          />
          <Input
            label={t("agents.username")}
            required
            maxLength={31}
            placeholder={t("agents.usernamePlaceholder")}
            value={draft.username}
            onChange={(e) => update({ username: e.target.value })}
            hint={draft.username && !usernameValid ? t("agents.usernameHint") : undefined}
          />
          <Input label={t("agents.jobTitle")} maxLength={200} placeholder={t("agents.jobTitlePlaceholder")} value={draft.title} onChange={(e) => update({ title: e.target.value })} />
          <Select label={t("agents.gender")} value={draft.gender} onChange={(e) => update({ gender: e.target.value as AgentGender | "" })}>
            <option value="">—</option>
            {AGENT_GENDERS.map((g) => (
              <option key={g} value={g}>
                {t(`agents.gender.${g}` as MessageKey)}
              </option>
            ))}
          </Select>
        </div>
        {MediaPicker ? (
          <MediaPicker label={t("agents.avatar")} hint={t("agents.avatarHint")} kinds={["image"]} value={draft.avatar_media_id} onChange={(avatar_media_id) => update({ avatar_media_id })} />
        ) : null}
        <div className="bungalow-field">
          <label className="bungalow-label" htmlFor="agent-bio">
            {t("agents.bio")}
          </label>
          <textarea id="agent-bio" className="bungalow-input form-textarea" rows={3} maxLength={4000} value={draft.bio} onChange={(e) => update({ bio: e.target.value })} />
        </div>
        <div className="bungalow-field">
          <label className="bungalow-label" htmlFor="agent-instructions">
            {t("agents.instructions")}
          </label>
          <textarea
            id="agent-instructions"
            className="bungalow-input form-textarea"
            rows={6}
            maxLength={20000}
            placeholder={t("agents.instructionsPlaceholder")}
            value={draft.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
          />
          <p className="bungalow-help">{t("agents.instructionsHint")}</p>
        </div>

        <h3 className="form-section-title">{t("agents.ai")}</h3>
        <div className="form-grid">
          <Select label={t("agents.service")} value={draft.source} onChange={(e) => update({ source: e.target.value })}>
            {!source && agent ? <option value={draft.source}>{agent.provider}</option> : null}
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label={t("agents.model")}
            list="agent-model-choices"
            maxLength={200}
            placeholder={typeof settings.defaultModel === "string" && settings.defaultModel ? settings.defaultModel : "gpt-4o-mini"}
            value={draft.model}
            onChange={(e) => update({ model: e.target.value })}
          />
          <datalist id="agent-model-choices">
            {modelChoices.map((c) => (
              <option key={c.name} value={c.name}>
                {c.label}
              </option>
            ))}
          </datalist>
          <Input
            label={t("agents.temperature")}
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={draft.temperature}
            onChange={(e) => update({ temperature: e.target.value })}
            hint={t("agents.temperatureHint")}
          />
          <Select label={t("agents.toolAccess")} value={draft.tool_access} onChange={(e) => update({ tool_access: e.target.value as AgentToolAccess })}>
            {AGENT_TOOL_ACCESS.map((a) => (
              <option key={a} value={a}>
                {t(`agents.toolAccess.${a}` as MessageKey)}
              </option>
            ))}
          </Select>
        </div>
        <p className="bungalow-help">{t("agents.toolAccessHint")}</p>

        <h3 className="form-section-title">{t("agents.workingHours")}</h3>
        <Input label={t("agents.timeZone")} list="agent-time-zones" value={draft.time_zone} onChange={(e) => update({ time_zone: e.target.value })} />
        <datalist id="agent-time-zones">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <Checkbox
          label={t("agents.alwaysWorking")}
          checked={draft.working_hours.length === 0}
          onChange={(e) => update({ working_hours: e.target.checked ? [] : OFFICE_HOURS })}
        />
        {draft.working_hours.length ? <WorkingHoursField value={draft.working_hours} onChange={(working_hours) => update({ working_hours })} /> : null}
        {!hoursValid ? <p className="bungalow-help bungalow-help--error">{t("agents.workingHoursInvalid")}</p> : null}
        {saveError ? <p className="bungalow-help bungalow-help--error">{saveError}</p> : null}
        {actions.remove.error ? <p className="bungalow-help bungalow-help--error">{actions.remove.error.message}</p> : null}
      </div>
    </EntitySheet>
  );
}
