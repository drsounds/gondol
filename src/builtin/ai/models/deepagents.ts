import { ollamaBaseUrl, ollamaMessages } from "./ollama";
import { openAiBaseUrl, openAiTools, parseToolArguments } from "./openai";
import { AiProviderError, type AiProvider, type AiServiceRef, type AiSettings } from "./provider";
import { runAiSocket } from "./socket";

/**
 * LangChain Deep Agents (https://docs.langchain.com/oss/javascript/deepagents/overview): an agent
 * that plans (`write_todos`), keeps notes in a scratch file system of its own, hands parts of the
 * work to sub-agents and calls the apps' tools until it has an answer. It runs on the server, in the
 * `ai-deepagents` edge function (gondol's supabase/functions/ai-deepagents), on a chat model of an
 * Ollama or an OpenAI-compatible API (the `deepagents.backend` setting, with that provider's
 * address and key; or a service's `options.backend`, address and key).
 *
 * Everything goes over a WebSocket (./socket.ts), since an agent can work for minutes: the function
 * streams the answer as `token` events and what the agent is doing as `status`, and asks the browser
 * to run the apps' tools (`tool_call` → `tool_result`), so the chat's approval and the user's
 * own session still apply to every call.
 */

let functionName = "ai-deepagents";

/** Names the edge function that runs Deep Agents (default `ai-deepagents`). Call it before anything renders. */
export function configureDeepAgents(options: { functionName?: string }): void {
  if (options.functionName) functionName = options.functionName;
}

export type DeepAgentsBackend = "ollama" | "openai";

/** The API the agent's model runs on: the service's, else the `deepagents.backend` setting. */
export function deepAgentsBackend(settings: AiSettings, service?: AiServiceRef | null): DeepAgentsBackend {
  const chosen = service ? service.options?.backend : settings["deepagents.backend"];
  return chosen === "openai" ? "openai" : "ollama";
}

/** Where a request goes: the service (the function reads its address and key), else the backend's settings. */
function target(settings: AiSettings, service?: AiServiceRef | null): Record<string, unknown> {
  if (service) return { serviceId: service.id };
  const backend = deepAgentsBackend(settings);
  const baseUrl = backend === "openai" ? openAiBaseUrl(settings) : ollamaBaseUrl(settings);
  return { backend, ...(baseUrl ? { baseUrl } : {}) };
}

function option(settings: AiSettings, key: string): number | undefined {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

interface ModelEntry {
  name?: unknown;
  size?: unknown;
  modified_at?: unknown;
  details?: unknown;
}

export const deepAgentsProvider: AiProvider = {
  id: "deepagents",
  name: "LangChain Deep Agents",
  supportsTools: true,
  runsTools: true,
  supportsServices: true,
  describe: (settings, service) => {
    const backend = deepAgentsBackend(settings, service);
    const address = service ? (service.base_url ?? "").replace(/\/+$/, "") : backend === "openai" ? openAiBaseUrl(settings) : ollamaBaseUrl(settings);
    return `${backend === "openai" ? "OpenAI-compatible API" : "Ollama"}${address ? ` · ${address}` : ""}`;
  },

  async listModels(settings, signal, service) {
    const done = await runAiSocket(functionName, { action: "models", ...target(settings, service) }, { signal });
    const models = Array.isArray(done.models) ? (done.models as ModelEntry[]) : [];
    return models
      .filter((model) => typeof model?.name === "string" && model.name)
      .map((model) => ({
        name: model.name as string,
        ...(typeof model.size === "number" ? { size: model.size } : {}),
        ...(typeof model.modified_at === "string" ? { modifiedAt: model.modified_at } : {}),
        ...(model.details && typeof model.details === "object" ? { details: model.details as Record<string, unknown> } : {}),
      }));
  },

  async chat(settings, { model, messages, temperature, signal, onToken, tools, service, runTool, onStatus }) {
    const startedAt = Date.now();
    let content = "";
    const numCtx = option(settings, "ollama.numCtx");
    const maxSteps = option(settings, "deepagents.maxSteps");
    try {
      const done = await runAiSocket(
        functionName,
        {
          action: "chat",
          ...target(settings, service),
          model,
          messages: ollamaMessages(messages),
          ...(tools?.length && runTool ? { tools: openAiTools(tools) } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(numCtx !== undefined ? { numCtx } : {}),
          ...(maxSteps !== undefined ? { maxSteps } : {}),
        },
        {
          signal,
          onEvent: async (event, send) => {
            if (event.type === "token" && typeof event.text === "string") {
              content += event.text;
              onToken(event.text);
            } else if (event.type === "status" && typeof event.status === "string") {
              onStatus?.(event.status);
            } else if (event.type === "tool_call" && typeof event.id === "string" && typeof event.name === "string") {
              let result: string;
              let ok = true;
              try {
                result = runTool ? await runTool({ id: event.id, name: event.name, arguments: parseToolArguments(event.arguments) }) : `There is no tool named ${event.name}.`;
              } catch (error) {
                if (signal?.aborted) throw error;
                result = error instanceof Error ? error.message : String(error);
                ok = false;
              }
              send({ type: "tool_result", id: event.id, content: result, ok });
            }
          },
        },
      );
      const usage = (done.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
      const durationMs = Date.now() - startedAt;
      return {
        content: typeof done.content === "string" && !content ? done.content : content,
        metrics: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          durationMs,
          tokensPerSecond: usage.output_tokens && durationMs ? Math.round((usage.output_tokens / (durationMs / 1000)) * 10) / 10 : undefined,
        },
      };
    } catch (error) {
      if (signal?.aborted || (error instanceof AiProviderError && error.kind === "aborted")) {
        throw Object.assign(new AiProviderError("Stopped", "aborted"), { partial: content });
      }
      throw error;
    }
  },
};
