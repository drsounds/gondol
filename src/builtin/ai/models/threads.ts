/**
 * Threads in a conversation: a message's replies have its id as `parent_id`, and a reply can have
 * replies of its own, to any depth. The conversation's own line is the messages without a parent.
 * Shared by the AI chat and anything else that keeps messages this way (the agents' threads).
 */
export interface ThreadedMessage {
  id: string;
  parent_id?: string | null;
  created_at: string;
  soft_deleted_at?: string | null;
}

/** Each message's replies (`null`: the conversation's own line), oldest first. */
export function repliesByParent<T extends ThreadedMessage>(messages: readonly T[]): Map<string | null, T[]> {
  const out = new Map<string | null, T[]>();
  for (const message of messages) {
    const key = message.parent_id ?? null;
    const list = out.get(key);
    if (list) list.push(message);
    else out.set(key, [message]);
  }
  for (const list of out.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return out;
}

/** How many replies a message has, all the way down (deleted ones too: their replies still show). */
export function replyCounts<T extends ThreadedMessage>(messages: readonly T[]): Map<string, number> {
  const byParent = repliesByParent(messages);
  const counts = new Map<string, number>();
  const count = (id: string, seen: Set<string>): number => {
    if (counts.has(id)) return counts.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const replies = byParent.get(id) ?? [];
    const total = replies.reduce((sum, reply) => sum + 1 + count(reply.id, seen), 0);
    counts.set(id, total);
    return total;
  };
  for (const message of messages) count(message.id, new Set());
  return counts;
}

/** The messages a thread sits under, from the conversation's line down to `id`'s parent. */
export function threadAncestors<T extends ThreadedMessage>(messages: readonly T[], id: string): T[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const out: T[] = [];
  const seen = new Set<string>();
  let parent = byId.get(id)?.parent_id ?? null;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const message = byId.get(parent);
    if (!message) break;
    out.unshift(message);
    parent = message.parent_id ?? null;
  }
  return out;
}

/**
 * What someone answering in the thread under `parentId` (null: the conversation's line) has read:
 * the way there (every level up to and including the message the thread hangs on) and the thread
 * so far, oldest first, without deleted messages. `before` stops just before that message of the
 * thread (writing it again), `through` just after it (answering it again).
 */
export function threadContext<T extends ThreadedMessage>(
  messages: readonly T[],
  parentId: string | null,
  options: { before?: string | null; through?: string | null } = {},
): T[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const byParent = repliesByParent(messages);
  const level = (parent: string | null, cut?: { id: string; inclusive: boolean }) => {
    const own = byParent.get(parent) ?? [];
    if (!cut) return own;
    const at = own.findIndex((m) => m.id === cut.id);
    return at < 0 ? own : own.slice(0, cut.inclusive ? at + 1 : at);
  };
  const seen = new Set<string>();
  const walk = (parent: string | null, cut?: { id: string; inclusive: boolean }): T[] => {
    if (parent === null || seen.has(parent)) return level(null, cut);
    seen.add(parent);
    const message = byId.get(parent);
    const above = message ? walk(message.parent_id ?? null, { id: message.id, inclusive: true }) : [];
    return [...above, ...level(parent, cut)];
  };
  const cut = options.before ? { id: options.before, inclusive: false } : options.through ? { id: options.through, inclusive: true } : undefined;
  return walk(parentId, cut).filter((m) => !m.soft_deleted_at);
}
