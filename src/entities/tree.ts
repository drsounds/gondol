/** Anything that nests under another row of the same kind via `parent_id`. */
export interface TreeNode {
  id: string;
  parent_id: string | null;
}

/** Rows in tree order (each parent followed by its children), with their nesting depth. */
export function flattenTree<T extends TreeNode>(rows: T[]): { node: T; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<string | null, T[]>();
  for (const r of rows) {
    // A parent that no longer exists (or isn't loaded) makes the row a root.
    const parent = r.parent_id && ids.has(r.parent_id) ? r.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), r]);
  }
  const out: { node: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const r of children.get(parent) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ node: r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything left is part of a cycle; list it at the root rather than dropping it.
  for (const r of rows) if (!seen.has(r.id)) out.push({ node: r, depth: 0 });
  return out;
}

/** The row and all its descendants, at any depth. */
export function withDescendants<T extends TreeNode>(rows: T[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) {
      if (r.parent_id && result.has(r.parent_id) && !result.has(r.id)) {
        result.add(r.id);
        grew = true;
      }
    }
  }
  return result;
}

/** The row's ancestors, root first (not including the row itself). */
export function ancestorsOf<T extends TreeNode>(rows: T[], parentId: string | null): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  const seen = new Set<string>();
  let current = parentId ? byId.get(parentId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return out;
}

/** Indented label for an <option>, so children read as nested. */
export const indentedName = (name: string, depth: number) => `${"   ".repeat(depth)}${depth > 0 ? "↳ " : ""}${name}`;
