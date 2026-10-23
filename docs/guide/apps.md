# Building apps

An app built on gondol is a bundle of apps. Each one lives in its own folder, declares itself in a
`manifest.json` (checked against a schema), and default-exports `defineApp({ manifest, pages, … })`
from its `index.ts`. The build discovers the apps (`gondol/vite/apps`), so the shell never imports
one by name, and every app's code is loaded lazily.

## Folder layout

```
apps/wiki/
├── manifest.json              # everything declarative: features, actions, nav, create items, entity types
├── index.ts                   # export default defineApp({ manifest, pages, … })
├── features/
│   └── pages/src/
│       ├── pages/WikiPage.tsx        # the feature page (loaded lazily)
│       └── components/WikiPanel.tsx  # the UI it renders
└── models/
    ├── index.ts               # re-exports, so other apps import from "@apps/wiki/models"
    └── wikiPages.ts           # types, queries and mutations (TanStack Query + Supabase)
```

Other apps import an app's models (`@apps/<id>/models`), never its `index.ts` (which would pull the
whole app into their chunk) and never from inside its `features/`.

## The manifest

`manifest.json` is everything about an app that is data. `defineApp` validates it with
`appManifestSchema` (`gondol/apps/manifest`) and throws an error naming every problem, so a typo
fails loudly instead of quietly hiding a feature. Point `$schema` at the generated JSON Schema for
completion and checks in your editor:

```json
{
  "$schema": "../../node_modules/gondol/src/apps/manifest.schema.json",
  "id": "wiki",
  "slug": "wiki",
  "name": { "en": "Wiki", "sv": "Wiki" },
  "description": { "en": "Pages in wiki markup.", "sv": "Sidor i wikimarkering." },
  "iconName": "edit",
  "defaultFeatureId": "pages",
  "dependencies": ["media"],
  "roles": ["creator"],
  "features": [
    {
      "id": "pages",
      "name": { "en": "Wiki", "sv": "Wiki" },
      "path": "wiki",
      "iconName": "edit",
      "actions": [
        { "id": "wiki.new", "title": "New wiki page", "category": "Wiki", "navigate": "/wiki/new", "aspects": ["create"] }
      ],
      "create": [{ "key": "wiki_page", "label": "entity.wiki_page", "section": "nav.wiki", "iconName": "edit", "path": "/wiki/new" }],
      "browse": { "label": "nav.wiki", "iconName": "edit", "hue": 200 }
    }
  ],
  "entities": {
    "wiki_page": {
      "slug": "wiki-page",
      "view": "/wiki/{key}",
      "edit": "/wiki/{key}/edit",
      "art": { "iconName": "edit", "hue": 200 },
      "source": { "table": "wiki_pages", "columns": "id, title", "label": "title" }
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `id` | Stable id. Used in `/app/<id>`, in activation storage keys and in a site's `enabled_apps`. Never change it. |
| `slug` | The `/app/<slug>` segment; usually the same as `id`. |
| `name`, `description` | `{ en, sv?, … }`. Read one with `getLocalizedText(value, locale)`. |
| `iconName` | A glyph of the bungalow icon font (`IconName`). |
| `defaultFeatureId` | The feature `/app/<id>` opens. |
| `dependencies` | Apps this one needs. They are built with it and a site that enables it enables them too. |
| `roles`, `aspects` | The [site](./sites.md) capabilities of every feature (a feature can set its own). |
| `features[]` | `id`, `name`, `path`, `aliases`, `iconName`, `hiddenFromNav`, `entityTypes`, `roles`/`aspects`, and: |
| `features[].actions` | Palette actions. With `navigate` they go to that path; otherwise `defineApp`'s `actions` implements them. Omit for a default "Open …" action, `[]` for none. |
| `features[].create` | Items of the create picker (the plus button): a `path`, or an `action` of this app. |
| `features[].browse` | A tile of the search page's "Browse all" grid. |
| `features[].nav` | An item of the shell's own navigation next to Home and Search (`order`; Home is 0, Search 20), with `drawer`, `tab`, `extra`, `mobileOnly`, `afterAdd`, a `tourId` and a walkthrough step. |
| `entities` | The entity types the app owns: public `slug`, `view`/`edit` path templates with `{key}`, `plural`, `sheet`, tile `art`, and the `source` table and label columns. |
| `staticPaths`, `uuidPaths`, `menuAspects` | Routing facts: static sub-routes that are never a key, path prefixes whose uuids stay uuids, aspects of the app's own menu keys. |
| `settings` | The app's settings: sections, settings of six types and submenus, each stored per user, workspace or site. See [App settings](./settings.md). |

Every answer a manifest declares under a feature goes with that feature: when a site doesn't offer
it (its roles and aspects) or the app is switched off, its nav item, create items and browse tile go
too.

## The app's code

`index.ts` attaches what isn't data. Pages are loaders, so the app's code is a chunk of its own,
fetched when one of its pages opens; widgets made with `lazyWidget` are lazy too:

```ts
// apps/wiki/index.ts
import { defineApp, lazyWidget } from "gondol/apps/defineApp";
import manifest from "./manifest.json";

export default defineApp({
  manifest,
  pages: {
    pages: () => import("./features/pages/src/pages/WikiPage").then((m) => m.WikiPage),
  },
  actions: {
    // Manifest actions without `navigate`, by id.
    "wiki.random": ({ navigate }) => navigate("/wiki/random"),
  },
  widgets: {
    sidebarWidgets: [lazyWidget(() => import("./widgets/RecentPages").then((m) => m.RecentPages))],
  },
});
```

| Field | Meaning |
| --- | --- |
| `pages` | One loader per manifest feature (`() => import(…).then((m) => m.Page)`). Required for every feature. |
| `actions` | Implementations of the manifest's actions that have no `navigate`. See [Actions](./actions.md). |
| `widgets` | Home, sidebar, bottom, overlay and content-head widgets, and providers. See [Widgets](./widgets.md). |
| `resolutions` | Answers to hooks in code (below). |
| `entitySources` | Entity sources whose label needs code, replacing the manifest's `source`. |
| `hooks` | Optional hooks the bundle exposes (`useAppStatus`, or your own). |

## Hooks and resolutions

The shell asks apps for things through **hooks**, typed extension points, and apps **answer** them
with resolutions; the manifest's `nav`, `create`, `browse`, `entities` and routing facts are such
answers, made by `defineApp`. The shell only reads answers, so it never names an app:

```ts
import { defineHook, answer, useResolutions, resolutionsOf } from "gondol/apps/contributions";
import { navItemsHook, createItemsHook, searchBrowseHook, entityTypesHook, entityExtensionsHook, byOrder } from "gondol/apps/shellHooks";

// Your own hook:
export const reportHook = defineHook<{ label: string; load: () => Promise<Report> }>("myapp.reports");

// An app answers it (defineApp({ resolutions: [answer(reportHook, { … }, { featureId: "charts" })] }))
// and the shell reads the answers of apps that are on and offered by the site:
const reports = useResolutions(reportHook).map((a) => a.value);
```

- `useResolutions(hook)` gives the answers that apply now: the host's own and those of active apps
  the site allows, leaving out answers tied (`featureId`) to a feature the site doesn't offer.
- `resolutionsOf(hook)` gives every registered app's answers, for static facts read once (entity
  addresses, sources, art).
- `configureGondol({ resolutions })` adds the host's own answers (its core items, always there).
- gondol's own hooks: `navItemsHook`, `createItemsHook`, `searchBrowseHook`, `entityTypesHook`,
  `entityExtensionsHook` (covers, tags, likes, restrictions) and `routingHook`.

## Registering the apps

Add the vite plugin and import the discovered apps from its virtual module:

```ts
// vite.config.ts
import { gondolApps } from "gondol/vite/apps";
export default defineConfig({ plugins: [gondolApps({ dir: "apps", order: ["notes", "wiki", "tags"] })] });
```

```ts
// apps/bundle.ts
import apps from "virtual:gondol/apps";
export const INTERNAL_APPS = apps;
```

```ts
configureGondol({ uriScheme: "myapp", apps: INTERNAL_APPS /* … */ });
```

Add `"gondol/vite/virtual"` to `compilerOptions.types` for the module's types. Because `apps/` sits
outside `src/`, add it to the host's `tsconfig.json` (`include`, and a `"@apps/*": ["./apps/*"]` path)
and to its Vite `resolve.alias`, so `@apps/<id>/models` resolves. Gondol's own framework modules
(registry, manifest parser, hooks, navigation, `defineApp`) stay in `src/apps/` and are not bundles. `order` is the menu
order; apps it doesn't list come after, alphabetically.

### Building a subset

A fork or a dedicated site can build only some apps, so the rest never reaches the bundle:

```sh
GONDOL_APPS=wiki,ideas vite build          # these and their dependencies
GONDOL_EXCLUDE_APPS=finances,leads vite build
```

(or `gondolApps({ include, exclude })`). Dependencies come along; excluding an app another selected
app needs fails the build. This is the build-time counterpart of a site's `enabled_apps`.

### Gondol's own apps

Gondol ships apps of its own under `src/builtin/`, which a host builds in by id:
`gondolApps({ dir: "apps", builtin: ["ai"] })`, or imports and adds to `configureGondol({ apps })`
by hand (`import { aiApp } from "gondol/builtin/ai"`). There are three: the [ai app](./ai.md),
the [streams app](./streams.md) and the [analytics app](./analytics.md), which needs streams.

`registerApps()` (which `configureGondol()` calls) replaces bundles with the same id, so registering
again during hot reload is harmless. `getInternalApps()`, `getInternalApp(id)`, `isInternalApp(id)`
and `findFeature(appId, featureId)` in `gondol/apps/registry` read the registry outside React.

## Activation

Every user can switch apps on and off; the choice is stored per device in `localStorage` under
`<storageNamespace>:app:active:<appId>` and broadcast to other components and tabs.

```tsx
import { useAppActivation, useAppBundle, useActiveBundles, useRegisteredBundles } from "gondol/apps/hooks";

function WikiToggle() {
  const { isActive, toggle } = useAppActivation("wiki");
  return <button onClick={toggle}>{isActive ? "Turn off Wiki" : "Turn on Wiki"}</button>;
}
```

| Hook | Returns |
| --- | --- |
| `useAppActivation(appId, defaultActive?)` | `{ isActive, activate, deactivate, toggle }` for the user's own switch. |
| `useAppBundle(appId)` | The bundle, the switch, and `siteDisabled` when the [site](./sites.md) on this domain leaves the app out (then `isActive` is false whatever the switch says). |
| `useRegisteredBundles()` | Every bundle with its live `isActive` and `siteDisabled`. Use it for an app catalogue. |
| `useActiveBundles()` | Only the active bundles. The navigation, palette and widgets are built from these. |
| `useAppFeature(appId, featureId?)` | The bundle, the feature (the default one when no id is given) and the switch. |

Outside React, `getAppActivation(appId)` and `setAppActivation(appId, active)` read and write the
same switch.

When an app is off, its sidebar section, palette actions, widgets and providers disappear at once.
Its pages still resolve, so a shell can show `AppDeactivatedNotice` (from
`gondol/apps/components/AppDeactivatedNotice`) with a button to turn it back on. The badges
`InternalAppBadge` and `ExternalAppBadge` label apps in a catalogue.

## Apps that work together

Apps reach each other through models and through entities, not through each other's components:

- **Models.** Import another app's types, queries and mutations from its models
  (`import { useTags } from "@apps/tags/models"`) and list it in `dependencies`.
- **Entities.** Point at another app's rows by entity URI (`myapp:note:<id>`). Anything that only
  holds a URI can label it with `useEntityLabels`, open it with `resolveEntityUri` and show its art.
  See [Entities](./entities.md).
- **Entity extensions.** An app can provide a framework-wide capability by answering
  `entityExtensionsHook` (or through `configureGondol({ entities: { extensions } })`), such as cover
  images or tags, which gondol's own UI then uses. See [Entity UI](./entity-ui.md#entity-extensions).
- **Entity actions.** `EntityActionsProvider` adds items ("Save to library", "Tags…") to every
  entity's actions menu. See [Entity UI](./entity-ui.md#entity-wide-actions).

## External apps

`gondol/apps/external` and `gondol/apps/types` also describe *external* apps: user-created web apps that
open in an iframe at `/app/<id>` (`UnifiedApp`, `AppKind`). Gondol provides the helpers; storing them
is up to your app (Spacify keeps them in an `apps` table):

- `buildEmbedSrc(embedUrl, splat)` joins the app's `embed_url` with the rest of the path, so a deep
  link into `/app/<id>/projects/42` lands on the embedded app's `/projects/42`.
- `externalWindowUrl(app)` is the plain URL of an app that opens in a new window instead.
- `faviconUrlFor(embedUrl)` is a default icon.
- `appPathKey(app)` is the `/app/<key>` segment: its slug, else its id.

## Checklist for a new app

1. Create `apps/<id>/` with `manifest.json` (with `$schema`), `index.ts`, `features/` and `models/`.
2. Declare its features, actions, nav/create/browse items and entity types in the manifest.
3. `export default defineApp({ manifest, pages })` with a lazy loader per feature.
4. Add it to the plugin's `order` where it should appear in the menu.
5. Add its strings to your message catalogue (see [Internationalization](./i18n.md)).
6. Add route files for any create and edit sheets, and for pages that need their own `<title>`.
