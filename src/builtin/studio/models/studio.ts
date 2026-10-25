import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "../../../supabase/client";
import { useSession } from "../../../supabase/useSession";
import { entityKey } from "../../../entities/slugs";
import { toEntityUri } from "../../../entities/uri";
import type { Json } from "../../../supabase/types";
import type { LiteApp, LiteAppTree, LiteEntityType, LiteField, LitePage, LiteRecord, LiteRelation, StudioDatabase } from "./types";

/** The shared client, typed with the studio's tables. */
export const studioDb = () => getSupabaseClient<StudioDatabase>();

export const studioKey = ["gondol", "studio"] as const;
export const liteAppsKey = [...studioKey, "apps"] as const;
export const liteRecordsKey = (appId: string | null) => [...studioKey, "records", appId ?? ""] as const;

const APP_COLUMNS = "id, user_id, identifier, slug, name, description, icon_name, hue, in_menu, menu_order, instructions, builder_uri, created_at, updated_at, soft_deleted_at";

function byMenuOrder(a: LiteApp, b: LiteApp) {
  return (a.menu_order ?? Number.MAX_SAFE_INTEGER) - (b.menu_order ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
}

/** Every app the user has built, with its pages, entity types and relations (in their order). */
export async function fetchLiteApps(): Promise<LiteAppTree[]> {
  const db = studioDb();
  const [apps, pages, types, relations] = await Promise.all([
    db.from("lite_apps").select(APP_COLUMNS).is("soft_deleted_at", null),
    db.from("lite_app_pages").select("*").order("position").order("created_at"),
    db.from("lite_entity_types").select("*").order("position").order("created_at"),
    db.from("lite_entity_relations").select("*").order("created_at"),
  ]);
  for (const result of [apps, pages, types, relations]) if (result.error) throw result.error;
  const pagesOf = new Map<string, LitePage[]>();
  for (const page of (pages.data ?? []) as LitePage[]) pagesOf.set(page.app_id, [...(pagesOf.get(page.app_id) ?? []), page]);
  const typesOf = new Map<string, LiteEntityType[]>();
  for (const type of (types.data ?? []) as LiteEntityType[]) {
    const fields = Array.isArray(type.fields) ? type.fields : [];
    typesOf.set(type.app_id, [...(typesOf.get(type.app_id) ?? []), { ...type, fields }]);
  }
  const relationsOf = new Map<string, LiteRelation[]>();
  for (const relation of (relations.data ?? []) as LiteRelation[]) relationsOf.set(relation.app_id, [...(relationsOf.get(relation.app_id) ?? []), relation]);
  return ((apps.data ?? []) as LiteApp[]).sort(byMenuOrder).map((app) => ({
    ...app,
    pages: pagesOf.get(app.id) ?? [],
    types: typesOf.get(app.id) ?? [],
    relations: relationsOf.get(app.id) ?? [],
  }));
}

export function useLiteApps() {
  const { session } = useSession();
  return useQuery({ queryKey: [...liteAppsKey, session?.user.id ?? ""], enabled: !!session, queryFn: fetchLiteApps, staleTime: 30_000 });
}

/** An app by the key in a URL (slug, identifier or uuid). */
export function findLiteApp(apps: readonly LiteAppTree[], key: string): LiteAppTree | undefined {
  return apps.find((app) => app.slug === key || app.identifier === key || app.id === key);
}

/** An app's records, newest first. */
export function useLiteRecords(appId: string | null) {
  return useQuery({
    queryKey: liteRecordsKey(appId),
    enabled: !!appId,
    queryFn: async () => {
      const { data, error } = await studioDb()
        .from("lite_records")
        .select("id, user_id, identifier, slug, app_id, type_id, title, data, created_at, updated_at, soft_deleted_at")
        .eq("app_id", appId!)
        .is("soft_deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as LiteRecord[];
    },
  });
}

/** Where a page lives: `/lite/<app>/<page>`. */
export function litePagePath(app: Pick<LiteApp, "slug" | "identifier">, page: Pick<LitePage, "key">): string {
  return `/lite/${app.slug || app.identifier}/${page.key}`;
}

/** The app's first page (its own first, else any), where opening the app goes. */
export function firstLitePage(app: LiteAppTree): LitePage | undefined {
  return app.pages.find((page) => page.in_menu) ?? app.pages[0];
}

export const recordUri = (record: Pick<LiteRecord, "id">) => toEntityUri("lite_record", record.id);
export const appUri = (app: Pick<LiteApp, "id">) => toEntityUri("lite_app", app.id);

/** A field's label: its own, else its key in words. */
export function fieldLabel(field: LiteField): string {
  if (field.label?.trim()) return field.label.trim();
  const words = field.key.replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A record as a page's data model sees it: its fields, plus id, key, uri and title. */
export function recordData(record: LiteRecord): Record<string, unknown> {
  return { ...record.data, id: record.id, key: entityKey(record), uri: recordUri(record), title: record.title, created_at: record.created_at };
}

/**
 * What every page's data model starts with: `/app`, `/page`, `/types` (each type's name and fields)
 * and `/records/<type key>` (its records, newest first).
 */
export function pageDataModel(app: LiteAppTree, page: LitePage | null, records: readonly LiteRecord[]): Record<string, unknown> {
  const byType: Record<string, unknown[]> = {};
  const typeKey = new Map(app.types.map((type) => [type.id, type.key]));
  for (const type of app.types) byType[type.key] = [];
  for (const record of records) {
    const key = typeKey.get(record.type_id);
    if (key) byType[key].push(recordData(record));
  }
  return {
    app: { id: app.id, name: app.name, slug: app.slug, description: app.description ?? "" },
    page: page ? { key: page.key, title: page.title } : null,
    types: Object.fromEntries(app.types.map((type) => [type.key, { name: type.name, plural: type.plural_name ?? type.name, fields: type.fields }])),
    records: byType,
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The type keys a page's `RecordList`s (A2UI or Open-JSON-UI) list; they have a New button of their own. */
function recordListTypes(document: unknown): Set<string> {
  const keys = new Set<string>();
  const literal = (value: unknown) =>
    typeof value === "string" ? value : value && typeof value === "object" && typeof (value as { literalString?: unknown }).literalString === "string" ? (value as { literalString: string }).literalString : undefined;
  const typeOf = (props: unknown) => (props && typeof props === "object" ? literal((props as Record<string, unknown>).type ?? (props as Record<string, unknown>).entityType) : undefined);
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    const found = [typeOf(object.RecordList), typeOf(object.EntityList), object.type === "RecordList" || object.type === "EntityList" ? typeOf(object.props) : undefined];
    for (const key of found) if (key) keys.add(key);
    Object.values(object).forEach(visit);
  };
  visit(document);
  return keys;
}

/**
 * The types a page offers a "New …" button for in its header: those it shows (`/records/<key>`
 * bindings, a quoted key in a component or action) or, when it names none, all of the app's,
 * leaving out types a `RecordList` on the page already lists with its own button.
 */
export function pageCreateTypes(app: LiteAppTree, page: LitePage): LiteEntityType[] {
  const text = typeof page.document === "string" ? page.document : JSON.stringify(page.document ?? null);
  const listed = recordListTypes(page.document);
  const shown = app.types.filter((type) => new RegExp(`(/records/|\\\\?["'])${escapeRegExp(type.key)}(\\\\?["'/]|$)`).test(text));
  return (shown.length ? shown : app.types).filter((type) => !listed.has(type.key) && !listed.has(type.id) && !listed.has(type.name));
}

/** A form's values as a record's data: numbers, booleans and lists as the fields say. */
export function coerceRecordValues(type: LiteEntityType, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const field of type.fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    if (value === "" || value === null) {
      out[field.key] = null;
      continue;
    }
    switch (field.type) {
      case "number":
      case "integer": {
        const n = Number(value);
        out[field.key] = Number.isFinite(n) ? (field.type === "integer" ? Math.trunc(n) : n) : null;
        break;
      }
      case "boolean":
        out[field.key] = value === true || value === "true" || value === "on" || value === 1;
        break;
      case "multiselect":
        out[field.key] = Array.isArray(value) ? value.map(String) : String(value).split(",").map((v) => v.trim()).filter(Boolean);
        break;
      default:
        out[field.key] = typeof value === "string" ? value : String(value);
    }
  }
  return out;
}

/** The required fields a record is missing. */
export function missingFields(type: LiteEntityType, data: Record<string, unknown>): LiteField[] {
  return type.fields.filter((field) => {
    if (!field.required) return false;
    const value = data[field.key];
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return (appId?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: liteAppsKey });
    if (appId !== undefined) void queryClient.invalidateQueries({ queryKey: liteRecordsKey(appId) });
  };
}

export type LiteAppValues = Pick<LiteApp, "name" | "description" | "icon_name" | "hue" | "in_menu" | "menu_order" | "instructions" | "builder_uri">;

export function useSaveLiteApp() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, ...values }: LiteAppValues & { id?: string }): Promise<LiteApp> => {
      const query = id ? studioDb().from("lite_apps").update(values).eq("id", id) : studioDb().from("lite_apps").insert(values);
      const { data, error } = await query.select(APP_COLUMNS).single();
      if (error) throw error;
      return data as LiteApp;
    },
    onSuccess: () => invalidate(),
  });
}

/** Deletes an app (soft: it can be restored); its pages go from the menu with it. */
export function useDeleteLiteApp() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await studioDb().from("lite_apps").update({ soft_deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });
}

export type LitePageValues = Pick<LitePage, "app_id" | "key" | "title" | "icon_name" | "position" | "in_menu" | "format"> & { document: Json };

export function useSaveLitePage() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, ...values }: LitePageValues & { id?: string }) => {
      const query = id ? studioDb().from("lite_app_pages").update(values).eq("id", id) : studioDb().from("lite_app_pages").insert(values);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return data as LitePage;
    },
    onSuccess: () => invalidate(),
  });
}

/** Deletes a row of one of the studio's child tables (pages, entity types, relations). */
export function useDeleteLiteRow(table: "lite_app_pages" | "lite_entity_types" | "lite_entity_relations") {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id }: { id: string; appId: string }) => {
      const { error } = await studioDb().from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { appId }) => invalidate(table === "lite_entity_types" ? appId : undefined),
  });
}

export type LiteTypeValues = Pick<LiteEntityType, "app_id" | "key" | "name" | "plural_name" | "icon_name" | "fields" | "title_field" | "position">;

export function useSaveLiteType() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, ...values }: LiteTypeValues & { id?: string }) => {
      const query = id ? studioDb().from("lite_entity_types").update(values).eq("id", id) : studioDb().from("lite_entity_types").insert(values);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return data as LiteEntityType;
    },
    onSuccess: (_data, values) => invalidate(values.app_id),
  });
}

export type LiteRelationValues = Pick<LiteRelation, "app_id" | "key" | "label" | "from_type_id" | "to_type_id" | "to_entity_type" | "kind">;

export function useSaveLiteRelation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, ...values }: LiteRelationValues & { id?: string }) => {
      const query = id ? studioDb().from("lite_entity_relations").update(values).eq("id", id) : studioDb().from("lite_entity_relations").insert(values);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return data as LiteRelation;
    },
    onSuccess: () => invalidate(),
  });
}

export function useSaveLiteRecord() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, app_id, type_id, data }: { id?: string; app_id: string; type_id: string; data: Record<string, unknown> }) => {
      const query = id
        ? studioDb().from("lite_records").update({ data }).eq("id", id)
        : studioDb().from("lite_records").insert({ app_id, type_id, data });
      const { data: row, error } = await query.select("id, user_id, identifier, slug, app_id, type_id, title, data, created_at, updated_at, soft_deleted_at").single();
      if (error) throw error;
      return row as LiteRecord;
    },
    onSuccess: (_row, values) => invalidate(values.app_id),
  });
}

export function useDeleteLiteRecord() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id }: { id: string; appId: string }) => {
      const { error } = await studioDb().from("lite_records").update({ soft_deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { appId }) => invalidate(appId),
  });
}

/** A key from a name: `My plants` → `my-plants` (`_` for field keys). */
export function keyFromName(name: string, separator: "-" | "_" = "-"): string {
  const key = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "")
    .slice(0, 40);
  return /^[a-z]/.test(key) ? key : key ? `x${separator}${key}`.slice(0, 40) : "";
}
