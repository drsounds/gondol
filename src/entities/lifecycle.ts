import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase/client";
import { useUserTheme } from "../theme/userTheme";
import { entityExtensions } from "./extensions";
import { parseEntityUri } from "./uri";

export interface EntityLifecycleState {
  entity_type: string;
  entity_id: string;
  entity_slug: string | null;
  entity_identifier: string | null;
  soft_deleted_at: string | null;
  future_start: boolean;
}

const QUERY_KEY = ["entity-lifecycle-states"];

export function useEntityLifecycle() {
  const queryClient = useQueryClient();
  const { preferences } = useUserTheme();
  // The app's own restrictions (a quarantine) fade an entity too.
  const restrictionFor = entityExtensions().useRestrictions();
  const states = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<EntityLifecycleState[]> => {
      const { data, error } = await supabase.rpc("entity_lifecycle_states");
      if (error) throw error;
      return data ?? [];
    },
  });

  const byUriKey = useMemo(() => {
    const map = new Map<string, EntityLifecycleState>();
    for (const state of states.data ?? []) {
      for (const key of [state.entity_id, state.entity_slug, state.entity_identifier]) {
        if (key) map.set(`${state.entity_type}:${key.toLowerCase()}`, state);
      }
    }
    return map;
  }, [states.data]);

  function stateFor(uri: string | undefined): EntityLifecycleState | undefined {
    const parsed = uri ? parseEntityUri(uri) : null;
    return parsed ? byUriKey.get(`${parsed.entityType}:${parsed.entityId.toLowerCase()}`) : undefined;
  }

  function isDimmed(uri: string | undefined): boolean {
    if (restrictionFor(uri)?.dimmed) return true;
    const state = stateFor(uri);
    if (!state) return false;
    const deleted = !!state.soft_deleted_at && Date.parse(state.soft_deleted_at) <= Date.now();
    return deleted || state.future_start;
  }

  function isHidden(uri: string | undefined): boolean {
    const state = stateFor(uri);
    if (!state) return false;
    const deleted = !!state.soft_deleted_at && Date.parse(state.soft_deleted_at) <= Date.now();
    return (deleted && !!preferences.hideSoftDeletedEntities) || (state.future_start && !!preferences.hideFutureEntities);
  }

  async function schedule(uri: string, at: string | null) {
    const parsed = parseEntityUri(uri);
    if (!parsed) throw new Error("Invalid entity URI");
    const { error } = await supabase.rpc("set_entity_soft_deleted_at", {
      p_entity_type: parsed.entityType,
      p_entity_key: parsed.entityId,
      p_at: at,
    });
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }

  return { loading: states.isPending, stateFor, restrictionFor, isDimmed, isHidden, schedule };
}
