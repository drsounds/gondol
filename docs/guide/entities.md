# Entities

An entity is any row a user can open, link to, search for or drag around: a note, a supplier, a
playlist. Gondol's entity system gives every entity type a URI, public addresses, a label, cover art
and a standard set of actions, as soon as the type is registered.

## Entity types

An entity type is a short lowercase name, with underscores between words (`note`,
`calendar_event`). Declare your app's types as a union and plug it into gondol, so every API that
takes a type is checked against it:

```ts
// src/lib/entities.ts
export type EntityType = "note" | "notebook" | "tag";
```

```ts
// src/gondol.ts
declare module "gondol" {
  interface Register {
    entityType: EntityType;
  }
}
```

Without the augmentation, entity types are plain strings.

## Entity URIs

Every entity has a URI: `<scheme>:<type>:<key>`.

```
myapp:note:shopping-list
myapp:note:7Kx2bQ0fA1hZ9mN3pR5tVw          (its base62 identifier)
myapp:note:0f6c1d2e-8a4b-4c3d-9e7f-1a2b3c4d5e6f   (its uuid)
```

The scheme is your app's (`configureGondol({ uriScheme: "myapp" })`). The key can be the row's
slug, its identifier or its uuid; all three resolve to the same row. URIs are how entities point at
each other (a playlist item, a mention in rich text, a tag on any row), what "Copy URI" copies, and
what a user can paste into the search field to open a row.

```ts
import { isEntityUri, parseEntityUri, toEntityUri } from "gondol/entities/uri";

toEntityUri("note", note.id);              // "myapp:note:0f6c1d2e-…"
isEntityUri("myapp:note:abc");             // true
parseEntityUri("myapp:note:abc");          // { entityType: "note", entityId: "abc" }
parseEntityUri("https://example.com");     // null
```

`legacyUriNamespaces` keeps older four-part URIs working: with `["cvinna"]`,
`myapp:cvinna:note:abc` parses as `note` / `abc`.

**Store URIs by uuid.** When you save a URI in a row (a playlist item, a tag assignment), store the
uuid form, which never changes. `canonicalEntityUri(uri)` (from `gondol/entities/lookup`) turns a
slug or identifier URI into it. What users copy and share uses the slug instead (see [Sharing](#sharing)).

## Keys: id, identifier and slug

Every entity table has three keys:

| Column | What it is |
| --- | --- |
| `id` | The uuid primary key. |
| `identifier` | The id in base62, 22 characters, kept in sync by a database trigger. |
| `slug` | The key used in URLs. It defaults to the identifier and the user can change it to a readable lowercase kebab-case name ("Change address…"). Unique per owner, or per table for shared entities. |

In Spacify a migration adds both columns and their triggers to a table with
`SELECT public.add_entity_slug('public.notes');` (pass `true` as the second argument for a
table-wide unique slug). See [Supabase](./supabase.md#entity-tables).

`gondol/entities/slugs` works with those keys in the browser:

| Function | Use |
| --- | --- |
| `entityKey(row)` | The key to put in a URL: the slug, else the id. Always navigate with it. |
| `findByEntityKey(rows, key)` | The row a URL key points at, by slug, identifier or uuid (slug first). |
| `matchesEntityKey(row, key)` | Whether a key points at a row. |
| `idForEntityKey(rows, key)` | The uuid a key points at, from `rows` or straight from a uuid or identifier key. |
| `entityIdentifier(uuid)`, `uuidFromIdentifier(id)` | Convert between the two, as the database does. |
| `isUuid(value)` | Whether a key is a uuid. |
| `slugify(text)` | A name as a slug: lowercase ASCII kebab-case, at most 64 characters. |
| `slugProblem(slug)` | Why a custom slug would be rejected: `"format"`, `"reserved"` (`new`, `edit`) or null. |
| `isDefaultSlug(row)` | Whether the slug is still the identifier. |

`useEntityIdForKey(table, key, rows)` (`gondol/entities/useEntityId`) resolves a key to a uuid even
when the row isn't in `rows`, by looking up the slug. `useSlugRedirect()` swaps any uuid in the
current path for the row's slug, so old links end up on the readable address; call it once in the
shell.

## Addresses

Every entity has two public addresses, named after its type in the singular:

- `/<slug>/<key>` views it,
- `/<slug>/<key>/edit` opens its edit sheet.

Inside the app those are rewritten to wherever the views actually live, so a list's panel keeps
reading its own paths (`/notes/<key>/edit`) while the address bar shows `/note/<key>/edit`. Register
each type's addresses with an `EntityRoute`:

```ts
// src/lib/entities.ts
import { sheet, type EntityRoute } from "gondol/entities/uri";

export const ENTITY_ROUTES: Record<EntityType, EntityRoute> = {
  // /note/<key> is the generic entity view, /note/<key>/edit is /notes/<key>/edit.
  note: { slug: "note", edit: sheet("/notes") },
  // Notebooks have a page of their own at /notebooks/<key>.
  notebook: { slug: "notebook", view: (key) => `/notebooks/${key}`, edit: sheet("/notebooks") },
  // No singular address; opens at /tags/<key>/edit.
  tag: { slug: null, edit: sheet("/tags") },
};

// Static segments under the lists' paths that are never a row's key.
export const STATIC_PATHS = new Set(["/notes/archive", "/notebooks/shared"]);
```

| Field | Meaning |
| --- | --- |
| `slug` | The singular URL segment (`calendar-event` for `calendar_event`), or `null` for no singular address. |
| `view(key)` | The row's own page. Without it, the row opens in the generic view at `/entity/<type>/<key>`. |
| `edit(key)` | The row's edit sheet. `sheet("/notes")` is shorthand for `` (key) => `/notes/${key}/edit` ``. |

Turn the rewrite on in the router with `createRouter({ rewrite: entityPathRewrite })`. It maps:

| Address bar | In the app |
| --- | --- |
| `/note/shopping-list` | `/entity/note/shopping-list` |
| `/note/shopping-list/edit` | `/notes/shopping-list/edit` |
| `/notebook/work` | `/notebooks/work` |
| `/notes/shopping-list` (an old plural view) | `/entity/note/shopping-list` |

`STATIC_PATHS` stops a fixed sub-page such as `/notes/archive` from being read as the row `archive`.

The functions behind it are exported too: `toInternalPath`, `toPublicPath`, `entityViewPath(type,
key)`, `entityEditPath(type, key)`, `entityFromPath(path)` (the entity any app path addresses),
`entityTypeSlug`, `entityTypeForSlug` and `registeredEntityTypes()`.

### Sub-views of the generic page

A generic entity page can list related rows by type: `/creator/astrid/books` lists the creator's
books. The segment is the type's slug in the plural (`entitySectionSlug("book")` is `books`), and
`about` is a built-in tab (`ENTITY_VIEW_TABS`). `isEntitySection(segment)`,
`entityTypeForSection(segment)` and `entitySectionPath(type, key, section)` read and build them.

## Opening an entity

`resolveEntityUri(uri)` turns a URI into where it opens:

```ts
resolveEntityUri("myapp:note:shopping-list");
// { kind: "path", path: "/entity/note/shopping-list" }
```

It returns null for a malformed URI or an unregistered type. Types registered as
`shellSheetTypes` come back as `{ kind: "entry", entryId }` instead: they have no route, and the
shell opens its own sheet for them (Spacify's finance entries). See [Opening
entities](./app-shell.md#opening-entities).

## Sources: where rows live

A source tells gondol which table a type's rows are in and how to name one, so anything holding
only a URI can show a label:

```ts
// src/lib/entitySources.ts
import type { EntitySource } from "gondol/entities/lookup";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export const ENTITY_SOURCES: Record<EntityType, EntitySource> = {
  note: { table: "notes", columns: "id, title", label: (r) => str(r.title) },
  notebook: { table: "notebooks", columns: "id, name", label: (r) => str(r.name) },
  tag: { table: "tags", columns: "id, name", label: (r) => str(r.name) },
};
```

`columns` must include `id` and every column `label` reads. A type without a source is unknown to
gondol's lookups, search results and pickers (`isKnownEntityType(type)` is false).

`gondol/entities/lookup` reads through the sources:

| Function | Returns |
| --- | --- |
| `useEntityLabels(uris)` | A query whose data is a `Map` from URI to label, fetched per type in one request each. |
| `labelFor(labels, uri)` | One label from that map (normalizing the URI first). |
| `entityTypeLabel(t, uri)` | The translated type name, from the message key `entity.<type>`. |
| `lookupEntity(type, key)` | `{ id, title, isOwn }` for one key. |
| `fetchEntityRow(type, key)` | The whole row with its title and URL key. |
| `fetchEntitiesWhere(type, column, id)` | Rows whose foreign key holds `id` (a notebook's notes), labelled. |
| `fetchEntitiesById(type, ids)` | Rows by id, labelled. |
| `resolveEntityKeys(type, keys)` | A map from keys (slug, identifier, uuid) to uuids. When another user's readable row has the same slug, the user's own wins. |
| `canonicalEntityUri(uri)` | The uuid form of a URI. |

```tsx
function PlaylistItems({ items }: { items: { uri: string }[] }) {
  const { t } = useI18n();
  const labels = useEntityLabels(items.map((i) => i.uri));
  return (
    <ul>
      {items.map((item) => (
        <li key={item.uri}>
          {labelFor(labels.data, item.uri) ?? item.uri} · {entityTypeLabel(t, item.uri)}
        </li>
      ))}
    </ul>
  );
}
```

## Art

Each type has a glyph from the icon font and a hue for its generated cover tile:

```ts
// src/lib/entityArt.ts
import type { EntityArtStyle } from "gondol/entities/EntityArt";

export const ENTITY_ART: Record<EntityType, EntityArtStyle> = {
  note: { icon: "document", hue: 212 },
  notebook: { icon: "folder-open", hue: 48 },
  tag: { icon: "like", hue: 330 },
};
```

`<EntityArt type="note" title={note.title} size="sm" uri={uri} />` renders the tile: the glyph at
`sm`, the title's initial with a small glyph badge at `md` and `lg`, or the entity's cover image
when an app provides one (see [entity extensions](./entity-ui.md#entity-extensions)).
`EntityArtTile` takes the cover directly, for pages that can't read it themselves.

## Sharing

Inside the app, URIs address rows by uuid. What a user copies uses the slug instead (or the
identifier while the slug hasn't loaded), so it reads like the app's own URLs. `ActionMenu` does
this for you; the helpers are in `gondol/entities/shareUri`:

| Function | Use |
| --- | --- |
| `useShareKey(uri, enabled)` | The slug (or identifier) to share a uuid URI by. |
| `shareUri(uri, key)` | `myapp:note:<key>`. |
| `shareUrl(uri, key)` | The full public address, on the public origin inside the desktop app. Null for shell-sheet types. |
| `entityRefFromText(text)` | The entity a pasted URI or app URL points at, or null. |

## Trees

Types that nest under themselves through `parent_id` (projects, folders, places) can use
`gondol/entities/tree`: `flattenTree(rows)` (tree order with depth, safe against cycles),
`withDescendants(rows, id)`, `ancestorsOf(rows, parentId)` and `indentedName(name, depth)` for
indented options.

## Adding an entity type

1. **Database.** Create the table with `id uuid`, `user_id`, `created_at` and `updated_at`, RLS
   policies, and `slug` and `identifier` (`add_entity_slug`). See [Supabase](./supabase.md#entity-tables).
2. **Search.** Add the type to `search_entities()` (and to `global_filter_excluded()` if it should
   respond to the global filter).
3. **Type.** Add it to your `EntityType` union.
4. **Addresses.** Add an `EntityRoute` to `ENTITY_ROUTES` (and any static sub-paths to
   `STATIC_PATHS`).
5. **Source.** Add an `EntitySource` to `ENTITY_SOURCES`.
6. **Art.** Add an `EntityArtStyle` to `ENTITY_ART`.
7. **Strings.** Add `entity.<type>` (the type's name) to every locale of your message catalogue.
8. **UI.** Pass `uri={toEntityUri(type, row.id)}` to every `ActionMenu` and `EntitySheet` for the type.
9. **Routes.** Add route files for the list, `new` and `$key/edit` (see [Entity UI](./entity-ui.md#create-and-edit-sheets)).
