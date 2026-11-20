/** Pure list helpers behind a playlist's ordering, undo and redo (items are anything with an id). */

type WithId = { id: string };

/**
 * `to`, plus the items that are in the list now but in neither `from` nor `to` (added since by
 * something other than the step being undone or redone), which stay, at the end.
 */
export function settle<T extends WithId>(now: T[], from: T[], to: T[]): T[] {
  const known = new Set([...from, ...to].map((i) => i.id));
  return [...to, ...now.filter((i) => !known.has(i.id))];
}

/**
 * The whole list after the shown part of it (`shown`, the items a site doesn't hide) became
 * `nextShown`: hidden items keep their places, the shown ones fill the other places in their new
 * order, and any extra ones go at the end.
 */
export function placeShown<T extends WithId>(all: T[], shown: T[], nextShown: T[]): T[] {
  const shownIds = new Set(shown.map((i) => i.id));
  const queue = [...nextShown];
  const result: T[] = [];
  for (const item of all) {
    if (!shownIds.has(item.id)) result.push(item);
    else {
      const next = queue.shift();
      if (next) result.push(next);
    }
  }
  return [...result, ...queue];
}

/** Moves the `chosen` items one place up (-1) or down (1); touching ones move as a block, and stop at the ends. */
export function moveBlock<T extends WithId>(list: T[], chosen: ReadonlySet<string>, direction: 1 | -1): T[] {
  const next = [...list];
  const indexes = next.map((_, i) => i);
  for (const i of direction < 0 ? indexes : indexes.reverse()) {
    const j = i + direction;
    if (j < 0 || j >= next.length) continue;
    // A chosen item swaps with an unchosen neighbour; one at an end (and those touching it) stays put.
    if (chosen.has(next[i].id) && !chosen.has(next[j].id)) [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

