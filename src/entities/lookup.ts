import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase/client";
import { parseEntityUri, toEntityUri, type EntityType } from "./uri";
import type { MessageKey, Translate } from "../i18n/i18n";
import { sessionUserId } from "../supabase/session";
import { isUuid } from "./slugs";

/**
 * Where an entity type's rows live and how to name one, so anything that only holds an entity URI
 * (library items, playlist items, stream subjects/objects) can show a label.
 */
export type EntitySource = { table: string; columns: string; label: (row: Record<string, unknown>) => string | null };

let entitySources: Partial<Record<EntityType, EntitySource>> = {};

/** Registers where the app's entity types live (and so which types gondol's entity lookups know). */
export function registerEntitySources(sources: Partial<Record<EntityType, EntitySource>>): void {
  entitySources = { ...entitySources, ...sources };
}

function sourceOf(type: EntityType): EntitySource {
  return entitySources[type]!;
}

/** Every entity type with a registered source. */
export function entityTypes(): EntityType[] {
  return Object.keys(entitySources) as EntityType[];
}

/** The table rows of an entity type live in. */
export function entityTable(type: EntityType): string {
  return sourceOf(type).table;
}

export function isKnownEntityType(type: string): type is EntityType {
  return Object.hasOwn(entitySources, type);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

// Tables are picked at runtime from the registered sources, so the typed client's per-table overloads
// can't apply; the rows are only read through the `label` functions above.
type LooseQuery = {
  select: (columns: string) => {
    in: (column: string, values: string[]) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
    or: (filters: string) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
  };
};
const looseFrom = supabase.from.bind(supabase) as unknown as (table: string) => LooseQuery;

/**
 * The uuids of the rows of `type` that `keys` address. A key can be the uuid, the base62 identifier
 * or the slug (what "Copy URI" copies, see src/lib/shareUri.ts); uuids map to themselves. Slugs are
 * unique per owner, so when another user's (public or shared) row has the same slug, the user's
 * own row wins. Keys that match no readable row are absent from the map.
 */
export async function resolveEntityKeys(type: EntityType, keys: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const lookup: string[] = [];
  for (const key of keys) {
    if (isUuid(key)) resolved.set(key, key.toLowerCase());
    else if (/^[\w-]+$/.test(key)) lookup.push(key);
  }
  if (lookup.length === 0 || !isKnownEntityType(type)) return resolved;
  const list = [...new Set(lookup)].join(",");
  const { data, error } = await looseFrom(sourceOf(type).table)
    .select("id, slug, identifier, user_id")
    .or(`slug.in.(${list}),identifier.in.(${list})`);
  if (error || !data) return resolved;
  const me = await sessionUserId().catch(() => null);
  const rows = data as { id: string; slug: string | null; identifier: string | null; user_id: string | null }[];
  for (const key of lookup) {
    const matches = rows.filter((r) => r.slug === key || r.identifier === key);
    const row = matches.find((r) => r.user_id === me) ?? matches[0];
    if (row) resolved.set(key, row.id);
  }
  return resolved;
}

/** The row of `type` that `key` (a slug, identifier or uuid) addresses, with its label. */
export async function lookupEntity(type: EntityType, key: string): Promise<{ id: string; title: string; isOwn: boolean } | null> {
  if (!isKnownEntityType(type)) return null;
  const id = (await resolveEntityKeys(type, [key])).get(key);
  if (!id) return null;
  const source = sourceOf(type);
  const { data, error } = await looseFrom(source.table).select(`${source.columns}, user_id`).in("id", [id]);
  const row = (data as Record<string, unknown>[] | null)?.[0];
  const title = row ? source.label(row) : null;
  if (error || !row || !title) return null;
  const me = await sessionUserId().catch(() => null);
  return { id: String(row.id), title, isOwn: row.user_id === me };
}

export type EntityRef = { type: EntityType; id: string; key: string; title: string };

// For the entity view: whole rows, and rows filtered on a foreign key.
type LooseRowsQuery = {
  select: (columns: string) => {
    in: (column: string, values: string[]) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
    eq: (column: string, value: string) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> };
  };
};
const looseRows = supabase.from.bind(supabase) as unknown as (table: string) => LooseRowsQuery;

/** The URL key of a row: its slug, else its identifier, else its id. */
function rowKey(row: Record<string, unknown>): string {
  return str(row.slug) ?? str(row.identifier) ?? String(row.id);
}

/**
 * The whole row of `type` that `key` (a slug, identifier or uuid) addresses, with its title and URL
 * key, or null when there's no such readable row.
 */
export async function fetchEntityRow(type: EntityType, key: string): Promise<(EntityRef & { row: Record<string, unknown> }) | null> {
  if (!isKnownEntityType(type)) return null;
  const id = (await resolveEntityKeys(type, [key])).get(key);
  if (!id) return null;
  const { data, error } = await looseRows(sourceOf(type).table).select("*").in("id", [id]);
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (error || !row) return null;
  return { type, id, key: rowKey(row), title: sourceOf(type).label(row) ?? key, row };
}

/** Up to `limit` rows of `type` whose `column` holds `id` (e.g. a supplier's entries), labelled. */
export async function fetchEntitiesWhere(type: EntityType, column: string, id: string, limit = 24): Promise<EntityRef[]> {
  const source = sourceOf(type);
  const { data, error } = await looseRows(source.table).select(`${source.columns}, slug, identifier`).eq(column, id).limit(limit);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    type,
    id: String(row.id),
    key: rowKey(row),
    title: source.label(row) ?? rowKey(row),
  }));
}

/** Rows of `type` by id (e.g. the parents a row's foreign keys point at), labelled. */
export async function fetchEntitiesById(type: EntityType, ids: string[]): Promise<EntityRef[]> {
  if (ids.length === 0) return [];
  const source = sourceOf(type);
  const { data, error } = await looseRows(source.table).select(`${source.columns}, slug, identifier`).in("id", ids);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    type,
    id: String(row.id),
    key: rowKey(row),
    title: source.label(row) ?? rowKey(row),
  }));
}

/**
 * The stored form of a spacify: URI: spacify:<type>:<uuid>, since the library, playlists, tags and
 * covers key on the uuid. A URI addressing its row by slug or identifier is looked up; one that
 * can't be resolved (or isn't a spacify: URI) is returned as given.
 */
export async function canonicalEntityUri(uri: string): Promise<string> {
  const parsed = parseEntityUri(uri);
  if (!parsed || !isKnownEntityType(parsed.entityType)) return uri.trim();
  const id = (await resolveEntityKeys(parsed.entityType, [parsed.entityId])).get(parsed.entityId);
  return toEntityUri(parsed.entityType, id ?? parsed.entityId);
}

/**
 * Resolves the display label of every entity referenced by `uris` (keyed by the URI). URIs that
 * are malformed, of an unknown type or point at a deleted row are simply absent from the map.
 */
export function useEntityLabels(uris: string[]) {
  const unique = [...new Set(uris)].sort();
  return useQuery({
    queryKey: ["entity-labels", unique],
    enabled: unique.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const byType = new Map<EntityType, string[]>();
      for (const uri of unique) {
        const parsed = parseEntityUri(uri);
        if (!parsed || !isKnownEntityType(parsed.entityType) || !/^[\w-]+$/.test(parsed.entityId)) continue;
        byType.set(parsed.entityType, [...(byType.get(parsed.entityType) ?? []), parsed.entityId]);
      }
      const labels = new Map<string, string>();
      await Promise.all(
        [...byType].map(async ([type, ids]) => {
          const source = sourceOf(type);
          // URIs can address their row by slug or identifier too (copied with "Copy URI").
          const keys = await resolveEntityKeys(type, ids);
          const uuids = [...new Set(keys.values())];
          if (uuids.length === 0) return;
          const { data, error } = await looseFrom(source.table).select(source.columns).in("id", uuids);
          if (error || !data) return;
          const byId = new Map<string, string>();
          for (const row of data as Record<string, unknown>[]) {
            const label = source.label(row);
            if (label) byId.set(String(row.id).toLowerCase(), label);
          }
          for (const id of ids) {
            const label = byId.get(keys.get(id)?.toLowerCase() ?? "");
            if (label) labels.set(toEntityUri(type, id), label);
          }
        }),
      );
      return labels;
    },
  });
}

/** The label for `uri` from a useEntityLabels() result (normalises legacy/mixed-case URIs first). */
export function labelFor(labels: Map<string, string> | undefined, uri: string): string | undefined {
  const parsed = parseEntityUri(uri);
  if (!parsed || !labels) return undefined;
  return labels.get(toEntityUri(parsed.entityType, parsed.entityId));
}

/** The translated entity-type name for a spacify: URI (e.g. "Supplier"), or the URI itself. */
export function entityTypeLabel(t: Translate, uri: string) {
  const parsed = parseEntityUri(uri);
  return parsed && isKnownEntityType(parsed.entityType) ? t(`entity.${parsed.entityType}` as MessageKey) : uri;
}
