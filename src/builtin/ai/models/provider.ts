import type { AppSettingValue } from "../../../settings/schema";
import type { AiMetrics, AiRole, AiService } from "./types";

/**
 * What an LLM provider is (see ./providers.ts for the registry): it lists the models it serves and
 * streams a chat answer, reading its configuration (an API address, a key) from the ai app's
 * settings, which it is handed on every call, or from one of the user's services (ai_services,
 * `service`), which name an address of their own and keep their key on the server.
 */

/** What a provider needs of a service: which one (the server reads its key) and its address. */
export type AiServiceRef = Pick<AiService, "id" | "base_url"> & Partial<Pick<AiService, "options">>;

/** The ai app's settings in effect (useAppSettings("ai").values). */
export type AiSettings = Record<string, AppSettingValue | undefined>;

export interface AiChatMessage {
  /** `tool`: what a tool the model called answered. */
  role: AiRole | "tool";
  content: string;
  /** The tools an assistant message asked to call. */
  toolCalls?: AiToolCall[];
  /** For a `tool` message: the call it answers, and the tool's name. */
  toolCallId?: string;
  toolName?: string;
}

/** A tool the model may call (an app's MCP tool), with a JSON Schema for its arguments. */
export interface AiTool {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

/** A call of a tool the model asked for. */
export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A model as its provider describes it. */
export interface AiProviderModel {
  /** The id requests name it by. */
  name: string;
  /** Bytes on disk, when the provider says. */
  size?: number;
  modifiedAt?: string;
  /** Family, parameter size, quantization, … */
  details?: Record<string, unknown>;
}

export interface AiChatRequest {
  model: string;
  messages: AiChatMessage[];
  /** Sampling temperature; undefined leaves the model's own. */
  temperature?: number;
  signal?: AbortSignal;
  /** Called with each piece of the answer as it streams in. */
  onToken: (text: string) => void;
  /** Tools the model may call (only sent to providers with `supportsTools`). */
  tools?: AiTool[];
  /** The service to ask instead of the provider's settings. */
  service?: AiServiceRef | null;
  /**
   * For providers that run their own agent loop (`runsTools`): runs one of `tools` the agent called
   * (asking the user first when the settings say so) and resolves with what to tell the agent.
   */
  runTool?: (call: AiToolCall) => Promise<string>;
  /** What an agent is doing now (planning, a step of its own, a sub-agent), for the chat to show. */
  onStatus?: (status: string) => void;
  /** The app asking (default `ai`), whose AI credits the answer uses. */
  app?: string;
}

export interface AiChatResult {
  content: string;
  metrics?: AiMetrics;
  /** The tools the model wants called before it answers; the chat runs them and asks again. */
  toolCalls?: AiToolCall[];
}

export interface AiProvider {
  /** Stable id, stored on conversations and models (and an option of the `providers` setting). */
  id: string;
  name: string;
  /** The settings key holding its address, shown when it can't be reached. */
  addressSetting?: string;
  /** Its address with the settings in effect (or the service's), for messages. */
  describe?: (settings: AiSettings, service?: AiServiceRef | null) => string;
  /** Whether it can hand the model tools (function calling). */
  supportsTools?: boolean;
  /**
   * Whether it runs the tool loop itself (an agent on the server): it calls `runTool` for the apps'
   * tools while it works and never hands back `toolCalls`.
   */
  runsTools?: boolean;
  /** Whether it can be added as a service (an address and key of its own, in ai_services). */
  supportsServices?: boolean;
  /** The address a new service of it starts with, as a placeholder. */
  defaultBaseUrl?: string;
  listModels: (settings: AiSettings, signal?: AbortSignal, service?: AiServiceRef | null) => Promise<AiProviderModel[]>;
  chat: (settings: AiSettings, request: AiChatRequest) => Promise<AiChatResult>;
}

/**
 * A provider failed: `unreachable` (nothing answered), `http` (it answered with an error), `config`
 * (no address), `forbidden` (the server won't call that address), `invalid` or `aborted`.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    /** `credits`: the account is out of AI credits for this (docs/guide/ai.md "Credits"). */
    readonly kind: "unreachable" | "http" | "aborted" | "invalid" | "config" | "forbidden" | "credits",
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
