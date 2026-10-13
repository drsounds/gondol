# Features

A feature is one page of an app. It is declared in the app's `manifest.json` (an id, a name, a path,
an icon, palette actions, create items, …; see [Building apps](./apps.md#the-manifest)) and its page
is attached, lazily, in the app's `index.ts`:

```json
{
  "id": "pages",
  "name": { "en": "Wiki", "sv": "Wiki" },
  "description": { "en": "Wiki pages with links, @ mentions and media" },
  "iconName": "edit",
  "path": "wiki",
  "actions": [
    {
      "id": "wiki.pages.new",
      "title": "New Wiki Page",
      "category": "Wiki",
      "iconName": "plus",
      "keywords": ["wiki", "page", "new", "create"],
      "navigate": "/wiki/new"
    }
  ]
}
```

```ts
export default defineApp({
  manifest,
  pages: { pages: () => import("./features/pages/src/pages/WikiPage").then((m) => m.WikiPage) },
});
```

`defineApp` makes each one an `AppFeature`:

| Field | Meaning |
| --- | --- |
| `id` | Unique within the app. Used in `/app/<appId>/<featureId>` and in nav item ids. |
| `name`, `description`, `iconName` | Shown in the sidebar, the menu drawer, the palette and `AppFeatureNav`. Without an icon the app's is used. |
| `path` | The feature's top-level path, without a leading slash (`"wiki"` is `/wiki`). |
| `aliases` | Other top-level paths that open the same feature (old addresses, short forms). |
| `hiddenFromNav` | Routable, but left out of the app's sidebar section (for pages linked from elsewhere). |
| `Page` | The page, a lazy `ComponentType<AppFeaturePageProps>`; render it with `<FeaturePage/>` (`gondol/apps/components/FeaturePage`), which adds the `Suspense`. |
| `actions` | Palette actions. When the field is left out, gondol adds an "Open *name*" action for the feature; `[]` means none. |

## How a path finds a feature

`useDynamicRoute(pathname)` (from `gondol/apps/navigation`) resolves a path against every registered
app, active or not, and returns a `DynamicRouteMatch`:

```ts
interface DynamicRouteMatch {
  app: InternalAppBundle;
  feature: AppFeature;
  isActive: boolean;     // the app's live activation (user switch and site)
  appId: string;
  featureId: string;
  isAppView?: boolean;   // true for /app/<appId>/… addresses
  subpath?: string;      // whatever follows the feature's path
}
```

It tries, in order:

1. **App addresses**: `/app/<appId or slug>/<featureId or path>/<rest>`. When the second segment
   names no feature, the app's default feature opens and the segment becomes part of `subpath`.
2. **Feature paths**: `/<path>` and `/<path>/<rest>` for every feature of every app, in registration
   order. The first match wins, so keep paths unique across apps.
3. **Aliases**, the same way.

So with the feature above, `/wiki` matches with no subpath, `/wiki/new` matches with `subpath: "new"`
and `/app/wiki/pages/getting-started/edit` matches with `subpath: "getting-started/edit"`.

Your shell decides what to do with the match: render the page, or `AppDeactivatedNotice` when
`isActive` is false. See [The application shell](./app-shell.md#rendering-the-current-page).

## The page component

Every feature page receives `AppFeaturePageProps`:

| Prop | Meaning |
| --- | --- |
| `appId`, `featureId` | Which app and feature this is. |
| `splat` | The `subpath` of the match: what follows the feature's path. |
| `onNavigateFeature(featureId, subpath?)` | Go to another feature of the same app. |
| `onOpenUri(uri)` | Open an entity by its URI, through the shell's resolver. |
| Your own props | Whatever your shell hands every page, typed through `Register["appFeaturePageProps"]`. |

```tsx
// src/apps/wiki/features/pages/src/pages/WikiPage.tsx
import type { AppFeaturePageProps } from "gondol/apps/types";
import { WikiPanel } from "../components/WikiPanel";

export function WikiPage({ onOpenUri }: AppFeaturePageProps) {
  return <WikiPanel onOpenUri={onOpenUri} />;
}
```

Keep the page component thin and put the UI in a panel component next to it. The panel then reads
the router itself (`useRouterState`, `useEntityModal`) instead of relying on `splat`, which keeps it
reusable from other pages.

### Shared props from the shell

If your shell loads data every page uses (Spacify loads the user's finance entries once), pass it to
every feature page and type it on `Register`:

```ts
// src/gondol.ts
export interface MyFeaturePageProps {
  today?: Date;
  rangeFrom?: string;
  rangeTo?: string;
}

declare module "gondol" {
  interface Register {
    appFeaturePageProps: MyFeaturePageProps;
  }
}
```

Every page's props are then `BaseAppFeaturePageProps & MyFeaturePageProps`.

## Sub-pages inside a feature

A feature owns everything under its path. Two patterns cover most needs:

- **Create and edit sheets** are routes under the list: `/notes/new` and `/notes/<key>/edit`. The
  `useEntityModal("/notes")` hook reads and writes them; see [Entity
  UI](./entity-ui.md#create-and-edit-sheets).
- **Detail views** are `/notes/<key>`. Read the key from the path (or from `splat`) and find the row
  with `findByEntityKey(rows, key)`, which accepts the slug, the identifier and the uuid.

A catch-all route (`src/routes/$.tsx`) that renders the shell makes all of these reachable. Add
explicit route files next to it when a page needs its own `<title>`, or when you want typed links to
it:

```tsx
// src/routes/notes.new.tsx
import { createFileRoute } from "@tanstack/react-router";
import { validateDateRangeSearch } from "gondol/navigation/dateRangeSearch";
import { Home } from "@/routes/index";

export const Route = createFileRoute("/notes/new")({
  validateSearch: validateDateRangeSearch,
  head: () => ({ meta: [{ title: "New note" }] }),
  component: Home,
});
```

Every route file renders the same shell component; only `head()` differs.

## The app view

`/app/<appId>/<featureId>` shows a feature inside its app's own frame: a header with the app's icon,
name and description, an Activate/Deactivate button, "All Apps", and a tab per feature. Render it
with `AppBundleView` (`gondol/apps/components/AppBundleView`):

```tsx
<AppBundleView
  app={bundle}
  splat={pathAfterAppId}            // "pages/getting-started"
  onBackToApps={() => navigate("/apps")}
  onOpenUri={openUri}               // any extra props are passed on to the feature page
/>
```

`AppFeatureNav` is that header on its own, for shells that frame features differently.

## Navigation entries

`useAppNavigation(locale)` builds the sidebar sections: one `DynamicMenuSection` per active app, with
a `DynamicMenuItem` per feature that isn't `hiddenFromNav`. `AppShell` and `MobileNavDrawer` render
them for you, highlighting the item whose path is the current path or a prefix of it.
