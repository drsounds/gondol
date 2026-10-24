import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import type { Agent } from "../../../../models/agents";

/** "At work", "Off until Mon 09:00", "Suspended", … for an agent and its agent_availability() row. */
export function useAvailabilityText() {
  const { t, intlLocale } = useI18n();
  return (agent: Pick<Agent, "status" | "time_zone">, now: { working: boolean; next_working_at: string | null } | undefined) => {
    if (agent.status !== "active") return t(`agents.status.${agent.status}` as MessageKey);
    if (!now) return "—";
    if (now.working) return t("agents.atWork");
    if (!now.next_working_at) return t("agents.noHours");
    const when = new Date(now.next_working_at).toLocaleString(intlLocale, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    return t("agents.offUntil", { when });
  };
}
