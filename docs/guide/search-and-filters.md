# Search and filters

Gondol has one entity search, backed by the `search_entities()` Postgres function, behind the search
page, @ mentions and every `EntityPicker`, so whatever one of them finds, the others can too. On top
of it sits a global filter that narrows every view at once.

## The search page

`SearchPanel` (`gondol/search/SearchPanel`) is a Spotify-style search page over every entity the
user can see. The query is `?q=` and the selected type chip `?type=`, so results survive reloads and
back/forward. Before anything is typed it shows recent searches and a "Browse all" grid.

```tsx
import { SearchPanel, type SearchBrowseTile } from "gondol/search/SearchPanel";

const BROWSE: SearchBrowseTile[] = [
  { label: "nav.notes", path: "/notes", icon: "document", hue: 212 },
  { label: "nav.notebooks", path: "/notebooks", icon: "folder-open", hue: 48 },
];

{pathname === "/search" ? <SearchPanel onOpenUri={openUri} browse={BROWSE} /> : null}
```

`label` is a message key. Give the `/search` route `validateSearch: validateSearchRouteSearch` (from
`gondol/navigation/dateRangeSearch`) so `q` and `type` are typed.

The chrome search field in the header is the desktop entry point: typing navigates to `/search?q=`,
and anything that starts with your URI scheme is treated as an entity URI and opened on Enter (see
`useChromeSearch` in [The application shell](./app-shell.md#a-minimal-shell)).

## `useEntitySearch`

For your own search UI, `useEntitySearch(query, options)` (`gondol/search/entitySearch`) is the same
search, debounced:

```tsx
const { results, loading, current } = useEntitySearch(query, { types: ["note", "notebook"], limit: 10 });
```

| Option | Meaning |
| --- | --- |
| `types` | Narrow to these types. |
| `limit` | Maximum results (default 20). |
| `browse` | With an empty query, list the most recently changed rows instead of nothing. |
| `enabled` | Pause the query. |

A pasted entity URI or app URL finds just that entity. Results are already narrowed to what the
[site](./sites.md) on this domain shows. `current` is false while the results belong to an older
query, so a list never lags behind typing. `useDebounced(value, ms)` is exported too.

## Making a type searchable

Search results come from your database, so a new entity type needs a branch in
`search_entities()`. Its contract:

```sql
search_entities(p_query text, p_types text[] DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (
  entity_type text,     -- your EntityType
  entity_id   text,     -- the row's uuid
  title       text,
  subtitle    text,
  is_own      boolean,  -- the caller owns it
  is_public   boolean,  -- someone else's public row
  rank        real,     -- higher first
  updated_at  timestamptz
)
```

It must only return rows the caller may read, honour `p_types` and `p_limit`, and return the most
recently changed rows for an empty query. Gondol drops results whose type has no registered
[source](./entities.md#sources-where-rows-live) or no title.

Spacify extends it without rewriting it: a migration renames the current function and defines a new
one that unions the old one with the new tables. See its
`supabase/migrations/*_register_geography_entities.sql` for the pattern.

## The global filter

The global filter narrows every view to the entities that match: by type, by conditions, and by a
date period. It lives entirely in the URL, so it follows the user to every page and into shared
links:

| Param | Meaning |
| --- | --- |
| `types` | Comma-separated entity types to show. |
| `where` | Conditions, `field.op:value` joined with `;` (`title.contains:plan;tag.has:work`). |
| `match` | `all` or `any` of the conditions. |
| `fromDate`, `toDate` | The period, `YYYY-MM-DD`. |

To keep them on every navigation, the root route validates them and retains them (see [Getting
started](./getting-started.md#the-root-route)):

```ts
validateSearch: validateDateRangeSearch,
search: { middlewares: [retainSearchParams([...GLOBAL_SEARCH_KEYS])] },
```

and every route's `validateSearch` should be `validateDateRangeSearch` (or a schema extending
`dateRangeSearchSchema`).

### Conditions

| Field | Operators | Value |
| --- | --- | --- |
| `title` | `contains`, `not_contains`, `starts_with`, `equals` | Text. |
| `tag` | `has`, `has_not` | A tag name (needs the `useTags` [extension](./entity-ui.md#entity-extensions)). |
| `ownership` | `is`, `is_not` | `own`, `shared` or `public`. |
| `updated` | `within_days`, `older_than_days` | A number of days. |

### Using it

`GlobalFilterProvider` (`gondol/search/globalFilterState`) reads the filter from the URL and asks
`global_filter_excluded()` which entities fail it. `ActionMenu` then hides every excluded row in every
list, so a list that follows the [row actions convention](./entity-ui.md#row-actions-actionmenu)
needs nothing else.

`gondol/search/GlobalFilter` has the UI:

| Component | What it is |
| --- | --- |
| `GlobalFilterButtons` | The period and filter buttons for the header (`topBarActions`). |
| `GlobalFilterBar` | A strip summarizing what is active, for `AppShell`'s `filterStrip`. |
| `DatePeriodDrawer` | Picks the period. |
| `GlobalFilterDrawer` | Picks types and conditions. |

For custom lists, `useGlobalFilter()` returns `{ filter, period, filterActive, periodActive,
setFilter, setPeriod, clear, hides(uri) }`, and `useGlobalFilterHides(uri)` answers for one entity.
Views with their own dates (a calendar) can read `period` directly.

### Making a type filterable

`global_filter_excluded(p_types, p_conditions, p_match, p_from, p_to)` returns the
`(entity_type, entity_id)` pairs that fail the filter. A new type needs a branch there, using the
same columns as its search branch, and, when it has a date of its own, a dated branch for the period.
Types without dates are never hidden by the period.
