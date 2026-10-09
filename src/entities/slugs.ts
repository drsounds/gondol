/**
 * Every row has, next to its uuid `id`:
 * - `identifier`: the id in base62 (22 characters for a uuid), kept in sync by the database;
 * - `slug`: the key the app uses in its URLs. It defaults to the identifier and can be changed to a
 *   readable lowercase kebab-case name (unique per owner, or per table for shared entities).
 *
 * Navigation always uses `entityKey(row)`; a route's key is matched back to a row with
 * `findByEntityKey`, which also accepts the identifier and the uuid, so old links keep opening the
 * right row (and `useSlugRedirect` swaps a uuid in the address for the slug).
 */

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** A uuid's base62 identifier, the same as the database's entity_identifier(). */
export function entityIdentifier(id: string): string {
  if (!isUuid(id)) return id;
  let n = BigInt(`0x${id.replace(/-/g, "")}`);
  let out = "";
  do {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  } while (n > 0n);
  return out.padStart(22, "0");
}

/** The uuid a 22-character base62 identifier encodes, or null if `value` isn't one. */
export function uuidFromIdentifier(value: string): string | null {
  if (!/^[0-9A-Za-z]{22}$/.test(value)) return null;
  let n = 0n;
  for (const ch of value) n = n * 62n + BigInt(BASE62.indexOf(ch));
  if (n >= 1n << 128n) return null;
  const hex = n.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type Keyed = { id: string; slug?: string | null; identifier?: string | null };

/** The key that addresses `row` in the app's URLs: its slug (the id if it wasn't loaded). */
export function entityKey(row: Keyed): string {
  return row.slug || row.id;
}

/** Whether a URL key (a slug, an identifier or an old uuid) points at `row`. */
export function matchesEntityKey(row: Keyed, key: string | null | undefined): boolean {
  if (!key) return false;
  return row.slug === key || row.id === key || (row.identifier ?? entityIdentifier(row.id)) === key;
}

/** The row a URL key points at, preferring a slug match over an identifier/uuid match. */
export function findByEntityKey<T extends Keyed>(rows: readonly T[] | null | undefined, key: string | null | undefined): T | undefined {
  if (!rows || !key) return undefined;
  return rows.find((row) => row.slug === key) ?? rows.find((row) => matchesEntityKey(row, key));
}

/**
 * The uuid of the row a URL key points at: looked up in `rows` when given, else read straight off
 * the key when it's a uuid or an identifier (rows whose slug is never customised, like channel
 * messages, are addressed by their identifier).
 */
export function idForEntityKey(rows: readonly Keyed[] | null | undefined, key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  return findByEntityKey(rows, key)?.id ?? (isUuid(key) ? key : (uuidFromIdentifier(key) ?? undefined));
}

/** Whether `slug` is still the default (the identifier) rather than one the user picked. */
export function isDefaultSlug(row: Keyed): boolean {
  return !row.slug || row.slug === (row.identifier ?? entityIdentifier(row.id));
}

/** Turns free text (a name) into a slug: lowercase kebab-case ASCII, at most 64 characters. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

/** Route words a slug can't take, since /x/new and /x/edit mean something else. */
const RESERVED_SLUGS = new Set(["new", "edit"]);

export type SlugProblem = "format" | "reserved";

/** Why a custom slug would be rejected by the database (an empty one means "use the default"). */
export function slugProblem(slug: string): SlugProblem | null {
  if (!slug) return null;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 64 || isUuid(slug)) return "format";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}
