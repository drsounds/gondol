import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiDb } from "./conversations";
import { aiAppToolsKey } from "./tools";
import type { Json } from "../../../supabase/types";
import type { AiMcpServer, AiMcpServerWrite } from "./types";

/**
 * The user's own MCP servers (`ai_mcp_servers`): remote servers (Streamable HTTP) whose tools the
 * chat offers the model next to the apps'. The app router calls them for the user, server-side, so
 * an address must be public HTTPS (or allowed on the server, MCP_ALLOWED_HOSTS), and their headers
 * (a bearer token, an API key) never come back to the browser: `set_ai_mcp_server_headers()` keeps
 * the values in `ai_mcp_server_headers`, and `header_names` says which are set.
 */

export const aiMcpServersKey = ["gondol", "ai", "mcp-servers"] as const;
/** The app router's catalogue as the chat's Apps panel reads it. */
export const aiAppCatalogKey = ["gondol", "ai", "app-catalog"] as const;

const COLUMNS = "id,user_id,name,url,description,header_names,enabled,position,created_at,updated_at";

/** The user's MCP servers, in their order. */
export function useAiMcpServers() {
  return useQuery({
    queryKey: aiMcpServersKey,
    queryFn: async () => {
      const { data, error } = await aiDb().from("ai_mcp_servers").select(COLUMNS).order("position").order("created_at");
      if (error) throw error;
      return (data ?? []) as AiMcpServer[];
    },
  });
}

/** The app id the server's tools go under on the router's MCP server (`<id>__<tool>`), as router.ts's userMcpAppId(). */
export function mcpServerAppId(serverId: string): string {
  return `mcp_${serverId.replace(/-/g, "").slice(0, 8).toLowerCase()}`;
}

/**
 * Adds a server (`id` absent) or changes one. `headers` sets header values (an empty value removes
 * that header), `removeHeaders` removes headers by name; the rest stay as they are.
 */
export function useSaveAiMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      headers,
      removeHeaders,
      ...values
    }: AiMcpServerWrite & { id?: string; headers?: Record<string, string>; removeHeaders?: string[] }): Promise<AiMcpServer> => {
      const query = id
        ? aiDb().from("ai_mcp_servers").update(values).eq("id", id)
        : aiDb()
            .from("ai_mcp_servers")
            .insert({ ...values, name: values.name ?? "", url: values.url ?? "" });
      const { data, error } = await query.select(COLUMNS).single();
      if (error) throw error;
      const server = data as AiMcpServer;
      if ((headers && Object.keys(headers).length) || removeHeaders?.length) {
        const { data: names, error: headerError } = await aiDb().rpc("set_ai_mcp_server_headers", {
          p_server_id: server.id,
          p_set: (headers ?? {}) as Json,
          p_remove: removeHeaders ?? [],
        });
        if (headerError) throw headerError;
        return { ...server, header_names: (names as string[] | null) ?? server.header_names };
      }
      return server;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiMcpServersKey });
      void queryClient.invalidateQueries({ queryKey: aiAppToolsKey });
      void queryClient.invalidateQueries({ queryKey: aiAppCatalogKey });
    },
  });
}

export function useDeleteAiMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await aiDb().from("ai_mcp_servers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiMcpServersKey });
      void queryClient.invalidateQueries({ queryKey: aiAppToolsKey });
      void queryClient.invalidateQueries({ queryKey: aiAppCatalogKey });
    },
  });
}

/** An HTTP header name as RFC 9110 has it (a token). */
export const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;
