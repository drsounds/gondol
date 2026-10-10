# Configuration

## `configureGondol(config)`

Imported from `gondol`. Call it once, before anything renders, from a module the router imports
(see [Getting started](../guide/getting-started.md#configure-gondol)).

```ts
interface GondolConfig {
  uriScheme: string;
  legacyUriNamespaces?: string[];
  storageNamespace?: string;
  desktop?: { publicOrigin: string; bridge?: string };
  apps?: InternalAppBundle[];
  entities?: {
    routes?: Partial<Record<EntityType, EntityRoute>>;
    staticPaths?: Iterable<string>;
    sources?: Partial<Record<EntityType, EntitySource>>;
    art?: Partial<Record<EntityType, EntityArtStyle>>;
    shellSheetTypes?: EntityType[];
    extensions?: Partial<EntityExtensions>;
  };
}
```

| Field | Default | Meaning | Guide |
| --- | --- | --- | --- |
| `uriScheme` | (required) | The scheme of entity URIs: `myapp` in `myapp:note:abc`. Lower-cased. | [Entities](../guide/entities.md#entity-uris) |
| `legacyUriNamespaces` | `[]` | Namespaces of older `<scheme>:<ns>:<type>:<id>` URIs that still parse. | [Entities](../guide/entities.md#entity-uris) |
| `storageNamespace` | `"gondol"` | Prefix of gondol's `localStorage` keys and window events. | [Platform](../guide/platform.md#storage-namespace) |
| `desktop.publicOrigin` | `""` | The web app's public origin, for links that leave a desktop app. | [Platform](../guide/platform.md#desktop-apps) |
| `desktop.bridge` | `"gondolDesktop"` | The `window` property the Electron preload script exposes. | [Platform](../guide/platform.md#desktop-apps) |
| `apps` | `[]` | The app's bundles, in menu order. | [Building apps](../guide/apps.md) |
| `entities.routes` | `{}` | Each type's public addresses and edit sheet. | [Entities](../guide/entities.md#addresses) |
| `entities.staticPaths` | none | Fixed sub-paths under lists that are never a row's key. | [Entities](../guide/entities.md#addresses) |
| `entities.sources` | `{}` | Each type's table and label. | [Entities](../guide/entities.md#sources-where-rows-live) |
| `entities.art` | `{}` | Each type's tile glyph and hue. | [Entities](../guide/entities.md#art) |
| `entities.shellSheetTypes` | `[]` | Types that open in a sheet owned by the shell instead of a route. | [The application shell](../guide/app-shell.md#opening-entities) |
| `entities.extensions` | no covers, no tags | Hooks your apps provide: `useCoverImage`, `useTags`, `useTagNamesByUri`, `useLike`, `useRestrictions`. | [Entity UI](../guide/entity-ui.md#entity-extensions) |

Each part can also be registered on its own, which is what `configureGondol()` does:
`configureEntityUris`, `registerEntityRoutes` and `registerShellSheetTypes` (`gondol/entities/uri`),
`registerEntitySources` (`gondol/entities/lookup`), `registerEntityArt` (`gondol/entities/EntityArt`),
`registerEntityExtensions` (`gondol/entities/extensions`), `registerApps` (`gondol/apps/registry`),
`configureStorageNamespace` (`gondol/shell/storage`) and `configureDesktopApp`
(`gondol/shell/desktopApp`). The `register*` functions merge with earlier registrations; the `configure*` ones replace.

## `Register`

Gondol's types are plugged into your app's by augmenting the `Register` interface, the way TanStack
Router's `Register` works:

```ts
declare module "gondol" {
  interface Register {
    entityType: EntityType;                    // union of your entity types
    messageKey: MessageKey;                    // keys of your catalogue, gondol's included
    appFeaturePageProps: MyFeaturePageProps;   // extra props every feature page receives
    overviewWidgetProps: MyOverviewWidgetProps; // props of the home view's widgets
  }
}
```

| Key | Without it | Affects |
| --- | --- | --- |
| `entityType` | `string` | `EntityType` everywhere: URIs, routes, sources, art, pickers, search results. |
| `messageKey` | `string` | `MessageKey` and `t()`. |
| `appFeaturePageProps` | nothing extra | `AppFeaturePageProps`. |
| `overviewWidgetProps` | `{ [key: string]: unknown }` | `AppOverviewWidgetProps`. |

`EntityType` and `MessageKey` are exported from `gondol` (and `gondol/register`) for your own code.

## Environment

| Variable | Read by |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | The browser client. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | The browser client during SSR; `requireSupabaseAuth`. |
| `SUPABASE_SERVICE_ROLE_KEY` | `getSupabaseAdmin()`. |

## Vite

```ts
ssr: { noExternal: ["gondol"] },
optimizeDeps: { exclude: ["gondol"] },
```

## Router

```ts
createRouter({ routeTree, rewrite: entityPathRewrite /* gondol/entities/uri */ });
```

Root route:

```ts
validateSearch: validateDateRangeSearch,
search: { middlewares: [retainSearchParams([...GLOBAL_SEARCH_KEYS])] },
```
