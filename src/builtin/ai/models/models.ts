import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Json } from "../../../supabase/types";
import { useAppSettings } from "../../../settings/settings";
import { aiDb } from "./conversations";
import { getAiProvider, type AiProviderModel, type AiServiceRef, type AiSettings } from "./providers";
import { aiSourceKey, useAiSources, type AiSource } from "./services";
import type { AiModel } from "./types";

export const aiModelsKey = ["gondol", "ai", "models"] as const;

/** The ai app's settings in effect. */
export function useAiSettings(): { settings: AiSettings; isLoading: boolean } {
  const { values, isLoading } = useAppSettings("ai");
  return { settings: values, isLoading };
}

/** The models the user keeps (ai_models), by provider and name. */
export function useSavedAiModels() {
  return useQuery({
    queryKey: aiModelsKey,
    queryFn: async () => {
      const { data, error } = await aiDb().from("ai_models").select("*").order("provider").order("name");
      if (error) throw error;
      return (data ?? []) as unknown as AiModel[];
    },
  });
}

/**
 * What a provider serves right now (its live list), with the settings or through one of the
 * user's services; errors when it can't be reached.
 */
export function useProviderModels(providerId: string, settings: AiSettings, enabled = true, service?: (AiServiceRef & { has_api_key?: boolean; updated_at?: string }) | null) {
  const provider = getAiProvider(providerId);
  const address = provider?.describe?.(settings, service) ?? "";
  return useQuery({
    queryKey: ["gondol", "ai", "provider-models", providerId, service?.id ?? null, address, service ? (service.updated_at ?? null) : (settings[`${providerId}.apiKey`] ?? null)],
    enabled: enabled && !!provider,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => provider!.listModels(settings, signal, service),
  });
}

/** Keeps (or updates) a provider's (or a service's) model in ai_models, switched on or off. */
export function useSaveAiModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider, serviceId = null, model, enabled }: { provider: string; serviceId?: string | null; model: AiProviderModel; enabled: boolean }) => {
      const { error } = await aiDb()
        .from("ai_models")
        .upsert(
          { provider, service_id: serviceId, name: model.name, details: (model.details ?? null) as Json, enabled, updated_at: new Date().toISOString() },
          { onConflict: "user_id,provider,service_id,name" },
        );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiModelsKey }),
  });
}

export function useRemoveAiModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await aiDb().from("ai_models").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiModelsKey }),
  });
}

export interface AiModelChoice {
  provider: string;
  /** The service serving it, or null for the provider's settings. */
  serviceId: string | null;
  name: string;
  label: string;
  /** The service's (or provider's) name, for a picker with more than one source. */
  sourceName: string;
}

/**
 * The chat's model picker: the models the user keeps switched on, of the sources in use (their
 * services and the providers the settings switch on); with none kept, every model the first source
 * serves now. The default model (setting) and the conversation's own come along even when neither
 * list has them.
 */
export function useAiModelChoices(settings: AiSettings, current?: { provider: string; serviceId: string | null; model: string | null } | null) {
  const saved = useSavedAiModels();
  const { sources, isLoading: sourcesLoading } = useAiSources(settings);
  const first: AiSource | undefined = sources[0];
  const sourceKeys = sources.map((s) => s.key).join(",");
  const kept = useMemo(() => {
    const keys = sourceKeys.split(",");
    return (saved.data ?? []).filter((m) => m.enabled && keys.includes(aiSourceKey(m.provider, m.service_id)));
  }, [saved.data, sourceKeys]);
  const live = useProviderModels(first?.provider.id ?? "ollama", settings, saved.isSuccess && !sourcesLoading && kept.length === 0 && !!first, first?.service);
  const choices = useMemo(() => {
    const sourceName = (provider: string, serviceId: string | null) => sources.find((s) => s.key === aiSourceKey(provider, serviceId))?.name ?? getAiProvider(provider)?.name ?? provider;
    const list: AiModelChoice[] = kept.length
      ? kept.map((m) => ({ provider: m.provider, serviceId: m.service_id, name: m.name, label: m.label || m.name, sourceName: sourceName(m.provider, m.service_id) }))
      : first
        ? (live.data ?? []).map((m) => ({ provider: first.provider.id, serviceId: first.service?.id ?? null, name: m.name, label: m.name, sourceName: first.name }))
        : [];
    const add = (provider: string, serviceId: string | null, name: string | null | undefined) => {
      if (name && !list.some((c) => c.provider === provider && c.serviceId === serviceId && c.name === name)) list.push({ provider, serviceId, name, label: name, sourceName: sourceName(provider, serviceId) });
    };
    const defaultModel = typeof settings.defaultModel === "string" ? settings.defaultModel.trim() : null;
    if (first && defaultModel && !list.some((c) => c.name === defaultModel)) add(first.provider.id, first.service?.id ?? null, defaultModel);
    if (current) add(current.provider, current.serviceId, current.model);
    return list;
  }, [kept, live.data, first, sources, settings.defaultModel, current]);
  return { choices, sources, isLoading: saved.isLoading || sourcesLoading || live.isLoading, error: live.error as Error | null };
}
