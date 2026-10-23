import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { defineHook, resolutionsOf } from "../../../apps/contributions";
import { canonicalEntityUri } from "../../../entities/lookup";
import { toEntityUri, type EntityType } from "../../../entities/uri";
import { getSupabaseClient } from "../../../supabase/client";
import { sessionUserId } from "../../../supabase/session";
import type { Stream, StreamEntry, StreamSource, StreamsDatabase } from "./types";

/** The shared client, typed with the streams app's tables. */
export const streamsDb = () => getSupabaseClient<StreamsDatabase>();

export const streamsKey = ["streams"] as const;
export const streamEntriesKey = ["stream_entries"] as const;

/** An account an entry can be booked against, as the host names it. */
export type StreamAccount = { id: string; label: string; active?: boolean };

/** A query the host runs for the streams app. */
export type HostQuery<T> = { queryKey: readonly unknown[]; queryFn: () => Promise<T> };

/**
 * What the host app can tell the streams app, by answering `streamsHostHook` in
 * `configureGondol({ resolutions })`. Both are optional: without `accounts` entries have no account
 * pickers, without `contextDurations` a stream's position shows on its own.
 */
export type StreamsHost = {
  /** The bookkeeping accounts an entry's yin and yang can be booked against. */
  accounts?: HostQuery<StreamAccount[]>;
  /** How long a context entity takes, in seconds by URI (a task's estimate). */
  contextDurations?: HostQuery<Record<string, number>>;
};

export const streamsHostHook = defineHook<StreamsHost>("streams.host");

/** Every answer to `streamsHostHook`, merged (later answers win). */
export function streamsHost(): StreamsHost {
  return Object.assign({}, ...resolutionsOf(streamsHostHook).map((a) => a.value)) as StreamsHost;
}

const noAccounts: HostQuery<StreamAccount[]> = { queryKey: ["streams", "no-accounts"], queryFn: async () => [] };
const noDurations: HostQuery<Record<string, number>> = { queryKey: ["streams", "no-durations"], queryFn: async () => ({}) };

/** The host's accounts (empty when it has none). */
export function useStreamAccounts() {
  const query = streamsHost().accounts;
  return { ...useQuery({ ...(query ?? noAccounts), enabled: !!query }), available: !!query };
}

/** The host's context durations by URI (empty when it has none). */
export function useContextDurations() {
  const query = streamsHost().contextDurations;
  return useQuery({ ...(query ?? noDurations), enabled: !!query });
}

/** The user's streams, newest first. */
export function useStreams() {
  return useQuery({
    queryKey: streamsKey,
    queryFn: async () => {
      const userId = await sessionUserId();
      const { data, error } = await streamsDb().from("streams").select("*").eq("user_id", userId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((s) => ({ ...s, quantity: Number(s.quantity ?? 1) })) as Stream[];
    },
  });
}

/** Every entry of the user's streams. */
export function useStreamEntries() {
  return useQuery({
    queryKey: streamEntriesKey,
    queryFn: async () => {
      const userId = await sessionUserId();
      const { data, error } = await streamsDb().from("stream_entries").select("*").eq("user_id", userId).order("created_at");
      if (error) throw error;
      return (data ?? []).map((e) => ({ ...e, yin: Number(e.yin), yang: Number(e.yang) })) as StreamEntry[];
    },
  });
}

export const sumEntries = (entries: StreamEntry[], key: "yin" | "yang") => entries.reduce((s, e) => s + (e[key] || 0), 0);

/** 1:02:03 or 2:03. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A timestamp as a `datetime-local` value in the browser's time zone (empty for none). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value as an ISO timestamp (null for empty). */
export function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface StreamDraft {
  action: string;
  context_uri: string;
  object_uri: string;
  motivation_uri: string;
  description: string;
  source: StreamSource;
  /** datetime-local values. */
  start_date: string;
  end_date: string;
  quantity: string;
}

/** Saves a stream (insert without `id`). The subject is always the signed-in user. */
export function useSaveStream() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }: { id?: string; draft: StreamDraft }) => {
      const userId = await sessionUserId();
      const contextUri = draft.context_uri.trim() ? await canonicalEntityUri(draft.context_uri) : null;
      const quantity = Number(draft.quantity);
      const payload = {
        action: draft.action.trim(),
        subject_uri: toEntityUri("user" as EntityType, userId),
        context_uri: contextUri,
        object_uri: draft.object_uri.trim() ? await canonicalEntityUri(draft.object_uri) : contextUri,
        motivation_uri: draft.motivation_uri.trim() ? await canonicalEntityUri(draft.motivation_uri) : null,
        description: draft.description.trim() || null,
        source: draft.source,
        start_date: fromLocalInput(draft.start_date) ?? new Date().toISOString(),
        end_date: fromLocalInput(draft.end_date),
        quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 1,
      };
      if (id) {
        const { error } = await streamsDb().from("streams").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await streamsDb().from("streams").insert({ user_id: userId, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: streamsKey }),
  });
}

export function useDeleteStream() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await streamsDb().from("streams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: streamsKey });
      queryClient.invalidateQueries({ queryKey: streamEntriesKey });
    },
  });
}

export interface EntryDraft {
  object_uri: string;
  yin: string;
  yang: string;
  yin_account_id: string;
  yang_account_id: string;
  description: string;
}

/** Saves an entry of `streamId` (insert without `id`). */
export function useSaveStreamEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, streamId, draft }: { id?: string; streamId: string; draft: EntryDraft }) => {
      const payload = {
        object_uri: draft.object_uri.trim() ? await canonicalEntityUri(draft.object_uri) : null,
        yin: Math.max(0, Number(draft.yin) || 0),
        yang: Math.max(0, Number(draft.yang) || 0),
        yin_account_id: draft.yin_account_id || null,
        yang_account_id: draft.yang_account_id || null,
        description: draft.description.trim() || null,
      };
      if (id) {
        const { error } = await streamsDb().from("stream_entries").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const userId = await sessionUserId();
        const { error } = await streamsDb().from("stream_entries").insert({ user_id: userId, stream_id: streamId, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: streamEntriesKey }),
  });
}

export function useDeleteStreamEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await streamsDb().from("stream_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: streamEntriesKey }),
  });
}
