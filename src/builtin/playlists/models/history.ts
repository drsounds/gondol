import { useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "./db";
import { sessionUserId } from "../../../supabase/session";
import { playlistItemsQueryOptions, type PlaylistItem } from "./playlists";
import { settle } from "./itemOrder";

/**
 * Undo and redo for a playlist's items. Every change made in the playlist's view (adding, removing,
 * moving, cutting, pasting, retitling, re-dating) is a step from one ordered list of the playlist's
 * items to another; undo writes the list back as it was, redo as it became. Items keep their ids and
 * `added_at` through both, so an item that comes back is the same item, added when it first was.
 * The history lasts for the page's life, per playlist; writes run one at a time, in order.
 */

interface Step {
  label: string;
  before: PlaylistItem[];
  after: PlaylistItem[];
}

interface History {
  undo: Step[];
  redo: Step[];
  /** The writes queued so far: each waits for the one before it. */
  queue: Promise<void>;
  pending: number;
}

const LIMIT = 100;
const histories = new Map<string, History>();
const listeners = new Set<() => void>();
let version = 0;

function historyOf(playlistId: string): History {
  let history = histories.get(playlistId);
  if (!history) {
    history = { undo: [], redo: [], queue: Promise.resolve(), pending: 0 };
    histories.set(playlistId, history);
  }
  return history;
}

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The playlist's items as the view has them now (with every change so far applied), in order. */
function currentItems(queryClient: QueryClient, playlistId: string): PlaylistItem[] {
  return (queryClient.getQueryData<PlaylistItem[]>(playlistItemsQueryOptions.queryKey) ?? [])
    .filter((i) => i.playlist_id === playlistId)
    .sort((a, b) => a.position - b.position);
}

/** Writes the difference between `current` and `target` (the playlist's whole list, in order). */
export async function writePlaylistItems(playlistId: string, current: PlaylistItem[], target: PlaylistItem[]) {
  const before = new Map(current.map((i) => [i.id, i]));
  const after = new Set(target.map((i) => i.id));
  const removed = current.filter((i) => !after.has(i.id)).map((i) => i.id);
  if (removed.length > 0) {
    const { error } = await supabase.from("playlist_items").delete().in("id", removed);
    if (error) throw error;
  }
  const added = target.filter((i) => !before.has(i.id));
  if (added.length > 0) {
    const userId = await sessionUserId();
    const { error } = await supabase.from("playlist_items").insert(
      added.map((i) => ({
        id: i.id,
        user_id: userId,
        playlist_id: playlistId,
        uri: i.uri,
        title: i.title,
        position: target.indexOf(i),
        added_at: i.added_at,
        custom_added_on: i.custom_added_on,
      })),
    );
    if (error) throw error;
  }
  const updates = target.flatMap((item, position) => {
    const was = before.get(item.id);
    if (!was) return [];
    const patch: { position?: number; title?: string | null; custom_added_on?: string | null } = {};
    if (was.position !== position) patch.position = position;
    if (was.title !== item.title) patch.title = item.title;
    if (was.custom_added_on !== item.custom_added_on) patch.custom_added_on = item.custom_added_on;
    return Object.keys(patch).length > 0 ? [supabase.from("playlist_items").update(patch).eq("id", item.id)] : [];
  });
  const failed = (await Promise.all(updates)).find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/**
 * A playlist's undo history. `apply(target, label)` makes `target` (the playlist's whole list of
 * items, in order) the playlist's items, at once in the view and then in the database, as a step
 * that `undo()` and `redo()` walk back and forth.
 */
export function usePlaylistHistory(playlistId: string, { onError }: { onError?: (error: unknown) => void } = {}) {
  const queryClient = useQueryClient();
  useSyncExternalStore(subscribe, () => version, () => version);
  const history = historyOf(playlistId);

  /** Shows `target` at once, then queues its write after the ones before it. */
  function write(current: PlaylistItem[], target: PlaylistItem[]): Promise<void> {
    const positioned = target.map((item, position) => ({ ...item, playlist_id: playlistId, position }));
    void queryClient.cancelQueries({ queryKey: playlistItemsQueryOptions.queryKey });
    queryClient.setQueryData<PlaylistItem[]>(playlistItemsQueryOptions.queryKey, (prev) => [
      ...(prev ?? []).filter((i) => i.playlist_id !== playlistId),
      ...positioned,
    ]);
    history.pending += 1;
    const run = history.queue.then(() => writePlaylistItems(playlistId, current, positioned));
    history.queue = run.catch(() => {});
    return run
      .catch((error) => {
        onError?.(error);
        throw error;
      })
      .finally(() => {
        history.pending -= 1;
        // Refetch once the writes have landed, so the list never flickers back to a halfway state.
        if (history.pending === 0) void queryClient.invalidateQueries({ queryKey: playlistItemsQueryOptions.queryKey });
      });
  }

  function apply(target: PlaylistItem[], label: string): Promise<void> {
    const before = currentItems(queryClient, playlistId);
    const step = { label, before, after: target };
    history.undo = [...history.undo, step].slice(-LIMIT);
    history.redo = [];
    changed();
    return write(before, target).catch((error) => {
      history.undo = history.undo.filter((s) => s !== step);
      changed();
      throw error;
    });
  }

  /** Walks one step back (or forward, `redo`); resolves to the step's label, null when there's none. */
  async function travel(direction: "undo" | "redo"): Promise<string | null> {
    const step = history[direction].at(-1);
    if (!step) return null;
    const other = direction === "undo" ? "redo" : "undo";
    history[direction] = history[direction].slice(0, -1);
    history[other] = [...history[other], step];
    changed();
    const now = currentItems(queryClient, playlistId);
    const [from, to] = direction === "undo" ? [step.after, step.before] : [step.before, step.after];
    await write(now, settle(now, from, to));
    return step.label;
  }

  return {
    apply,
    undo: () => travel("undo"),
    redo: () => travel("redo"),
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    undoLabel: history.undo.at(-1)?.label ?? null,
    redoLabel: history.redo.at(-1)?.label ?? null,
  };
}
