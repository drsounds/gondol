import { deepAgentsProvider } from "./deepagents";
import { ollamaProvider } from "./ollama";
import { openAiProvider } from "./openai";
import type { AiProvider, AiSettings } from "./provider";

export * from "./provider";

/**
 * LLM providers the ai app talks to. Ollama (./ollama.ts), OpenAI-compatible APIs (./openai.ts) and
 * LangChain Deep Agents (./deepagents.ts) are built in; register others with
 * `registerAiProvider()` before anything renders, and add their settings (and an option of the
 * `providers` setting) to the app's manifest.
 */
const providers = new Map<string, AiProvider>([
  [ollamaProvider.id, ollamaProvider],
  [openAiProvider.id, openAiProvider],
  [deepAgentsProvider.id, deepAgentsProvider],
]);

/** Adds (or replaces) a provider. */
export function registerAiProvider(provider: AiProvider): void {
  providers.set(provider.id, provider);
}

export function getAiProviders(): AiProvider[] {
  return [...providers.values()];
}

export function getAiProvider(id: string): AiProvider | undefined {
  return providers.get(id);
}

/** The providers the `providers` setting switches on (all registered ones when it's unset). */
export function enabledAiProviders(settings: AiSettings): AiProvider[] {
  const chosen = settings.providers;
  const all = getAiProviders();
  return Array.isArray(chosen) ? all.filter((p) => chosen.includes(p.id)) : all;
}
