import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { aiDb } from "./conversations";
import type { AiToolPermission } from "./types";

/**
 * Tools the user let the AI run without asking (`ai_tool_permissions`): when the chat asks before a
 * tool runs, the user can allow it once, for the rest of the conversation, or always. The last two
 * are kept here; the AI settings list them to take back.
 */

export const aiToolPermissionsKey = ["gondol", "ai", "tool-permissions"] as const;

/** How the user answered the chat's question about a tool. */
export type AiToolDecision = "once" | "conversation" | "always" | "deny";

/** Every tool the user allowed, newest first. */
export function useAiToolPermissions() {
  return useQuery({
    queryKey: aiToolPermissionsKey,
    queryFn: async () => {
      const { data, error } = await aiDb().from("ai_tool_permissions").select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as AiToolPermission[];
    },
  });
}

/** Whether `tool` may run in the conversation without asking. */
export function isToolAllowed(permissions: AiToolPermission[] | undefined, tool: string, conversationId: string | null): boolean {
  return (permissions ?? []).some((p) => p.tool === tool && (p.conversation_id === null || p.conversation_id === conversationId));
}

/** Keeps a decision to allow a tool in the conversation (`conversationId`) or always (null). */
export async function allowAiTool(queryClient: QueryClient, values: { tool: string; title?: string | null; conversationId: string | null }): Promise<void> {
  const { data, error } = await aiDb()
    .from("ai_tool_permissions")
    .insert({ tool: values.tool, title: values.title ?? null, conversation_id: values.conversationId })
    .select("*")
    .single();
  // 23505: it's already allowed there.
  if (error && error.code !== "23505") throw error;
  if (data) queryClient.setQueryData<AiToolPermission[]>(aiToolPermissionsKey, (previous) => [data as AiToolPermission, ...(previous ?? [])]);
}

/** Takes a permission back: the chat asks about that tool again. */
export function useRevokeAiToolPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await aiDb().from("ai_tool_permissions").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: (id) => {
      queryClient.setQueryData<AiToolPermission[]>(aiToolPermissionsKey, (previous) => previous?.filter((p) => p.id !== id));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiToolPermissionsKey }),
  });
}
