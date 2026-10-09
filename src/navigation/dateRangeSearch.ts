import { z } from "zod";

// The router JSON-parses search values it can (`?where=123` arrives as a number), so every global
// param is read back as a string.
const searchString = z.preprocess((v) => (v == null || v === "" ? undefined : String(v)), z.string().optional());

/**
 * The app's global state, carried as GET querystring params on every route so it survives
 * navigation, reloads and shared links (the root route's `retainSearchParams` copies them onto
 * every navigation, see src/routes/__root.tsx):
 *
 * - `fromDate` / `toDate`: the date period (the calendar button in the header), YYYY-MM-DD.
 * - `types`, `where`, `match`: the entity filter (the funnel button), see src/lib/globalFilter.tsx.
 */
export const dateRangeSearchSchema = z.object({
  fromDate: searchString,
  toDate: searchString,
  types: searchString,
  where: searchString,
  match: searchString,
});

export type DateRangeSearch = z.infer<typeof dateRangeSearchSchema>;

/** The search params every navigation keeps. */
export const GLOBAL_SEARCH_KEYS = ["fromDate", "toDate", "types", "where", "match"] as const satisfies readonly (keyof DateRangeSearch)[];

/** Route `validateSearch` option: keeps unrelated search params (per-route ones, if any) intact. */
export function validateDateRangeSearch(search: Record<string, unknown>): DateRangeSearch {
  return dateRangeSearchSchema.parse(search);
}

/** /search: the global params plus the query (`q`) and the selected result-type filter chip (`type`). */
export const searchRouteSearchSchema = dateRangeSearchSchema.extend({
  q: z.string().optional(),
  type: z.string().optional(),
});

export type SearchRouteSearch = z.infer<typeof searchRouteSearchSchema>;

export function validateSearchRouteSearch(search: Record<string, unknown>): SearchRouteSearch {
  return searchRouteSearchSchema.parse(search);
}
