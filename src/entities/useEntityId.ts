import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase/client";
import { idForEntityKey, type Keyed } from "./slugs";

// The table is a parameter, so the typed client's per-table overloads can't apply.
type LooseTable = {
  select: (columns: string) => { eq: (column: string, value: string) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> } };
};
const looseFrom = supabase.from.bind(supabase) as unknown as (table: string) => LooseTable;

/**
 * The uuid of the row a URL key (slug, identifier or uuid) points at, for views whose loaded
 * `rows` may not include it (e.g. a calendar event outside the month on screen): resolved from
 * `rows` or the key itself when possible, else looked up by slug in `table`. Undefined while
 * loading or when nothing matches.
 */
export function useEntityIdForKey(table: string, key: string | null | undefined, rows: readonly Keyed[] | null | undefined) {
  const known = idForEntityKey(rows, key);
  const lookup = useQuery({
    queryKey: ["entity-id-for-slug", table, key],
    enabled: !!key && !known,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await looseFrom(table).select("id").eq("slug", key!).limit(1);
      if (error) throw error;
      return ((data?.[0] as { id?: string } | undefined)?.id ?? null) as string | null;
    },
  });
  return { id: known ?? lookup.data ?? undefined, isLoading: !known && lookup.isLoading };
}
