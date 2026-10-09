import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "../supabase/client";
import type { DateRangeSearch } from "../navigation/dateRangeSearch";
import { isUuid } from "./slugs";

/**
 * Paths left alone: a person (an account or an ego) is addressed by its id, and /app/<x> swaps
 * itself over to the app's slug in the Dashboard (it can also be another user's public app).
 */
const KEEP_IDS = [/^\/channels\/people\//, /^\/app\//];

/**
 * Old links and spacify: URIs address rows by uuid; the app's URLs use the row's slug. This swaps
 * every uuid segment of the current path for the slug of the row it is (via entity_slugs(), so
 * only rows the user can read), replacing the history entry and keeping the search params. Panels
 * match uuids too (findByEntityKey), so nothing flickers while this resolves.
 */
export function useSlugRedirect() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const keep = KEEP_IDS.some((re) => re.test(pathname));
  const uuids = keep ? [] : [...new Set(pathname.split("/").filter(isUuid))].sort();

  const slugs = useQuery({
    queryKey: ["entity-slugs", uuids],
    enabled: uuids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("entity_slugs", { p_keys: uuids });
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.key.toLowerCase(), row.slug]));
    },
  });

  useEffect(() => {
    if (!slugs.data || uuids.length === 0) return;
    const next = pathname
      .split("/")
      .map((segment) => (isUuid(segment) ? (slugs.data.get(segment.toLowerCase()) ?? segment) : segment))
      .join("/");
    if (next === pathname) return;
    navigate({ to: next, search: (prev: DateRangeSearch) => prev, replace: true } as Parameters<typeof navigate>[0]);
    // uuids is derived from pathname.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugs.data, pathname, navigate]);
}
