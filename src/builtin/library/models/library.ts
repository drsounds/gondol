import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./db";
import type { EntityOption } from "../../../entities/EntityPicker";
import { canonicalEntityUri, isKnownEntityType, labelFor, useEntityLabels } from "../../../entities/lookup";
import { parseEntityUri } from "../../../entities/uri";
import { useSiteShows } from "../../../sites/sites";

/**
 * The user's library (saved and pinned entities), ported from gantt-resume-pro. It only holds
 * entity URIs (in the `spacify_uri` column); entities/lookup.ts turns them back into labels.
 * Playlists are an app of their own (builtin/playlists).
 */

export interface LibraryItem {
  id: string;
  spacify_uri: string;
  label: string | null;
  created_at: string;
}

export interface PinnedItem extends LibraryItem {
  position: number;
}

export const savedItemsQueryOptions = {
  queryKey: ["saved_items"],
  queryFn: async () => {
    const { data, error } = await supabase.from("saved_items").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as LibraryItem[];
  },
};

export const pinnedItemsQueryOptions = {
  queryKey: ["pinned_items"],
  queryFn: async () => {
    const { data, error } = await supabase.from("pinned_items").select("*").order("position").order("created_at");
    if (error) throw error;
    return (data ?? []) as PinnedItem[];
  },
};

import { sessionUserId } from "../../../supabase/session";
export { sessionUserId };

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

/** Save/unsave and pin/unpin an entity by its entity URI. */
export function useLibrary() {
  const queryClient = useQueryClient();
  const siteShows = useSiteShows();
  const savedQuery = useQuery(savedItemsQueryOptions);
  const pinnedQuery = useQuery(pinnedItemsQueryOptions);
  const allSaved = savedQuery.data ?? [];
  const allPinned = pinnedQuery.data ?? [];
  // Entities the site served here doesn't show (their type, app, roles or aspects) stay in the
  // library but aren't listed anywhere on this site.
  const saved = allSaved.filter((s) => siteShows.uri(s.spacify_uri));
  const pinned = allPinned.filter((p) => siteShows.uri(p.spacify_uri));

  const toggle = useMutation({
    mutationFn: async ({ table, uri, label, on }: { table: "saved_items" | "pinned_items"; uri: string; label?: string; on: boolean }) => {
      if (!on) {
        const { error } = await supabase.from(table).delete().eq("spacify_uri", uri);
        if (error) throw error;
        return;
      }
      const user_id = await currentUserId();
      // A dropped URI can address its row by slug or identifier; the library keys on the uuid.
      const row = { user_id, spacify_uri: await canonicalEntityUri(uri), label: label?.trim() || null };
      const { error } =
        table === "pinned_items"
          ? await supabase.from("pinned_items").upsert({ ...row, position: allPinned.length }, { onConflict: "user_id,spacify_uri" })
          : await supabase.from("saved_items").upsert(row, { onConflict: "user_id,spacify_uri" });
      if (error) throw error;
    },
    onSuccess: (_, { table }) => queryClient.invalidateQueries({ queryKey: [table] }),
  });

  return {
    saved,
    pinned,
    isLoading: savedQuery.isLoading || pinnedQuery.isLoading,
    isSaved: (uri: string) => allSaved.some((s) => s.spacify_uri === uri),
    isPinned: (uri: string) => allPinned.some((p) => p.spacify_uri === uri),
    setSaved: (uri: string, on: boolean, label?: string) => toggle.mutateAsync({ table: "saved_items", uri, label, on }),
    setPinned: (uri: string, on: boolean, label?: string) => toggle.mutateAsync({ table: "pinned_items", uri, label, on }),
  };
}

/**
 * The library's pinned and saved entities as <EntityPicker/> suggestions (pinned first), so a
 * picker can offer what the user keeps close before anything is typed.
 */
export function useLibraryPickerOptions(): EntityOption[] {
  const library = useLibrary();
  const items = [...library.pinned, ...library.saved.filter((s) => !library.isPinned(s.spacify_uri))];
  const { data: labels } = useEntityLabels(items.map((i) => i.spacify_uri));
  return items.flatMap((i) => {
    const parsed = parseEntityUri(i.spacify_uri);
    if (!parsed || !isKnownEntityType(parsed.entityType)) return [];
    return [{ type: parsed.entityType, id: parsed.entityId, title: labelFor(labels, i.spacify_uri) ?? i.label ?? i.spacify_uri }];
  });
}
