import { useSyncExternalStore } from "react";

/** A conversation with an agent, as the intercom keeps it. */
export interface IntercomConversation {
  conversationId: string;
  agentId: string;
}

/**
 * The intercom's chat bubbles on this device: the conversations it keeps (newest first), the one
 * whose popup is open, where each bubble was dropped (`side` of the screen and `y` from the top),
 * and when each was last read. Kept in localStorage; a convenience per device, never data.
 */
export interface IntercomState {
  heads: IntercomConversation[];
  open: string | null;
  positions: Record<string, { side: "left" | "right"; y: number }>;
  seen: Record<string, string>;
}

const STORAGE_KEY = "agent-intercom";
/** The most bubbles kept; the oldest go first. */
export const MAX_HEADS = 5;

const EMPTY: IntercomState = { heads: [], open: null, positions: {}, seen: {} };

function read(): IntercomState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<IntercomState>) : {};
    return {
      heads: Array.isArray(parsed.heads) ? parsed.heads.filter((h) => h && typeof h.conversationId === "string" && typeof h.agentId === "string").slice(0, MAX_HEADS) : [],
      open: typeof parsed.open === "string" ? parsed.open : null,
      positions: parsed.positions && typeof parsed.positions === "object" ? parsed.positions : {},
      seen: parsed.seen && typeof parsed.seen === "object" ? parsed.seen : {},
    };
  } catch {
    return EMPTY;
  }
}

let state: IntercomState | null = null;
const listeners = new Set<() => void>();

function current(): IntercomState {
  if (state === null) state = typeof window === "undefined" ? EMPTY : read();
  return state;
}

/** Changes the intercom's state (and remembers it on this device). */
export function updateIntercom(change: (previous: IntercomState) => IntercomState): void {
  state = change(current());
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked (private mode etc.): the bubbles just won't survive a reload.
  }
  for (const listener of listeners) listener();
}

export function useIntercomState(): IntercomState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current,
    () => EMPTY,
  );
}

/** Keeps a conversation as a bubble (first), optionally opening its popup. */
export function addIntercomHead(conversation: IntercomConversation, open = false): void {
  updateIntercom((s) => ({
    ...s,
    heads: [conversation, ...s.heads.filter((h) => h.conversationId !== conversation.conversationId)].slice(0, MAX_HEADS),
    open: open ? conversation.conversationId : s.open,
  }));
}

/** Throws a bubble away (and closes its popup). */
export function removeIntercomHead(conversationId: string): void {
  updateIntercom((s) => {
    const positions = { ...s.positions };
    delete positions[conversationId];
    return { ...s, heads: s.heads.filter((h) => h.conversationId !== conversationId), open: s.open === conversationId ? null : s.open, positions };
  });
}

// ---- The conversation on screen ---------------------------------------------------------------

let visible: IntercomConversation | null = null;
const visibleListeners = new Set<() => void>();

/**
 * Says which conversation the Agents page shows (null when none): its bubble hides meanwhile, and
 * leaving it turns it into a bubble.
 */
export function setVisibleAgentConversation(conversation: IntercomConversation | null): void {
  if (visible?.conversationId === conversation?.conversationId) return;
  visible = conversation;
  for (const listener of visibleListeners) listener();
}

export function useVisibleAgentConversation(): IntercomConversation | null {
  return useSyncExternalStore(
    (listener) => {
      visibleListeners.add(listener);
      return () => visibleListeners.delete(listener);
    },
    () => visible,
    () => null,
  );
}
