import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiDb } from "./conversations";
import { aiModelsKey } from "./models";
import { OPENAI_BASE_URL } from "./openai";
import { enabledAiProviders, getAiProvider, getAiProviders, type AiProvider, type AiSettings } from "./providers";
import type { AiService, AiServiceWrite } from "./types";

/**
 * The user's AI services (`ai_services`): APIs they added, each speaking one provider's protocol
 * with an address and key of its own, so one account can use OpenAI, Berget AI and a local Ollama
 * side by side. The key is written but never read back: `set_ai_service_key()` keeps it in
 * `ai_service_keys`, which only the AI edge functions read (server-side).
 */

export const aiServicesKey = ["gondol", "ai", "services"] as const;

const COLUMNS = "id,user_id,name,provider,base_url,has_api_key,enabled,position,created_at,updated_at";

/** The user's services, in their order. */
export function useAiServices() {
  return useQuery({
    queryKey: aiServicesKey,
    queryFn: async () => {
      const { data, error } = await aiDb().from("ai_services").select(COLUMNS).order("position").order("created_at");
      if (error) throw error;
      return (data ?? []) as AiService[];
    },
  });
}

/**
 * Adds a service (`id` absent) or changes one. `apiKey` is only sent when it changes: a string sets
 * it, null removes it, undefined leaves it as it is.
 */
export function useSaveAiService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, apiKey, ...values }: AiServiceWrite & { id?: string; apiKey?: string | null }): Promise<AiService> => {
      const query = id
        ? aiDb().from("ai_services").update(values).eq("id", id)
        : aiDb()
            .from("ai_services")
            .insert({ ...values, name: values.name ?? "", provider: values.provider ?? "openai" });
      const { data, error } = await query.select(COLUMNS).single();
      if (error) throw error;
      const service = data as AiService;
      if (apiKey !== undefined) {
        const { error: keyError } = await aiDb().rpc("set_ai_service_key", { p_service_id: service.id, p_api_key: apiKey?.trim() || null });
        if (keyError) throw keyError;
        return { ...service, has_api_key: !!apiKey?.trim() };
      }
      return service;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiServicesKey }),
  });
}

/** Deletes a service with the models kept for it; its conversations fall back to the settings. */
export function useDeleteAiService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await aiDb().from("ai_services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiServicesKey });
      void queryClient.invalidateQueries({ queryKey: aiModelsKey });
    },
  });
}

/** A ready-made service to start from in the service sheet. */
export interface AiServicePreset {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  /** Whether it needs a key to answer. */
  needsKey: boolean;
}

export const AI_SERVICE_PRESETS: AiServicePreset[] = [
  { id: "openai", name: "OpenAI", provider: "openai", baseUrl: OPENAI_BASE_URL, needsKey: true },
  { id: "berget", name: "Berget AI", provider: "openai", baseUrl: "https://api.berget.ai/v1", needsKey: true },
  { id: "ollama", name: "Ollama", provider: "ollama", baseUrl: "", needsKey: false },
  { id: "custom", name: "", provider: "openai", baseUrl: "", needsKey: false },
];

/**
 * Somewhere the chat can get answers from: one of the user's services, or a provider configured in
 * the app's settings (`service` null), as the `providers` setting switches them on.
 */
export interface AiSource {
  /** The service id, or the provider id for a provider's settings. */
  key: string;
  provider: AiProvider;
  service: AiService | null;
  name: string;
}

/** The key a model or conversation's provider and service make. */
export const aiSourceKey = (provider: string, serviceId: string | null | undefined) => serviceId || provider;

/** The enabled services whose provider is registered, then the providers the settings switch on. */
export function aiSources(settings: AiSettings, services: AiService[] | undefined): AiSource[] {
  const fromServices = (services ?? [])
    .filter((service) => service.enabled)
    .flatMap((service): AiSource[] => {
      const provider = getAiProvider(service.provider);
      return provider ? [{ key: service.id, provider, service, name: service.name || provider.name }] : [];
    });
  const fromSettings = enabledAiProviders(settings).map((provider): AiSource => ({ key: provider.id, provider, service: null, name: provider.name }));
  return [...fromServices, ...fromSettings];
}

/** The chat's sources: aiSources() with the user's services. */
export function useAiSources(settings: AiSettings): { sources: AiSource[]; isLoading: boolean } {
  const services = useAiServices();
  return { sources: aiSources(settings, services.data), isLoading: services.isLoading };
}

/** The providers a service can speak. */
export function serviceProviders(): AiProvider[] {
  return getAiProviders().filter((provider) => provider.supportsServices);
}
