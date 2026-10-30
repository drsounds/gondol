import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./db";
import { mediaHost, type EntityCovers } from "../../../media/host";
import { sessionUserId } from "../../../supabase/session";
import { isUuid } from "../../../entities/slugs";
import { isEntityUri, parseEntityUri, toEntityUri } from "../../../entities/uri";
import { canonicalEntityUri } from "../../../entities/lookup";

/**
 * Playlists (ported from gantt-resume-pro): ordered, customisable collections of anything in
 * the app (any entity, by its entity URI) and of web links (https://). A playlist's title and
 * description live on the row; its header image and image are its covers (header_image and
 * square_cover_image of <scheme>:playlist:<id>, picked from the host's media library: mediaHostHook).
 */

export interface Playlist {
  id: string;
  /** Used in its URL (/playlists/<slug>); unique across all users' playlists. */
  slug: string;
  identifier?: string;
  user_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
}

export interface PlaylistItem {
  id: string;
  /** Used in its sheet's URL (/playlists/<playlist>/items/<slug>/edit). */
  slug?: string;
  identifier?: string;
  playlist_id: string;
  /** A entity URI (any entity type) or an http(s) link. */
  uri: string;
  /** Optional display title; links fall back to their page title, entities to their name. */
  title: string | null;
  position: number;
  /** When it was added; kept when an undo or a cut and paste puts it back. */
  added_at: string;
  /** A date the user set to show (and sort by) instead of `added_at` (YYYY-MM-DD). */
  custom_added_on: string | null;
}

const ITEM_COLUMNS = "id, slug, identifier, playlist_id, uri, title, position, added_at, custom_added_on";

/** The date an item shows as added: its custom date, else the day it was added (YYYY-MM-DD, local). */
export function playlistItemAddedOn(item: Pick<PlaylistItem, "added_at" | "custom_added_on">): string {
  if (item.custom_added_on) return item.custom_added_on;
  const at = new Date(item.added_at);
  if (Number.isNaN(at.getTime())) return item.added_at.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** An absolute http(s) URL, the only kind of link a playlist takes. */
export function isWebLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Whether `value` can go in a playlist: a well-formed entity URI or a web link. */
export function isPlaylistItemUri(value: string): boolean {
  const trimmed = value.trim();
  if (isEntityUri(trimmed)) return parseEntityUri(trimmed) !== null;
  return isWebLink(trimmed);
}

/** The stored form of a entity URI (entity <type>:<id>); links are kept as typed. */
export function normalizePlaylistItemUri(value: string): string {
  const trimmed = value.trim();
  const parsed = isEntityUri(trimmed) ? parseEntityUri(trimmed) : null;
  return parsed ? toEntityUri(parsed.entityType, parsed.entityId) : trimmed;
}

export const playlistItemUri = (item: Pick<PlaylistItem, "uri">) => item.uri;

export const playlistsQueryOptions = {
  queryKey: ["playlists"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("playlists")
      .select("*")
      .eq("user_id", await sessionUserId())
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Playlist[];
  },
};

export const playlistItemsQueryOptions = {
  queryKey: ["playlist_items"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("playlist_items")
      .select(ITEM_COLUMNS)
      .eq("user_id", await sessionUserId())
      .order("position")
      .order("created_at");
    if (error) throw error;
    return (data ?? []) as PlaylistItem[];
  },
};

/** A playlist (any readable one, e.g. another user's public playlist) by its slug, identifier or id. */
export function playlistByKeyQueryOptions(key: string) {
  return {
    queryKey: ["playlists", "by-key", key],
    queryFn: async () => {
      const query = supabase.from("playlists").select("*");
      const found = await (isUuid(key)
        ? query.eq("id", key)
        : /^[A-Za-z0-9-]+$/.test(key)
          ? query.or(`slug.eq.${key},identifier.eq.${key}`)
          : query.eq("slug", key)
      )
        .limit(1)
        .maybeSingle();
      if (found.error) throw found.error;
      const playlist = found.data as Playlist | null;
      if (!playlist) return { playlist: null, items: [] as PlaylistItem[] };
      const items = await supabase.from("playlist_items").select(ITEM_COLUMNS).eq("playlist_id", playlist.id).order("position").order("created_at");
      if (items.error) throw items.error;
      return { playlist, items: (items.data ?? []) as PlaylistItem[] };
    },
  };
}

/**
 * A playlist's header image and image. The owner's come from their covers (so edits show at once);
 * anyone else's public playlist goes through playlist_covers(), since covers are private.
 */
export function usePlaylistCovers(playlist: Pick<Playlist, "id"> | undefined, own: boolean): EntityCovers {
  const media = mediaHost();
  const ownCovers = media.useEntityCovers(playlist && own ? toEntityUri("playlist", playlist.id) : null);
  const shared = useQuery({
    queryKey: ["playlist-covers", playlist?.id],
    enabled: !!playlist && !own,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("playlist_covers", { p_playlist_id: playlist!.id });
      if (error) throw error;
      const covers: EntityCovers = {};
      for (const row of data ?? []) {
        covers[row.slot as "header_image" | "square_cover_image"] = {
          mediaId: row.media_id,
          name: row.name,
          src: media.mediaSrc({ source: row.source, provider: row.provider, url: row.url, storage_path: row.storage_path }),
        };
      }
      return covers;
    },
  });
  return own ? ownCovers : (shared.data ?? {});
}

/**
 * Appends an entity (entity URI) or a web link to the end of a playlist (or at `position`,
 * shifting the rest down).
 */
export function useAddToPlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ playlistId, uri, title, position }: { playlistId: string; uri: string; title?: string; position?: number }) => {
      if (!isPlaylistItemUri(uri)) throw new Error("Not an entity URI or a web link");
      const all = await queryClient.fetchQuery(playlistItemsQueryOptions);
      const items = all.filter((i) => i.playlist_id === playlistId);
      const at = position === undefined ? items.length : Math.max(0, Math.min(position, items.length));
      const { data, error } = await supabase
        .from("playlist_items")
        .insert({
          user_id: await sessionUserId(),
          playlist_id: playlistId,
          uri: isEntityUri(uri) ? await canonicalEntityUri(uri) : normalizePlaylistItemUri(uri),
          title: title?.trim() || null,
          position: at,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (at < items.length) {
        const ordered = [...items.slice(0, at).map((i) => i.id), data.id, ...items.slice(at).map((i) => i.id)];
        await writePositions(ordered);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["playlist_items"] }),
  });
}

/** Changes an item's display title (empty resets it to the entity's name / the link's title). */
export function useRenamePlaylistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { error } = await supabase
        .from("playlist_items")
        .update({ title: title.trim() || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["playlist_items"] }),
  });
}

/** Persists a new order for a playlist's items (the ids in their new order). */
export function useReorderPlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: writePositions,
    onMutate: async (orderedIds: string[]) => {
      // Optimistic, so a drag-and-drop reorder doesn't snap back while the writes land.
      await queryClient.cancelQueries({ queryKey: ["playlist_items"] });
      queryClient.setQueryData<PlaylistItem[]>(["playlist_items"], (prev) =>
        prev
          ?.map((i) => (orderedIds.includes(i.id) ? { ...i, position: orderedIds.indexOf(i.id) } : i))
          .sort((a, b) => a.position - b.position),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["playlist_items"] }),
  });
}

export async function writePositions(orderedIds: string[]) {
  const results = await Promise.all(orderedIds.map((id, position) => supabase.from("playlist_items").update({ position }).eq("id", id)));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}
