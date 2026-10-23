import type { Json } from "../../../supabase/types";

/** Who wrote a message: the instructions, the user, or the model. */
export type AiRole = "system" | "user" | "assistant";

/** A conversation with a model (`ai_conversations`). */
export type AiConversation = {
  id: string;
  user_id: string;
  title: string;
  /** The provider id (providers.ts), e.g. "ollama". */
  provider: string;
  /** The model it last used, as the provider names it (e.g. "llama3.2:3b"). */
  model: string | null;
  /** Its own instructions; null uses the app's `systemPrompt` setting. */
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
};

/** Timings and token counts a provider reports for an answer. */
export type AiMetrics = {
  promptTokens?: number;
  completionTokens?: number;
  /** Total time, in milliseconds. */
  durationMs?: number;
  /** Completion tokens per second. */
  tokensPerSecond?: number;
  /** The apps' tools the model called for the answer, in order. */
  tools?: { name: string; title?: string; ok: boolean }[];
};

/** A message of a conversation (`ai_messages`). */
export type AiMessage = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: AiRole;
  content: string;
  provider: string | null;
  model: string | null;
  metrics: AiMetrics | null;
  /** Why the answer stopped short (the provider failed, or the user stopped it). */
  error: string | null;
  created_at: string;
};

/** A model the user keeps in the chat's model picker (`ai_models`), synced from its provider. */
export type AiModel = {
  id: string;
  user_id: string;
  provider: string;
  /** The provider's name for it, sent with every request. */
  name: string;
  /** A name of the user's own, shown instead. */
  label: string | null;
  /** What the provider says about it (family, size, quantization, …). */
  details: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

type Stored<T> = { [K in keyof T]: T[K] extends AiMetrics | Record<string, unknown> | null ? Json | null : T[K] };

/** The tables the ai app reads and writes (see the migration in docs/guide/ai.md). */
export type AiDatabase = {
  public: {
    Tables: {
      ai_conversations: Table<AiConversation, "provider">;
      ai_messages: Table<Stored<AiMessage>, "conversation_id" | "role" | "content">;
      ai_models: Table<Stored<AiModel>, "provider" | "name">;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
