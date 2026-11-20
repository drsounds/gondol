import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "../../../supabase/client";
import { getRegistryServer, listRegistryServers } from "./registryApi";
import type { McpRegistry, McpRegistryWrite, ServiceFinderDatabase } from "./types";

/** The shared client, typed with the service-finder app's tables. */
export const finderDb = () => getSupabaseClient<ServiceFinderDatabase>();

export const mcpRegistriesKey = ["gondol", "service-finder", "registries"] as const;

const COLUMNS = "id,user_id,name,url,description,kind,enabled,position,created_at,updated_at";

/** The registries the user can browse: the built-in ones first, then their own, in order. */
export function useMcpRegistries() {
  return useQuery({
    queryKey: mcpRegistriesKey,
    queryFn: async () => {
      const { data, error } = await finderDb().from("mcp_registries").select(COLUMNS).order("position").order("created_at");
      if (error) throw error;
      const rows = (data ?? []) as McpRegistry[];
      return [...rows.filter((r) => !r.user_id), ...rows.filter((r) => r.user_id)];
    },
  });
}

/** Adds a registry (`id` absent) or changes one of the user's own. */
export function useSaveMcpRegistry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: McpRegistryWrite & { id?: string }): Promise<McpRegistry> => {
      const query = id
        ? finderDb().from("mcp_registries").update(values).eq("id", id)
        : finderDb()
            .from("mcp_registries")
            .insert({ ...values, name: values.name ?? "", url: values.url ?? "" });
      const { data, error } = await query.select(COLUMNS).single();
      if (error) throw error;
      return data as McpRegistry;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: mcpRegistriesKey }),
  });
}

export function useDeleteMcpRegistry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await finderDb().from("mcp_registries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: mcpRegistriesKey }),
  });
}

/** A registry's servers matching `search`, a page at a time (latest versions only). */
export function useRegistryServers(registry: McpRegistry | undefined, search: string) {
  return useInfiniteQuery({
    queryKey: ["gondol", "service-finder", "servers", registry?.id ?? null, registry?.url ?? null, search.trim()],
    enabled: !!registry,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => listRegistryServers(registry!, { search, cursor: pageParam, signal }),
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 5 * 60_000,
  });
}

/** One server's latest version, from the first of `registries` that has it. */
export function useRegistryServer(registries: McpRegistry[], name: string | null) {
  return useQuery({
    queryKey: ["gondol", "service-finder", "server", name, registries.map((r) => r.id)],
    enabled: !!name && registries.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      for (const registry of registries) {
        const entry = await getRegistryServer(registry, name!, signal).catch(() => null);
        if (entry) return { registry, entry };
      }
      return null;
    },
  });
}
