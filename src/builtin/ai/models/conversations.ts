import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "../../../supabase/client";
import type { Json } from "../../../supabase/types";
import type { AiConversation, AiDatabase, AiMessage, AiMetrics, AiRole } from "./types";

/** The shared client, typed with the ai app's tables. */
export const aiDb = () => getSupabaseClient<AiDatabase>();

export const aiConversationsKey = ["gondol", "ai", "conversations"] as const;
export const aiMessagesKey = (conversationId: string | null | undefined) => ["gondol", "ai", "messages", conversationId ?? null] as const;

/** The user's conversations, most recent first. */
export function useAiConversations() {
  return useQuery({
    queryKey: aiConversationsKey,
    queryFn: async () => {
      const { data, error } = await aiDb().from("ai_conversations").select("*").order("updated_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as AiConversation[];
    },
  });
}

/** A conversation's messages, oldest first. */
export function useAiMessages(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: aiMessagesKey(conversationId),
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await aiDb()
        .from("ai_messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as AiMessage[];
    },
  });
}

export async function createAiConversation(values: { title: string; provider: string; model: string | null; system_prompt?: string | null }): Promise<AiConversation> {
  const { data, error } = await aiDb().from("ai_conversations").insert(values).select("*").single();
  if (error) throw error;
  return data as AiConversation;
}

export async function addAiMessage(values: {
  conversation_id: string;
  role: AiRole;
  content: string;
  provider?: string | null;
  model?: string | null;
  metrics?: AiMetrics | null;
  error?: string | null;
}): Promise<AiMessage> {
  const { data, error } = await aiDb()
    .from("ai_messages")
    .insert({ ...values, metrics: (values.metrics ?? null) as Json })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as AiMessage;
}

export async function touchAiConversation(id: string, values: Partial<Pick<AiConversation, "model" | "provider" | "title">> = {}): Promise<void> {
  const { error } = await aiDb().from("ai_conversations").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export function useUpdateAiConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string } & Partial<Pick<AiConversation, "title" | "model" | "provider" | "system_prompt">>) => {
      const { error } = await aiDb().from("ai_conversations").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiConversationsKey }),
  });
}

export function useDeleteAiConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await aiDb().from("ai_conversations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiConversationsKey }),
  });
}

/** A title from the first message: its first line, cut at a word near 60 characters. */
export function conversationTitle(text: string): string {
  const line = text.trim().split("\n")[0].trim();
  if (line.length <= 60) return line || "…";
  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
