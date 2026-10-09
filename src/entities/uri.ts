import type { EntityType } from "../register";

export type { EntityType };

/**
 * Entity URIs: `<scheme>:<entity_type>:<entity_pk>` (e.g. `spacify:supplier:acme`), the one way to
 * identify any entity across an app. Typing one into the search field, or posting a
 * `{ type: "navigate", uri }` message to the window (e.g. from a desktop shell), opens it.
 *
 * The scheme and every entity type's addresses are the app's: see `configureEntityUris()` and
 * `registerEntityRoutes()`.
 */
let scheme = "gondol";
let legacyNamespaces: string[] = [];

/** Sets the app's URI scheme (`spacify`), plus namespaces of old `<scheme>:<ns>:<type>:<id>` URIs still accepted. */
export function configureEntityUris(options: { scheme: string; legacyNamespaces?: string[] }): void {
  scheme = options.scheme.toLowerCase();
  legacyNamespaces = options.legacyNamespaces ?? [];
}

/** The app's URI scheme, without the colon. */
export function entityUriScheme(): string {
  return scheme;
}

export function toEntityUri(entityType: EntityType, entityIdOrSlug: string): string {
  return `${scheme}:${entityType}:${entityIdOrSlug}`;
}

export function isEntityUri(value: string): boolean {
  return value.trim().toLowerCase().startsWith(`${scheme}:`);
}

export function parseEntityUri(uri: string): { entityType: EntityType; entityId: string } | null {
  const parts = uri.trim().split(":");
  if (parts.length === 3 && parts[0].toLowerCase() === scheme && parts[2]) {
    return { entityType: parts[1].toLowerCase() as EntityType, entityId: parts[2] };
  }
  if (parts.length === 4 && parts[0].toLowerCase() === scheme && legacyNamespaces.includes(parts[1]) && parts[3]) {
    return { entityType: parts[2].toLowerCase() as EntityType, entityId: parts[3] };
  }
  return null;
}

/**
 * How an entity type is addressed. Every row has two public addresses, named after its type in
 * the singular: /<slug>/<key> views it and /<slug>/<key>/edit opens its edit sheet (the key is the
 * row's slug, see ./slugs.ts). Inside the app those are rewritten (see `entityPathRewrite`) to
 * where the views actually live, so the panels keep reading their own paths:
 *
 * - `view`: the row's own page when it has one; otherwise the generic entity view at
 *   /entity/<type>/<key>.
 * - `edit`: the list's edit sub-route.
 *
 * Old plural addresses (/suppliers/<key>/edit, /suppliers/<key>, …) keep working and show up in the
 * address bar as the singular ones. A `slug` of null means the type has no singular address.
 */
export type EntityRoute = { slug: string | null; view?: (key: string) => string; edit?: (key: string) => string };

/** An edit sub-route under a list: sheet("/suppliers") -> /suppliers/<key>/edit. */
export const sheet = (base: string) => (key: string) => `${base}/${key}/edit`;

let entityRoutes: Partial<Record<EntityType, EntityRoute>> = {};
/**
 * Static path segments under the lists' paths, which are never a row's key (/tasks/boards,
 * /calendar/events, …).
 */
let staticPaths = new Set<string>();
let compiled: CompiledRoutes | null = null;

/** Registers the app's entity types' addresses, and the static sub-routes that share a path with keys. */
export function registerEntityRoutes(routes: Partial<Record<EntityType, EntityRoute>>, options: { staticPaths?: Iterable<string> } = {}): void {
  entityRoutes = { ...entityRoutes, ...routes };
  staticPaths = new Set([...staticPaths, ...(options.staticPaths ?? [])]);
  compiled = null;
}

const KEY = "[\\w-]+";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isKey = (prefix: string, key: string) => key !== "new" && key !== "edit" && !staticPaths.has(`${prefix}/${key}`);

/** Splits a path template around its key: sheet("/suppliers") -> ["/suppliers/", "/edit"]. */
function around(toPath: (key: string) => string): [string, string] {
  const [before, after] = toPath("\u0000").split("\u0000");
  return [before, after];
}

type CompiledRoute = EntityRoute & { type: EntityType; viewParts: [string, string] | null; editParts: [string, string] | null };
type CompiledRoutes = { routes: CompiledRoute[]; sectionTypes: Map<string, EntityType> };

function routeOf(type: EntityType): EntityRoute | undefined {
  return Object.hasOwn(entityRoutes, type) ? entityRoutes[type] : undefined;
}

function compile(): CompiledRoutes {
  if (compiled) return compiled;
  const routes = (Object.entries(entityRoutes) as [EntityType, EntityRoute][]).map(([type, route]) => ({
    type,
    ...route,
    viewParts: route.view ? around(route.view) : null,
    editParts: route.edit ? around(route.edit) : null,
  }));
  compiled = { routes, sectionTypes: new Map(routes.map((route) => [entitySectionSlug(route.type), route.type])) };
  return compiled;
}

/** The entity types with registered addresses. */
export function registeredEntityTypes(): EntityType[] {
  return compile().routes.map((route) => route.type);
}

/** A type's singular URL segment (calendar_event -> calendar-event), used by type-scoped paths like /audit/<slug>/<key>. */
export function entityTypeSlug(type: EntityType): string {
  return routeOf(type)?.slug ?? type.replace(/_/g, "-");
}

/** The entity type a singular URL segment names (calendar-event -> calendar_event), or null. */
export function entityTypeForSlug(slug: string): EntityType | null {
  return compile().routes.find((route) => entityTypeSlug(route.type) === slug)?.type ?? null;
}

/** The in-app path of a row's view: its own page, or the generic entity view. */
export function entityViewPath(type: EntityType, key: string): string {
  const route = routeOf(type);
  return route?.view ? route.view(key) : `/entity/${type}/${key}`;
}

/** The in-app path of a row's edit sheet, or null when it has none. */
export function entityEditPath(type: EntityType, key: string): string | null {
  const route = routeOf(type);
  return route?.edit ? route.edit(key) : null;
}

/**
 * The URL segment of the sub-view on a generic entity page that lists every related row of `type`:
 * its slug in the plural (/creator/astrid/books, /organization/acme/bank-accounts).
 */
export function entitySectionSlug(type: EntityType): string {
  const slug = routeOf(type)?.slug ?? type.replace(/_/g, "-");
  if (slug === "media") return slug;
  if (/[^aeiou]y$/.test(slug)) return `${slug.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/.test(slug)) return `${slug}es`;
  return `${slug}s`;
}

/** The entity type a sub-view segment lists (books -> book), or null when it isn't one. */
export function entityTypeForSection(section: string): EntityType | null {
  return compile().sectionTypes.get(section) ?? null;
}

/** The generic entity page's own tabs, next to its per-type sub-views. */
export const ENTITY_VIEW_TABS = ["about"] as const;
export type EntityViewTab = (typeof ENTITY_VIEW_TABS)[number];

/** Whether `section` names a sub-view of a generic entity page: a tab (about) or a plural type. */
export function isEntitySection(section: string): boolean {
  return (ENTITY_VIEW_TABS as readonly string[]).includes(section) || compile().sectionTypes.has(section);
}

/** The in-app path of a sub-view of a row's generic page (/entity/creator/astrid/books). */
export function entitySectionPath(type: EntityType, key: string, section: string): string {
  return `/entity/${type}/${key}/${section}`;
}

/** Public path -> in-app path: /supplier/acme/edit -> /suppliers/acme/edit, /suppliers/acme -> /entity/supplier/acme. */
export function toInternalPath(pathname: string): string {
  const [, first, key, rest, ...more] = pathname.replace(/\/+$/, "").split("/");
  if (!first || !key || more.length > 0) return pathname;
  if (rest !== undefined && rest !== "edit" && !isEntitySection(rest)) return pathname;
  const { routes } = compile();
  for (const route of routes) {
    if (route.slug === first && isKey(`/${first}`, key)) {
      if (rest === "edit") return route.edit ? route.edit(key) : entityViewPath(route.type, key);
      // Sub-views (/creator/x/books, /creator/x/about) only exist on the generic page.
      if (rest !== undefined) return route.view ? pathname : entitySectionPath(route.type, key, rest);
      return entityViewPath(route.type, key);
    }
  }
  if (rest !== undefined && rest !== "edit") return pathname;
  // The old plural view of a row without a page of its own: /suppliers/acme.
  if (rest === undefined) {
    for (const route of routes) {
      if (route.view || !route.editParts || route.editParts[0] !== `/${first}/`) continue;
      if (isKey(`/${first}`, key)) return `/entity/${route.type}/${key}`;
    }
  }
  return pathname;
}

/** In-app path -> public path, the inverse of toInternalPath: /suppliers/acme/edit -> /supplier/acme/edit. */
export function toPublicPath(pathname: string): string {
  const { routes } = compile();
  const generic = new RegExp(`^/entity/(\\w+)/(${KEY})(?:/([\\w-]+))?/?$`).exec(pathname);
  if (generic) {
    const route = routes.find((r) => r.type === generic[1]);
    const section = generic[3];
    if (section !== undefined && !isEntitySection(section)) return pathname;
    return route?.slug ? `/${route.slug}/${generic[2]}${section ? `/${section}` : ""}` : pathname;
  }
  for (const route of routes) {
    if (!route.slug) continue;
    for (const [parts, suffix] of [[route.editParts, "/edit"], [route.viewParts, ""]] as const) {
      if (!parts) continue;
      const m = new RegExp(`^${esc(parts[0])}(${KEY})${esc(parts[1])}/?$`).exec(pathname);
      if (m && isKey(parts[0].replace(/\/$/, ""), m[1])) return `/${route.slug}/${m[1]}${suffix}`;
    }
  }
  return pathname;
}

/**
 * The router's location rewrite (`createRouter({ rewrite: entityPathRewrite })`): the address bar
 * shows the public, singular paths while the router and every panel work with the in-app ones.
 */
export const entityPathRewrite = {
  input: ({ url }: { url: URL }) => {
    const next = toInternalPath(url.pathname);
    if (next === url.pathname) return undefined;
    url.pathname = next;
    return url;
  },
  output: ({ url }: { url: URL }) => {
    const next = toPublicPath(url.pathname);
    if (next === url.pathname) return undefined;
    url.pathname = next;
    return url;
  },
};

/**
 * The entity an app path addresses (the inverse of resolveEntityUri), public or in-app, e.g.
 * /supplier/acme, /suppliers/acme/edit or /entity/supplier/acme -> supplier "acme". The key is
 * whatever the path holds: a slug, an identifier or a uuid.
 */
export function entityFromPath(path: string): { entityType: EntityType; entityId: string } | null {
  const internal = toInternalPath(path);
  const generic = new RegExp(`^/entity/(\\w+)/(${KEY})(?:/[\\w-]+)?/?$`).exec(internal);
  if (generic && Object.hasOwn(entityRoutes, generic[1])) return { entityType: generic[1] as EntityType, entityId: generic[2] };
  for (const route of compile().routes) {
    for (const parts of [route.viewParts, route.editParts]) {
      if (!parts) continue;
      // The detail views' own edit sheets (/quests/x/edit, …) address the same row.
      const m = new RegExp(`^${esc(parts[0])}(${KEY})${esc(parts[1])}(?:/edit)?/?$`).exec(internal);
      if (m && isKey(parts[0].replace(/\/$/, ""), m[1])) return { entityType: route.type, entityId: m[1] };
    }
  }
  return null;
}

export type EntityUriTarget = { kind: "path"; path: string } | { kind: "entry"; entryId: string };

let sheetTypes = new Set<EntityType>();

/**
 * Entity types that open in a sheet owned by the shell (its own state, no route of its own), like
 * spacify's finance entries: resolveEntityUri() hands them back as `{ kind: "entry" }`.
 */
export function registerShellSheetTypes(types: EntityType[]): void {
  sheetTypes = new Set([...sheetTypes, ...types]);
}

/**
 * Resolves an entity URI to where it opens in the app (its view), or null if it's
 * malformed/unknown. Shell-sheet types (registerShellSheetTypes) open their sheet, which is the
 * shell's state.
 */
export function resolveEntityUri(uri: string): EntityUriTarget | null {
  const parsed = parseEntityUri(uri);
  if (!parsed) return null;
  const { entityType, entityId } = parsed;
  if (!/^[\w-]+$/.test(entityId)) return null;
  if (sheetTypes.has(entityType)) return { kind: "entry", entryId: entityId };
  return Object.hasOwn(entityRoutes, entityType) ? { kind: "path", path: entityViewPath(entityType, entityId) } : null;
}
