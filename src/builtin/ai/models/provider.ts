import type { AppSettingValue } from "../../../settings/schema";
import type { AiMetrics, AiRole } from "./types";

/**
 * What an LLM provider is (see ./providers.ts for the registry): it lists the models it serves and
 * streams a chat answer, reading its configuration (an API address, a key) from the ai app's
 * settings, which it is handed on every call.
 */

/** The ai app's settings in effect (useAppSettings("ai").values). */
export type AiSettings = Record<string, AppSettingValue | undefined>;

export interface AiChatMessage {
  role: AiRole;
  content: string;
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
}

export interface AiChatResult {
  content: string;
  metrics?: AiMetrics;
}

export interface AiProvider {
  /** Stable id, stored on conversations and models (and an option of the `providers` setting). */
  id: string;
  name: string;
  /** The settings key holding its address, shown when it can't be reached. */
  addressSetting?: string;
  /** Its address with the settings in effect, for messages. */
  describe?: (settings: AiSettings) => string;
  listModels: (settings: AiSettings, signal?: AbortSignal) => Promise<AiProviderModel[]>;
  chat: (settings: AiSettings, request: AiChatRequest) => Promise<AiChatResult>;
}

/**
 * A provider failed: `unreachable` (nothing answered), `http` (it answered with an error), `config`
 * (no address), `forbidden` (the server won't call that address), `invalid` or `aborted`.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "http" | "aborted" | "invalid" | "config" | "forbidden",
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
