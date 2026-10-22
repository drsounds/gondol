import { AiProviderError, type AiProvider, type AiSettings } from "./provider";

/**
 * Ollama (https://ollama.com), over its HTTP API: `GET /api/tags` lists the models pulled, `POST
 * /api/chat` streams an answer as newline-delimited JSON. The browser calls it directly, so the
 * address (the `ollama.baseUrl` setting) has to be reachable from the device and Ollama has to
 * allow the page's origin: `OLLAMA_ORIGINS=https://app.example.com ollama serve`.
 */

export const OLLAMA_DEFAULT_URL = "http://localhost:11434";

export function ollamaBaseUrl(settings: AiSettings): string {
  const value = typeof settings["ollama.baseUrl"] === "string" ? settings["ollama.baseUrl"].trim() : "";
  return (value || OLLAMA_DEFAULT_URL).replace(/\/+$/, "");
}

function headers(settings: AiSettings): HeadersInit {
  const key = typeof settings["ollama.apiKey"] === "string" ? settings["ollama.apiKey"].trim() : "";
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

async function request(settings: AiSettings, path: string, init: RequestInit): Promise<Response> {
  const url = `${ollamaBaseUrl(settings)}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: headers(settings) });
  } catch (error) {
    if (init.signal?.aborted) throw new AiProviderError("Stopped", "aborted");
    throw new AiProviderError(`Couldn't reach Ollama at ${ollamaBaseUrl(settings)} (${error instanceof Error ? error.message : String(error)})`, "unreachable");
  }
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // not JSON
    }
    throw new AiProviderError(`Ollama answered ${response.status}: ${detail}`, "http", response.status);
  }
  return response;
}

interface OllamaTag {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  details?: Record<string, unknown>;
}

interface OllamaChunk {
  message?: { role?: string; content?: string };
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

export const ollamaProvider: AiProvider = {
  id: "ollama",
  name: "Ollama",
  addressSetting: "ollama.baseUrl",
  describe: ollamaBaseUrl,

  async listModels(settings, signal) {
    const response = await request(settings, "/api/tags", { method: "GET", signal });
    const body = (await response.json()) as { models?: OllamaTag[] };
    return (body.models ?? []).map((tag) => ({
      name: tag.name || tag.model || "",
      size: tag.size,
      modifiedAt: tag.modified_at,
      details: tag.details,
    })).filter((m) => m.name);
  },

  async chat(settings, { model, messages, temperature, signal, onToken }) {
    const options: Record<string, number> = {};
    if (temperature !== undefined) options.temperature = temperature;
    const numCtx = option(settings, "ollama.numCtx");
    if (numCtx !== undefined) options.num_ctx = numCtx;
    const keepAlive = typeof settings["ollama.keepAlive"] === "string" && settings["ollama.keepAlive"].trim() ? settings["ollama.keepAlive"].trim() : undefined;
    const response = await request(settings, "/api/chat", {
      method: "POST",
      signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(Object.keys(options).length ? { options } : {}),
        ...(keepAlive ? { keep_alive: /^-?\d+$/.test(keepAlive) ? Number(keepAlive) : keepAlive } : {}),
      }),
    });
    if (!response.body) throw new AiProviderError("Ollama sent no answer", "invalid");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let last: OllamaChunk | null = null;
    const handle = (line: string) => {
      if (!line.trim()) return;
      let chunk: OllamaChunk;
      try {
        chunk = JSON.parse(line) as OllamaChunk;
      } catch {
        return;
      }
      if (chunk.error) throw new AiProviderError(chunk.error, "http");
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
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(handle);
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
