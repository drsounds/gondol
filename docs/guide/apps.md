# Building apps

An app built on gondol is a bundle of apps. Each one lives in its own folder, describes itself in a
`manifest.json`, exports an `InternalAppBundle`, and is registered in menu order through
`configureGondol({ apps })`.

## Folder layout

Spacify's apps all follow the same shape, which keeps each app self-contained:

```
src/apps/wiki/
├── manifest.json              # id, names, icon, features (metadata only)
├── index.ts                   # the InternalAppBundle
├── features/
│   └── pages/
│       ├── index.ts           # the AppFeature (path, Page, actions)
│       └── src/
│           ├── pages/WikiPage.tsx        # the feature page component
│           └── components/WikiPanel.tsx  # the UI it renders
└── models/
    ├── index.ts               # re-exports, so other apps import from "@/apps/wiki"
    └── wikiPages.ts           # types, queries and mutations (TanStack Query + Supabase)
```

Other apps import an app's models through its `index.ts` (`export * from "./models"`), never from
inside its `features/`.

## The manifest

`manifest.json` holds an app's metadata, with names and descriptions in every locale you ship:

```json
{
  "id": "wiki",
  "slug": "wiki",
  "name": { "en": "Wiki", "sv": "Wiki" },
  "description": {
    "en": "Pages in wiki markup, linking to each other and mentioning any entity.",
    "sv": "Sidor i wikimarkering som länkar till varandra och nämner vad som helst."
  },
  "iconName": "edit",
  "defaultFeatureId": "pages",
  "dependencies": ["media"],
  "features": [
    {
      "id": "pages",
      "name": { "en": "Pages", "sv": "Sidor" },
      "description": { "en": "Wiki pages with links and mentions", "sv": "Wikisidor med länkar" },
      "path": "wiki",
      "iconName": "edit"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Stable id. Used in `/app/<id>`, in activation storage keys and in a site's `enabled_apps`. Never change it. |
| `slug` | The `/app/<slug>` segment; usually the same as `id`. |
| `name`, `description` | `AppLocaleString`: `{ en, sv?, … }`. Read one with `getLocalizedText(value, locale)`. |
| `iconName` | A glyph of the bungalow icon font (`IconName`). |
| `defaultFeatureId` | The feature `/app/<id>` opens. |
| `dependencies` | Ids of apps this one needs. A site that enables this app enables them too. |
| `features` | Each feature's id, names, `path` and icon. |

`iconName` values come from the design system's icon font; `IconName` is exported from
`gondol/apps/types` so editors can complete them.

## The bundle

`index.ts` turns the manifest into an `InternalAppBundle` and attaches the code:

```ts
// src/apps/wiki/index.ts
import type { InternalAppBundle, IconName } from "gondol/apps/types";
import manifest from "./manifest.json";
import { pagesFeature } from "./features/pages";

export const wikiApp: InternalAppBundle = {
  id: manifest.id,
  slug: manifest.slug,
  name: manifest.name.en,
  description: manifest.description.en,
  iconName: manifest.iconName as IconName,
  defaultFeatureId: manifest.defaultFeatureId,
  dependencies: manifest.dependencies,
  manifest,
  isInternal: true,
  defaultActive: true,
  features: [pagesFeature],
};

export * from "./models";
```

| Field | Meaning |
| --- | --- |
| `features` | The `AppFeature`s, in the order they appear in the sidebar section. See [Features](./features.md). |
| `actions` | App-wide palette actions, in addition to each feature's. See [Actions](./actions.md). |
| `widgets` | Components for the home view, sidebar, bottom of the screen, and providers. See [Widgets](./widgets.md). |
| `defaultActive` | Whether the app is on for a user who hasn't switched it. Defaults to `true`. |
| `hooks` | Optional hooks the bundle exposes to other code (`useAppStatus`, or your own). |
| `iconUrl` | An image to use instead of the icon glyph. |
| `isInternal` | Always `true` for bundles in your source code. |

## Registering the bundle

Collect every app in one list, in the order the sidebar should show them, and pass it to
`configureGondol()`:

```ts
// src/apps/bundle.ts
import type { InternalAppBundle } from "gondol/apps/types";
import { notesApp } from "./notes";
import { tagsApp } from "./tags";
import { wikiApp } from "./wiki";

export const INTERNAL_APPS: InternalAppBundle[] = [notesApp, wikiApp, tagsApp];
```

```ts
configureGondol({ uriScheme: "myapp", apps: INTERNAL_APPS /* … */ });
```

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

- **Models.** Import another app's types, queries and mutations from its `index.ts`
  (`import { useTags } from "@/apps/tags"`) and list it in `dependencies`.
- **Entities.** Point at another app's rows by entity URI (`myapp:note:<id>`). Anything that only
  holds a URI can label it with `useEntityLabels`, open it with `resolveEntityUri` and show its art.
  See [Entities](./entities.md).
- **Entity extensions.** An app can provide a framework-wide capability through
  `configureGondol({ entities: { extensions } })`, such as cover images or tags, which gondol's own UI
  then uses. See [Entity UI](./entity-ui.md#entity-extensions).
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

1. Create `src/apps/<id>/` with `manifest.json`, `index.ts`, `features/` and `models/`.
2. Write at least one feature (see [Features](./features.md)).
3. Add the bundle to your `INTERNAL_APPS` list.
4. If it introduces entity types, register them (see [Entities](./entities.md#adding-an-entity-type)).
5. Add its strings to your message catalogue (see [Internationalization](./i18n.md)).
6. Add route files for any create and edit sheets, and for pages that need their own `<title>`.
