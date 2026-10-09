import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { supabase } from "../supabase/client";
import type { Json } from "../supabase/types";
import type { DateRangeSearch } from "../navigation/dateRangeSearch";
import { SITE_CONDITION_FIELDS, SITE_CONDITION_OPS, type SiteCondition, type SiteConditionMatch } from "../sites/sites";
import { parseEntityUri } from "../entities/uri";

/**
 * The global filter: the funnel and calendar buttons in the header. It is part of the app's
 * state, not of a view, so it lives in the querystring (`types`, `where`, `match`, `fromDate`,
 * `toDate`; see src/lib/dateRangeSearch.ts), which every navigation keeps, and applies to
 * whatever view is open:
 *
 * - `types`: comma-separated entity types; rows of any other type are hidden.
 * - `where`: conditions (the same fields and operators as a site's, src/lib/sites.tsx), as
 *   `field.op:value` joined by `;`, matched `all` or, with `match=any`, any of them.
 * - `fromDate` / `toDate`: only entities dated within the period show. Entities without a date of
 *   their own are never hidden by it.
 *
 * Every list row that follows the ActionMenu convention (an `.action-row` with a spacify `uri`)
 * is hidden when its entity doesn't pass (`useGlobalFilterHides()` in ActionMenu), so any view
 * gets the filter for free. Conditions and the period are evaluated on the server by
 * `global_filter_excluded()`, which returns the entities that fail them.
 */
export type FilterCondition = SiteCondition;

export interface GlobalFilter {
  /** Entity types to show; null shows every type. */
  types: string[] | null;
  conditions: FilterCondition[];
  match: SiteConditionMatch;
}

export interface DatePeriod {
  from: string | null;
  to: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const escapeValue = (value: string) => value.replace(/%/g, "%25").replace(/;/g, "%3B");
function unescapeValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Conditions as the `where` param: `title.contains:foo;tag.has:work`. */
export function encodeConditions(conditions: readonly FilterCondition[]): string | undefined {
  const parts = conditions
    .filter((c) => c.field === "ownership" || c.value.trim())
    .map((c) => `${c.field}.${c.op}:${escapeValue(c.value.trim())}`);
  return parts.length ? parts.join(";") : undefined;
}

export function decodeConditions(where: string | undefined): FilterCondition[] {
  if (!where) return [];
  const out: FilterCondition[] = [];
  for (const part of where.split(";")) {
    const m = /^(\w+)\.(\w+):(.*)$/.exec(part);
    if (!m) continue;
    const field = m[1] as FilterCondition["field"];
    if (!SITE_CONDITION_FIELDS.includes(field) || !SITE_CONDITION_OPS[field].includes(m[2])) continue;
    out.push({ field, op: m[2], value: unescapeValue(m[3]) });
  }
  return out;
}

export function readGlobalFilter(search: DateRangeSearch): GlobalFilter {
  const types = search.types
    ?.split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z_]+$/.test(s));
  return {
    types: types?.length ? types : null,
    conditions: decodeConditions(search.where),
    match: search.match === "any" ? "any" : "all",
  };
}

export function readDatePeriod(search: DateRangeSearch): DatePeriod {
  return {
    from: search.fromDate && ISO_DATE.test(search.fromDate) ? search.fromDate : null,
    to: search.toDate && ISO_DATE.test(search.toDate) ? search.toDate : null,
  };
}

/** The querystring params for a filter (undefined removes a param). */
export function globalFilterSearch(filter: GlobalFilter): Pick<DateRangeSearch, "types" | "where" | "match"> {
  const where = encodeConditions(filter.conditions);
  return {
    types: filter.types?.length ? [...filter.types].sort().join(",") : undefined,
    where,
    match: where && filter.match === "any" ? "any" : undefined,
  };
}

export const isFilterActive = (filter: GlobalFilter) => !!filter.types?.length || filter.conditions.length > 0;
export const isPeriodActive = (period: DatePeriod) => !!(period.from || period.to);

interface GlobalFilterContextValue {
  filter: GlobalFilter;
  period: DatePeriod;
  filterActive: boolean;
  periodActive: boolean;
  setFilter: (filter: GlobalFilter) => void;
  setPeriod: (period: DatePeriod) => void;
  /** Clears the filter and the period. */
  clear: () => void;
  /** Whether the entity behind a spacify: URI is filtered out of the current view. */
  hides: (uri: string) => boolean;
}

const NO_FILTER: GlobalFilter = { types: null, conditions: [], match: "all" };

const GlobalFilterContext = createContext<GlobalFilterContextValue>({
  filter: NO_FILTER,
  period: { from: null, to: null },
  filterActive: false,
  periodActive: false,
  setFilter: () => {},
  setPeriod: () => {},
  clear: () => {},
  hides: () => false,
});

export function GlobalFilterProvider({ children }: { children: ReactNode }) {
  const search = useSearch({ strict: false }) as DateRangeSearch;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const filter = useMemo(() => readGlobalFilter(search), [search.types, search.where, search.match]); // eslint-disable-line react-hooks/exhaustive-deps
  const period = useMemo(() => readDatePeriod(search), [search.fromDate, search.toDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const filterActive = isFilterActive(filter);
  const periodActive = isPeriodActive(period);
  const where = encodeConditions(filter.conditions);
  const needsServer = !!where || periodActive;

  const excluded = useQuery({
    queryKey: ["global-filter", filter.types, where ?? null, filter.match, period.from, period.to],
    enabled: needsServer,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.rpc("global_filter_excluded", {
        p_types: filter.types ?? undefined,
        p_conditions: filter.conditions.filter((c) => c.field === "ownership" || c.value.trim()) as unknown as Json,
        p_match: filter.match,
        p_from: period.from ?? undefined,
        p_to: period.to ?? undefined,
      });
      if (error) throw error;
      return new Set((data ?? []).map((r) => `${r.entity_type}:${r.entity_id}`));
    },
  });

  // Rows change all the time; whatever was saved may now pass or fail the filter.
  useEffect(() => {
    if (!needsServer) return;
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") {
        queryClient.invalidateQueries({ queryKey: ["global-filter"] });
      }
    });
  }, [needsServer, queryClient]);

  const excludedSet = needsServer ? excluded.data : undefined;
  const hides = useCallback(
    (uri: string) => {
      const parsed = parseEntityUri(uri);
      if (!parsed) return false;
      if (filter.types && !filter.types.includes(parsed.entityType)) return true;
      return !!excludedSet?.has(`${parsed.entityType}:${parsed.entityId}`);
    },
    [filter.types, excludedSet],
  );

  const setFilter = useCallback(
    (next: GlobalFilter) =>
      navigate({
        to: pathname,
        search: (prev: DateRangeSearch) => ({ ...prev, ...globalFilterSearch(next) }),
        replace: true,
      } as Parameters<typeof navigate>[0]),
    [navigate, pathname],
  );
  const setPeriod = useCallback(
    (next: DatePeriod) =>
      navigate({
        to: pathname,
        search: (prev: DateRangeSearch) => ({ ...prev, fromDate: next.from ?? undefined, toDate: next.to ?? undefined }),
        replace: true,
      } as Parameters<typeof navigate>[0]),
    [navigate, pathname],
  );

  const clear = useCallback(
    () =>
      navigate({
        to: pathname,
        search: (prev: DateRangeSearch) => ({ ...prev, ...globalFilterSearch(NO_FILTER), fromDate: undefined, toDate: undefined }),
        replace: true,
      } as Parameters<typeof navigate>[0]),
    [navigate, pathname],
  );

  const value = useMemo(
    () => ({ filter, period, filterActive, periodActive, setFilter, setPeriod, clear, hides }),
    [filter, period, filterActive, periodActive, setFilter, setPeriod, clear, hides],
  );
  return <GlobalFilterContext.Provider value={value}>{children}</GlobalFilterContext.Provider>;
}

export function useGlobalFilter() {
  return useContext(GlobalFilterContext);
}

/** Whether the global filter hides the entity behind `uri` (false without one). */
export function useGlobalFilterHides(uri: string | undefined): boolean {
  const { hides } = useContext(GlobalFilterContext);
  return uri ? hides(uri) : false;
}
