import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Checkbox, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { sessionUserId } from "../../../../../../supabase/session";
import { useAgentChannels } from "../../../../models/host";
import { supabase } from "../../../../models/db";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import { CRON_PRESETS, agentSchedulesKey, isCronShaped, type Agent, type AgentSchedule } from "../../../../models/agents";
import { AgentAvatar } from "./AgentAvatar";
import { workingHoursSummary } from "./WorkingHoursField";

interface Draft {
  title: string;
  instructions: string;
  cron: string;
  enabled: boolean;
  outside_hours: boolean;
  channel_id: string;
}

/**
 * The create/edit sheet of one of an agent's schedules: what it is asked to do, when (a five-field
 * cron expression in the agent's time zone, during its working hours unless told otherwise) and
 * where the result goes (a channel, or the owner's direct thread with the agent).
 */
export function AgentScheduleSheet({ agent, schedule, onClose }: { agent: Agent; schedule?: AgentSchedule; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const channels = useAgentChannels().data ?? [];
  const [draft, setDraft] = useState<Draft>(() => ({
    title: schedule?.title ?? "",
    instructions: schedule?.instructions ?? "",
    cron: schedule?.cron ?? "0 9 * * 1-5",
    enabled: schedule?.enabled ?? true,
    outside_hours: schedule?.outside_hours ?? false,
    channel_id: schedule?.channel_id ?? "",
  }));
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: agentSchedulesKey(agent.id) });

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const payload = {
        title: d.title.trim(),
        instructions: d.instructions.trim(),
        cron: d.cron.trim().replace(/\s+/g, " "),
        enabled: d.enabled,
        outside_hours: d.outside_hours,
        channel_id: d.channel_id || null,
      };
      const { error } = schedule
        ? await supabase.from("agent_schedules").update(payload).eq("id", schedule.id)
        : await supabase.from("agent_schedules").insert({ ...payload, agent_id: agent.id, user_id: await sessionUserId() });
      if (error) throw error;
    },
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agent_schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });

  const preset = CRON_PRESETS.find((p) => p.cron === draft.cron.trim());
  const channel = channels.find((c) => c.id === draft.channel_id);
  return (
    <EntitySheet
      title={schedule ? schedule.title : t("agents.schedule.add")}
      subtitle={agent.name}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(draft);
      }}
      footer={
        <FormActions
          onDelete={schedule ? () => window.confirm(t("agents.schedule.confirmDelete", { name: schedule.title })) && remove.mutate(schedule.id) : undefined}
          deleteLabel={t("agents.schedule.delete")}
          deleting={remove.isPending}
          onCancel={schedule ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={schedule ? t("form.save") : t("agents.schedule.create")}
          saving={save.isPending}
          submitDisabled={!draft.title.trim() || !draft.instructions.trim() || !isCronShaped(draft.cron)}
        />
      }
      preview={
        <div className="entity-preview">
          <div className="agent-preview__head">
            <AgentAvatar name={agent.name} mediaId={agent.avatar_media_id} size="lg" />
            <div>
              <div className="entity-preview__kind">{t("agents.schedule.kind")}</div>
              <div className="entity-preview__label">{draft.title.trim() || t("agents.schedule.titlePlaceholder")}</div>
            </div>
          </div>
          {draft.instructions.trim() ? <p className="entity-preview__note agent-preview__instructions">{draft.instructions.trim()}</p> : null}
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("agents.schedule.when")}</dt>
              <dd>{preset ? t(`agents.cron.${preset.key}` as MessageKey) : draft.cron}</dd>
            </div>
            <div>
              <dt>{t("agents.workingHours")}</dt>
              <dd>{draft.outside_hours ? t("agents.schedule.anyTime") : workingHoursSummary(agent.working_hours, t)}</dd>
            </div>
            <div>
              <dt>{t("agents.schedule.postTo")}</dt>
              <dd>{channel ? `#${channel.name}` : t("agents.schedule.toDirect")}</dd>
            </div>
          </dl>
        </div>
      }
    >
      <div className="stack">
        <Input
          label={t("agents.schedule.title")}
          required
          autoFocus={!schedule}
          maxLength={200}
          placeholder={t("agents.schedule.titlePlaceholder")}
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
        />
        <div className="bungalow-field">
          <label className="bungalow-label" htmlFor="agent-schedule-instructions">
            {t("agents.schedule.instructions")}
          </label>
          <textarea
            id="agent-schedule-instructions"
            className="bungalow-input form-textarea"
            rows={6}
            required
            maxLength={20000}
            placeholder={t("agents.schedule.instructionsPlaceholder")}
            value={draft.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
          />
        </div>
        <div className="form-grid">
          <Select label={t("agents.schedule.preset")} value={preset?.cron ?? ""} onChange={(e) => e.target.value && update({ cron: e.target.value })}>
            <option value="">{t("agents.cron.custom")}</option>
            {CRON_PRESETS.map((p) => (
              <option key={p.key} value={p.cron}>
                {t(`agents.cron.${p.key}` as MessageKey)}
              </option>
            ))}
          </Select>
          <Input
            label={t("agents.schedule.cron")}
            required
            value={draft.cron}
            onChange={(e) => update({ cron: e.target.value })}
            hint={t("agents.schedule.cronHint", { zone: agent.time_zone })}
          />
        </div>
        <Select label={t("agents.schedule.postTo")} value={draft.channel_id} onChange={(e) => update({ channel_id: e.target.value })}>
          <option value="">{t("agents.schedule.toDirect")}</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </Select>
        <Checkbox label={t("agents.schedule.outsideHours")} checked={draft.outside_hours} onChange={(e) => update({ outside_hours: e.target.checked })} />
        <Checkbox label={t("agents.schedule.enabled")} checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        {save.error ? <p className="bungalow-help bungalow-help--error">{save.error.message}</p> : null}
        {remove.error ? <p className="bungalow-help bungalow-help--error">{remove.error.message}</p> : null}
      </div>
    </EntitySheet>
  );
}
