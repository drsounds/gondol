import type { PlaylistItem } from "./playlists";

/**
 * Playlist items on the clipboard. The system clipboard gets their URIs, one per line (entity URIs
 * for entities, the address for links), so they paste anywhere; what was copied is also kept here,
 * so pasting the same text back into a playlist keeps the items' own titles and, after a cut, their
 * ids and added dates (a cut and paste is a move).
 */
interface Copied {
  text: string;
  items: PlaylistItem[];
  /** The playlist they were cut from, while that cut hasn't been pasted yet. */
  cutFrom: string | null;
}

let copied: Copied | null = null;

/** Remembers `items` as copied (or cut from `cutFrom`) and returns the text for the system clipboard. */
export function rememberCopied(items: PlaylistItem[], cutFrom: string | null = null): string {
  const text = items.map((i) => i.uri).join("\n");
  copied = { text, items, cutFrom };
  return text;
}

/** What was copied from a playlist, when `text` is what that copy put on the clipboard. */
export function recallCopied(text: string): { items: PlaylistItem[]; cutFrom: string | null } | null {
  if (!copied || text.trim() !== copied.text.trim()) return null;
  const found = { items: copied.items, cutFrom: copied.cutFrom };
  // Only the first paste after a cut is the move; later ones are copies.
  copied = { ...copied, cutFrom: null };
  return found;
}

/** The candidate URIs in pasted text: one per line or whitespace-separated word. */
export function pastedTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((s) => s.trim().replace(/^<(.*)>$/, "$1"))
    .filter(Boolean);
}
