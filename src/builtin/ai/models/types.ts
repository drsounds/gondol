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
  /** The service (ai_services) it talks to; null uses the provider's settings. */
  service_id: string | null;
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
  tools?: { name: string; title?: string; ok: boolean; denied?: boolean }[];
  /** MCP-UI resources the tools returned (`ui://…`), shown under the answer. */
  ui?: { tool: string; resource: { uri: string; mimeType?: string; text?: string; blob?: string; _meta?: Record<string, unknown> } }[];
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
  /** The message it replies to, in a thread under it (threads.ts); null on the conversation's own line. */
  parent_id: string | null;
  /** When its author changed it, or the answer was written again. */
  edited_at: string | null;
  /** When it was deleted: it shows as deleted, and can be restored from the conversation's deleted messages. */
  soft_deleted_at: string | null;
  created_at: string;
};

/** A model the user keeps in the chat's model picker (`ai_models`), synced from its provider. */
export type AiModel = {
  id: string;
  user_id: string;
  provider: string;
  /** The service serving it (ai_services); null for the provider's settings. */
  service_id: string | null;
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

/**
 * An AI service the user added (`ai_services`): one API of a provider (OpenAI, Berget AI, a local
 * Ollama, …) with its own address and key. The key is write-only: it's kept apart, in
 * `ai_service_keys`, which the client can't read, and set with `set_ai_service_key()`
 * (`has_api_key` says whether one is saved); the AI edge functions read it server-side.
 */
export type AiService = {
  id: string;
  user_id: string;
  name: string;
  /** The provider id (providers.ts) whose API it speaks, e.g. "openai" or "ollama". */
  provider: string;
  /** Its API address; null uses the provider's default (OpenAI's, or the server's Ollama). */
  base_url: string | null;
  has_api_key: boolean;
  enabled: boolean;
  position: number;
  /** What its provider needs besides an address, e.g. `{ backend: "ollama" }` for a Deep Agent. */
  options: AiServiceOptions;
  created_at: string;
  updated_at: string;
};

/** A service's provider-specific options (`ai_services.options`). */
export type AiServiceOptions = {
  /** For a Deep Agent (provider `deepagents`): the API its model runs on, `ollama` or `openai`. */
  backend?: "ollama" | "openai";
};

/** What the client writes to ai_services. */
export type AiServiceWrite = Partial<Pick<AiService, "name" | "provider" | "base_url" | "enabled" | "position" | "options">>;

/**
 * A tool the user let the AI run without asking (`ai_tool_permissions`): in one conversation
 * (`conversation_id`), or everywhere (null). `tool` is its name on the app router's MCP server
 * (`<app>__<tool>`).
 */
export type AiToolPermission = {
  id: string;
  user_id: string;
  tool: string;
  /** Its title when it was allowed, to list it by. */
  title: string | null;
  conversation_id: string | null;
  created_at: string;
};

/**
 * An MCP server the user added (`ai_mcp_servers`): its tools join the apps' in the chat, through
 * the app router. Its headers (a bearer token, an API key) are write-only like a service's key:
 * the values live in `ai_mcp_server_headers`, which the client can't read, set with
 * `set_ai_mcp_server_headers()`; `header_names` says which are set.
 */
export type AiMcpServer = {
  id: string;
  user_id: string;
  name: string;
  /** Its Streamable HTTP address, e.g. https://mcp.example.com/mcp. */
  url: string;
  description: string | null;
  header_names: string[];
  enabled: boolean;
  position: number;
  /** The registry it was installed from (the Service Finder's `mcp_registries`), or null when added by hand. */
  registry_id: string | null;
  /** Its name in that registry, e.g. io.github.acme/weather. */
  registry_server: string | null;
  /** The version that was installed. */
  registry_version: string | null;
  website_url: string | null;
  repository_url: string | null;
  icon_url: string | null;
  created_at: string;
  updated_at: string;
};

export type AiMcpServerWrite = Partial<
  Pick<
    AiMcpServer,
    | "name"
    | "url"
    | "description"
    | "enabled"
    | "position"
    | "registry_id"
    | "registry_server"
    | "registry_version"
    | "website_url"
    | "repository_url"
    | "icon_url"
  >
>;

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
      ai_services: {
        Row: Omit<AiService, "options"> & { options: Json };
        Insert: Omit<AiServiceWrite, "options"> & Pick<AiService, "name" | "provider"> & { options?: Json };
        Update: Omit<AiServiceWrite, "options"> & { options?: Json };
        Relationships: [];
      };
      ai_tool_permissions: Table<AiToolPermission, "tool">;
      ai_mcp_servers: {
        Row: AiMcpServer;
        Insert: AiMcpServerWrite & Pick<AiMcpServer, "name" | "url">;
        Update: AiMcpServerWrite;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      set_ai_service_key: { Args: { p_service_id: string; p_api_key: string | null }; Returns: undefined };
      set_ai_mcp_server_headers: { Args: { p_server_id: string; p_set: Json; p_remove: string[] }; Returns: string[] };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
