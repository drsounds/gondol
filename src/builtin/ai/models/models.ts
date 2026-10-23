import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Json } from "../../../supabase/types";
import { useAppSettings } from "../../../settings/settings";
import { aiDb } from "./conversations";
import { enabledAiProviders, getAiProvider, type AiProviderModel, type AiSettings } from "./providers";
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

/** What a provider serves right now (its live list); errors when it can't be reached. */
export function useProviderModels(providerId: string, settings: AiSettings, enabled = true) {
  const provider = getAiProvider(providerId);
  const address = provider?.describe?.(settings) ?? "";
  return useQuery({
    queryKey: ["gondol", "ai", "provider-models", providerId, address, settings[`${providerId}.apiKey`] ?? null],
    enabled: enabled && !!provider,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => provider!.listModels(settings, signal),
  });
}

/** Keeps (or updates) a provider's model in ai_models, switched on or off. */
export function useSaveAiModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider, model, enabled }: { provider: string; model: AiProviderModel; enabled: boolean }) => {
      const { error } = await aiDb()
        .from("ai_models")
        .upsert(
          { provider, name: model.name, details: (model.details ?? null) as Json, enabled, updated_at: new Date().toISOString() },
          { onConflict: "user_id,provider,name" },
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
  name: string;
  label: string;
}

/**
 * The chat's model picker: the models the user keeps switched on, of providers in use; with none
 * kept, every model the first provider in use serves now. The default model (setting) and the
 * conversation's own come along even when neither list has them.
 */
export function useAiModelChoices(settings: AiSettings, current?: { provider: string; model: string | null } | null) {
  const saved = useSavedAiModels();
  const providerIds = enabledAiProviders(settings).map((p) => p.id).join(",");
  const first = providerIds.split(",")[0] || "ollama";
  const kept = useMemo(
    () => (saved.data ?? []).filter((m) => m.enabled && providerIds.split(",").includes(m.provider)),
    [saved.data, providerIds],
  );
  const live = useProviderModels(first, settings, saved.isSuccess && kept.length === 0);
  const choices = useMemo(() => {
    const list: AiModelChoice[] = kept.length
      ? kept.map((m) => ({ provider: m.provider, name: m.name, label: m.label || m.name }))
      : (live.data ?? []).map((m) => ({ provider: first, name: m.name, label: m.name }));
    const add = (provider: string, name: string | null | undefined) => {
      if (name && !list.some((c) => c.provider === provider && c.name === name)) list.push({ provider, name, label: name });
    };
    add(first, typeof settings.defaultModel === "string" ? settings.defaultModel.trim() : null);
    if (current) add(current.provider, current.model);
    return list;
  }, [kept, live.data, first, settings.defaultModel, current]);
  return { choices, isLoading: saved.isLoading || live.isLoading, error: live.error as Error | null };
}
