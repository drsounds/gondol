import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../../supabase/client";
import { openAiTools, parseToolArguments } from "./openai";
import { AiProviderError, type AiChatMessage, type AiProvider, type AiSettings, type AiToolCall } from "./provider";

/**
 * Ollama (https://ollama.com), reached through a Supabase edge function rather than from the
 * browser: the function calls Ollama's HTTP API (`GET /api/tags` for the models pulled, `POST
 * /api/chat` for an answer) server-side for the signed-in user and streams the answer back as
 * server-sent events, one Ollama JSON chunk per event. So the address (the `ollama.baseUrl`
 * setting, or the function's OLLAMA_BASE_URL when it's empty) has to be reachable from the server,
 * and no CORS setup is needed on Ollama. The function's contract is in docs/guide/ai.md; Spacify's
 * is `supabase/functions/ai-ollama`.
 */

let functionName = "ai-ollama";

/** Names the edge function that calls Ollama (default `ai-ollama`). Call it before anything renders. */
export function configureOllama(options: { functionName?: string }): void {
  if (options.functionName) functionName = options.functionName;
}

/** The address the settings name, or "" for the server's default. */
export function ollamaBaseUrl(settings: AiSettings): string {
  const value = typeof settings["ollama.baseUrl"] === "string" ? settings["ollama.baseUrl"].trim() : "";
  return value.replace(/\/+$/, "");
}

type ErrorKind = "config" | "forbidden" | "unreachable" | "http" | "invalid";

/** The function's answer, or an AiProviderError with what it said went wrong. */
async function invoke(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(functionName, { body, signal });
  if (!error) return data;
  if (signal?.aborted) throw new AiProviderError("Stopped", "aborted");
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    let message = `The AI service answered ${response.status}`;
    let kind: ErrorKind = "http";
    try {
      const payload = (await response.json()) as { error?: string; kind?: ErrorKind };
      if (payload?.error) message = payload.error;
      if (payload?.kind) kind = payload.kind;
    } catch {
      // not JSON
    }
    throw new AiProviderError(message, kind, response.status);
  }
  throw new AiProviderError(`Couldn't reach the AI service (${error instanceof Error ? error.message : String(error)})`, "unreachable");
}

interface OllamaTag {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  details?: Record<string, unknown>;
}

interface OllamaToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

interface OllamaChunk {
  message?: { role?: string; content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
}

function option(settings: AiSettings, key: string): number | undefined {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Messages in /api/chat's shape: tool calls carry their arguments as objects, results the tool's name. */
export function ollamaMessages(messages: AiChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", content: message.content, ...(message.toolName ? { tool_name: message.toolName } : {}) };
    if (message.toolCalls?.length) {
      return { role: "assistant", content: message.content, tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.arguments } })) };
    }
    return { role: message.role, content: message.content };
  });
}

export const ollamaProvider: AiProvider = {
  id: "ollama",
  name: "Ollama",
  addressSetting: "ollama.baseUrl",
  supportsTools: true,
  describe: (settings) => ollamaBaseUrl(settings),

  async listModels(settings, signal) {
    const data = (await invoke({ action: "models", baseUrl: ollamaBaseUrl(settings) || undefined }, signal)) as { models?: OllamaTag[] } | null;
    return (data?.models ?? [])
      .map((tag) => ({
        name: tag.name || tag.model || "",
        size: tag.size,
        modifiedAt: tag.modified_at,
        details: tag.details,
      }))
      .filter((m) => m.name);
  },

  async chat(settings, { model, messages, temperature, signal, onToken, tools }) {
    const options: Record<string, number> = {};
    if (temperature !== undefined) options.temperature = temperature;
    const numCtx = option(settings, "ollama.numCtx");
    if (numCtx !== undefined) options.num_ctx = numCtx;
    const keepAlive = typeof settings["ollama.keepAlive"] === "string" && settings["ollama.keepAlive"].trim() ? settings["ollama.keepAlive"].trim() : undefined;
    const response = await invoke(
      {
        action: "chat",
        baseUrl: ollamaBaseUrl(settings) || undefined,
        model,
        messages: ollamaMessages(messages),
        ...(tools?.length ? { tools: openAiTools(tools) } : {}),
        ...(Object.keys(options).length ? { options } : {}),
        ...(keepAlive ? { keep_alive: /^-?\d+$/.test(keepAlive) ? Number(keepAlive) : keepAlive } : {}),
      },
      signal,
    );
    // A text/event-stream answer comes back as the Response itself.
    if (!(response instanceof Response) || !response.body) throw new AiProviderError("The AI service sent no answer", "invalid");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let last: OllamaChunk | null = null;
    const toolCalls: AiToolCall[] = [];
    const handle = (event: string) => {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) return;
      let chunk: OllamaChunk;
      try {
        chunk = JSON.parse(data) as OllamaChunk;
      } catch {
        return;
      }
      if (chunk.error) throw new AiProviderError(chunk.error, "http");
      for (const call of chunk.message?.tool_calls ?? []) {
        if (!call.function?.name) continue;
        toolCalls.push({ id: call.id || `call_${toolCalls.length}`, name: call.function.name, arguments: parseToolArguments(call.function.arguments) });
      }
      const piece = chunk.message?.content ?? "";
      if (piece) {
        content += piece;
        onToken(piece);
      }
      if (chunk.done) last = chunk;
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        events.forEach(handle);
      }
      handle(buffer + decoder.decode());
    } catch (error) {
      if (signal?.aborted) throw Object.assign(new AiProviderError("Stopped", "aborted"), { partial: content });
      throw error;
    }

    const done = last as OllamaChunk | null;
    const evalSeconds = done?.eval_duration ? done.eval_duration / 1e9 : undefined;
    return {
      content,
      ...(toolCalls.length ? { toolCalls } : {}),
      metrics: done
        ? {
            promptTokens: done.prompt_eval_count,
            completionTokens: done.eval_count,
            durationMs: done.total_duration ? Math.round(done.total_duration / 1e6) : undefined,
            tokensPerSecond: evalSeconds && done.eval_count ? Math.round((done.eval_count / evalSeconds) * 10) / 10 : undefined,
          }
        : undefined,
    };
  },
};
