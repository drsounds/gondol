import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MenuAction } from "../../../../../../entities/ActionMenu";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { entityKey } from "../../../../../../entities/slugs";
import { supabase } from "../../../../models/db";
import { useI18n } from "../../../../../../i18n/i18n";
import { agentsQueryKey, type Agent, type AgentStatus } from "../../../../models/agents";

/**
 * What can be done to an agent from its row, its page and its sheet: message it, edit it, suspend
 * or resume it, fire or rehire it, delete it.
 */
export function useAgentActions(onDeleted?: () => void) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const go = useNavigateKeepingSearch();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    void queryClient.invalidateQueries({ queryKey: ["agent-availability"] });
  };

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AgentStatus }) => {
      const { error } = await supabase.from("agents").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      onDeleted?.();
    },
  });

  const confirmDelete = (agent: Pick<Agent, "id" | "name">) => {
    if (window.confirm(t("agents.confirmDelete", { name: agent.name }))) remove.mutate(agent.id);
  };
  const confirmFire = (agent: Pick<Agent, "id" | "name">) => {
    if (window.confirm(t("agents.confirmFire", { name: agent.name }))) setStatus.mutate({ id: agent.id, status: "fired" });
  };

  /** The agent's menu items (edit is left to the caller, which knows where its sheet is). */
  const statusActions = (agent: Agent): MenuAction[] => [
    { key: "message", label: t("agents.message"), onSelect: () => go(`/agents/${entityKey(agent)}/messages/me`) },
    ...(agent.status === "active"
      ? [{ key: "suspend", label: t("agents.suspend"), onSelect: () => setStatus.mutate({ id: agent.id, status: "suspended" }), aspects: ["edit" as const] }]
      : agent.status === "suspended"
        ? [{ key: "resume", label: t("agents.resume"), onSelect: () => setStatus.mutate({ id: agent.id, status: "active" }), aspects: ["edit" as const] }]
        : [{ key: "rehire", label: t("agents.rehire"), onSelect: () => setStatus.mutate({ id: agent.id, status: "active" }), aspects: ["edit" as const] }]),
    ...(agent.status !== "fired"
      ? [{ key: "fire", label: t("agents.fire"), tone: "danger" as const, onSelect: () => confirmFire(agent), aspects: ["edit" as const] }]
      : []),
  ];

  return { setStatus, remove, confirmDelete, statusActions };
}
