import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase/client";
import { sessionUserId } from "../supabase/session";
import { parseEntityUri } from "./uri";

/**
 * Entities their owner made public with "Make public" (`public_entities`, keyed by spacify type +
 * id like tags and covers). Public sites (sites.allow_anonymous) show them to visitors without an
 * account, next to rows whose own `is_public` flag is on (playlists, apps, hubs, channels).
 */
export const publicEntitiesQueryOptions = {
  queryKey: ["public-entities"],
  queryFn: async (): Promise<Set<string>> => {
    const userId = await sessionUserId();
    const { data, error } = await supabase.from("public_entities").select("entity_type, entity_id").eq("user_id", userId);
    if (error) throw error;
    return new Set((data ?? []).map((row) => `${row.entity_type}:${row.entity_id}`));
  },
  staleTime: 60_000,
};

export function usePublicEntities() {
  const query = useQuery(publicEntitiesQueryOptions);
  const keys = query.data;
  return useMemo(
    () => ({
      isPublic: (uri: string) => {
        const parsed = parseEntityUri(uri);
        return !!parsed && !!keys?.has(`${parsed.entityType}:${parsed.entityId}`);
      },
    }),
    [keys],
  );
}

/** Makes an entity public (on public sites) or private again. */
export function useSetEntityPublic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uri, isPublic }: { uri: string; isPublic: boolean }) => {
      const parsed = parseEntityUri(uri);
      if (!parsed) throw new Error(`Not a spacify URI: ${uri}`);
      const userId = await sessionUserId();
      if (isPublic) {
        const { error } = await supabase
          .from("public_entities")
          .upsert({ user_id: userId, entity_type: parsed.entityType, entity_id: parsed.entityId }, { onConflict: "user_id,entity_type,entity_id", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("public_entities")
          .delete()
          .eq("user_id", userId)
          .eq("entity_type", parsed.entityType)
          .eq("entity_id", parsed.entityId);
        if (error) throw error;
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: publicEntitiesQueryOptions.queryKey }),
  });
}
