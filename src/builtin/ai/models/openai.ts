import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../../supabase/client";
import { AiProviderError, type AiChatMessage, type AiProvider, type AiSettings, type AiTool, type AiToolCall } from "./provider";

let functionName = "ai-openai";

/** Names the edge function that calls an OpenAI-compatible API (default `ai-openai`). */
export function configureOpenAi(options: { functionName?: string }): void {
  if (options.functionName) functionName = options.functionName;
}

/** The configured API address, defaulting to the OpenAI API's versioned base URL. */
export function openAiBaseUrl(settings: AiSettings): string {
  const value = typeof settings["openai.baseUrl"] === "string" ? settings["openai.baseUrl"].trim() : "";
  const baseUrl = value || "https://api.openai.com/v1";
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  return baseUrl.slice(0, end);
}

type ErrorKind = "config" | "forbidden" | "unreachable" | "http" | "invalid";

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

interface OpenAiModel {
  id?: string;
  owned_by?: string;
}

interface OpenAiToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChunk {
  choices?: { delta?: { content?: string; tool_calls?: OpenAiToolCallDelta[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: string | { message?: string };
}

/** Messages in the chat completions shape, tool calls and results included. */
export function openAiMessages(messages: AiChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId ?? "", content: message.content };
    if (message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

export function openAiTools(tools: AiTool[]): Record<string, unknown>[] {
  return tools.map((tool) => ({ type: "function", function: { name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.parameters } }));
}

/** Parses a tool call's JSON arguments; anything but an object becomes {}. */
export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const openAiProvider: AiProvider = {
  id: "openai",
  name: "OpenAI-compatible API",
  addressSetting: "openai.baseUrl",
  supportsTools: true,
  describe: (settings) => openAiBaseUrl(settings),

  async listModels(settings, signal) {
    const data = (await invoke({ action: "models", baseUrl: openAiBaseUrl(settings) }, signal)) as { data?: OpenAiModel[] } | null;
    if (!data || !Array.isArray(data.data)) throw new AiProviderError("The AI API sent an invalid models response", "invalid");
    return data.data
      .filter((model): model is OpenAiModel & { id: string } => !!model && typeof model.id === "string" && !!model.id)
      .map((model) => ({
        name: model.id,
        ...(typeof model.owned_by === "string" ? { details: { owned_by: model.owned_by } } : {}),
      }));
  },

  async chat(settings, { model, messages, temperature, signal, onToken, tools }) {
    const startedAt = Date.now();
    const response = await invoke(
      {
        action: "chat",
        baseUrl: openAiBaseUrl(settings),
        model,
        messages: openAiMessages(messages),
        ...(tools?.length ? { tools: openAiTools(tools) } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      },
      signal,
    );
    if (!(response instanceof Response) || !response.body) throw new AiProviderError("The AI API sent no answer", "invalid");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage: OpenAiChunk["usage"];
    // Tool calls stream in pieces, by index: the id and name first, the arguments in parts.
    const calls: { id: string; name: string; arguments: string }[] = [];
    const handle = (event: string) => {
      const data = event
        .replace(/\r/g, "")
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      let chunk: OpenAiChunk;
      try {
        chunk = JSON.parse(data) as OpenAiChunk;
      } catch {
        throw new AiProviderError("The AI API sent an invalid chat response", "invalid");
      }
      if (!chunk || typeof chunk !== "object") throw new AiProviderError("The AI API sent an invalid chat response", "invalid");
      if (chunk.error) {
        const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
        throw new AiProviderError(message || "The AI API returned an error", "http");
      }
      usage = chunk.usage ?? usage;
      for (const delta of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
        const index = typeof delta.index === "number" ? delta.index : calls.length;
        const call = (calls[index] ??= { id: "", name: "", arguments: "" });
        if (delta.id) call.id = delta.id;
        if (delta.function?.name) call.name += delta.function.name;
        if (delta.function?.arguments) call.arguments += delta.function.arguments;
      }
      const piece = chunk.choices?.[0]?.delta?.content;
      if (typeof piece === "string" && piece) {
        content += piece;
        onToken(piece);
      }
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        events.forEach(handle);
      }
      buffer += decoder.decode();
      if (buffer) handle(buffer);
    } catch (error) {
      try {
        await reader.cancel(error);
      } catch {
        // The response stream may already be closed or aborted.
      }
      if (signal?.aborted) throw Object.assign(new AiProviderError("Stopped", "aborted"), { partial: content });
      throw error;
    } finally {
      reader.releaseLock();
    }

    const durationMs = Date.now() - startedAt;
    const completionTokens = usage?.completion_tokens;
    const toolCalls: AiToolCall[] = calls
      .filter((call) => call && call.name)
      .map((call, index) => ({ id: call.id || `call_${index}`, name: call.name, arguments: parseToolArguments(call.arguments) }));
    return {
      content,
      ...(toolCalls.length ? { toolCalls } : {}),
      metrics: {
        promptTokens: usage?.prompt_tokens,
        completionTokens,
        durationMs,
        tokensPerSecond: completionTokens && durationMs ? Math.round((completionTokens / (durationMs / 1000)) * 10) / 10 : undefined,
      },
    };
  },
};
