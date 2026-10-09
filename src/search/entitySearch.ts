import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase/client";
import { isKnownEntityType, lookupEntity } from "../entities/lookup";
import { entityRefFromText } from "../entities/shareUri";
import { useSiteEntityFilter } from "../sites/sites";
import type { EntityType } from "../entities/uri";

/** One row of search_entities(): any entity the user can see. */
export interface EntitySearchResult {
  entity_type: EntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  is_own: boolean;
  is_public: boolean;
  updated_at?: string | null;
}

export function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * The one entity search behind @ mentions and <EntityPicker/> (and the same function /search
 * uses), so whatever one of them can find, the others can too. `types` narrows it to some entity
 * types (omit for all). An empty query lists the most recently changed rows, but only when
 * `browse` is set; otherwise nothing is fetched until something is typed. A pasted spacify: URI or
 * app URL (by slug, identifier or uuid) finds just that entity, if its type is among `types`.
 * Results are narrowed to what the site served on this domain shows (src/lib/sites.tsx).
 */
export function useEntitySearch(
  query: string,
  { types, limit = 20, enabled = true, browse = false }: { types?: readonly EntityType[]; limit?: number; enabled?: boolean; browse?: boolean } = {},
) {
  const siteFilter = useSiteEntityFilter();
  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 150);
  const typeKey = types ? [...types].sort() : null;
  const result = useQuery({
    queryKey: ["entity-search", typeKey, debounced, limit],
    enabled: enabled && (browse || debounced.length > 0),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<EntitySearchResult[]> => {
      const ref = entityRefFromText(debounced);
      if (ref) {
        if (typeKey && !typeKey.includes(ref.entityType)) return [];
        const found = await lookupEntity(ref.entityType, ref.entityId);
        return found
          ? [{ entity_type: ref.entityType, entity_id: found.id, title: found.title, subtitle: null, is_own: found.isOwn, is_public: !found.isOwn }]
          : [];
      }
      const { data, error } = await supabase.rpc("search_entities", {
        p_query: debounced,
        p_limit: limit,
        ...(typeKey ? { p_types: typeKey } : {}),
      });
      if (error) throw error;
      return (data ?? [])
        .filter((r) => r.title && isKnownEntityType(r.entity_type))
        .map((r) => ({
          entity_type: r.entity_type as EntityType,
          entity_id: r.entity_id,
          title: r.title!,
          subtitle: r.subtitle,
          is_own: r.is_own,
          is_public: r.is_public,
          updated_at: r.updated_at,
        }));
    },
  });
  // Results are only "current" for the query they were fetched for, so lists never lag behind typing.
  const current = debounced === trimmed && !result.isPlaceholderData;
  return {
    results: enabled && (browse || trimmed) ? siteFilter(result.data ?? []) : [],
    current,
    loading: enabled && (browse || trimmed.length > 0) && (!current || result.isFetching),
  };
}
