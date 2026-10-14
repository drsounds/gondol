# Getting started

This page takes a TanStack Start app from nothing to a running gondol shell. The later guides go
deeper into each part; [Spacify](https://github.com/drsounds/spacify) is the reference app built on
gondol, and its `src/gondol.ts`, `src/router.tsx`, `src/routes/__root.tsx` and `src/routes/index.tsx`
are the real-world version of everything below.

## What you need

- A [TanStack Start](https://tanstack.com/start) app with React 19 and file-based routing.
- A [Supabase](https://supabase.com) project. Gondol's queries expect a few tables and functions in
  it; see [Supabase](./supabase.md#the-base-schema).
- [Bun](https://bun.sh) or another package manager that can install git dependencies.

## Install

Gondol ships TypeScript sources and has no build step. Add it as a git dependency pinned to a
commit, so upgrading is an explicit change in your app:

```json
{
  "dependencies": {
    "gondol": "git+https://github.com/drsounds/gondol.git#<commit>"
  }
}
```

Its peer dependencies come from your app: `react`, `react-dom`, `@tanstack/react-router`,
`@tanstack/react-start`, `@tanstack/react-query`, `@supabase/supabase-js` and `zod`.

::: tip Private repository
While gondol's repository is private, installing it needs a GitHub token with read access. Bun reads
`GITHUB_TOKEN` when it downloads GitHub tarballs, so in CI pass a repository secret as that variable
to `bun install`.
:::

## Let Vite compile it

Because gondol is TypeScript source, Vite must compile it rather than treat it as a prebuilt
dependency:

```ts
// vite.config.ts
export default defineConfig({
  // …
  ssr: { noExternal: ["gondol"] },
  optimizeDeps: { exclude: ["gondol"] },
});
```

Import the framework's styles once, from your app's stylesheet:

```css
/* src/styles.css */
@import "gondol/styles/gondol.css";
```

::: warning Shell styles still live in Spacify
`gondol.css` brings the design system's theme, the Aero and TUI engines' styles and the base styles.
The styles of the chrome bar, the navigation, sheets (`.sheet`), action rows and tables have not
moved into gondol yet; until they do, copy those sections from Spacify's `src/styles.css`.
:::

Every module is imported by its path: `gondol/entities/uri`, `gondol/shell/AppShell`,
`gondol/theme/theme` and so on. The [module reference](../reference/modules.md) lists them all.

## Configure gondol

Create one module that tells gondol about your app: its URI scheme, its entity types and its apps.
Call it once, before anything renders.

```ts
// src/gondol.ts
import { configureGondol } from "gondol";
import { INTERNAL_APPS } from "@apps/bundle";
import { ENTITY_ART } from "@/lib/entityArt";
import { ENTITY_SOURCES } from "@/lib/entitySources";
import { ENTITY_ROUTES, STATIC_PATHS, type EntityType } from "@/lib/entities";
import type { MessageKey } from "@/lib/i18n";

declare module "gondol" {
  interface Register {
    entityType: EntityType;
    messageKey: MessageKey;
  }
}

let configured = false;

export function setupGondol(): void {
  if (configured) return;
  configured = true;
  configureGondol({
    uriScheme: "myapp",              // myapp:note:shopping-list
    storageNamespace: "myapp",       // prefix of localStorage keys and window events
    apps: INTERNAL_APPS,             // your bundle of apps, in menu order
    entities: {
      routes: ENTITY_ROUTES,         // public addresses and edit sheets per type
      staticPaths: STATIC_PATHS,
      sources: ENTITY_SOURCES,       // table and label per type
      art: ENTITY_ART,               // tile glyph and hue per type
    },
  });
}
```

Call it from the router module, which loads before the first render:

```ts
// src/router.tsx
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { entityPathRewrite } from "gondol/entities/uri";
import { routeTree } from "./routeTree.gen";
import { setupGondol } from "./gondol";

setupGondol();

export const getRouter = () => {
  const queryClient = new QueryClient();
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Entities are addressed in the singular in the address bar (/note/shopping-list).
    rewrite: entityPathRewrite,
  });
};
```

::: warning `sideEffects: false`
If your `package.json` sets `"sideEffects": false`, a bare `import "./gondol"` is dropped by the
bundler. Export a function and call it, as above.
:::

The [configuration reference](../reference/configuration.md) describes every field of
`configureGondol()` and `Register`.

## The root route

The root route wraps the app in gondol's providers and runs small scripts before first paint, so the
user's theme applies without a flash.

```tsx
// src/routes/__root.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, retainSearchParams } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { GLOBAL_SEARCH_KEYS, validateDateRangeSearch } from "gondol/navigation/dateRangeSearch";
import { NavigationProgress } from "gondol/navigation/NavigationProgress";
import { installDeveloperMode } from "gondol/shell/developerMode";
import { SiteProvider } from "gondol/sites/sites";
import { AccentColorProvider } from "gondol/theme/accentColor";
import { THEME_STORAGE_KEY, ThemeProvider } from "gondol/theme/theme";
import { USER_THEME_INIT_SCRIPT, UserThemeProvider } from "gondol/theme/userTheme";
import { I18nProvider } from "@/lib/i18n";

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // The date period and the entity filter are global: every navigation keeps them.
  validateSearch: validateDateRangeSearch,
  search: { middlewares: [retainSearchParams([...GLOBAL_SEARCH_KEYS])] },
  shellComponent: RootShell,
  component: RootComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: USER_THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => installDeveloperMode(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <SiteProvider>
        <ThemeProvider>
          <AccentColorProvider>
            <UserThemeProvider>
              <I18nProvider>
                <NavigationProgress />
                <Outlet />
              </I18nProvider>
            </UserThemeProvider>
          </AccentColorProvider>
        </ThemeProvider>
      </SiteProvider>
    </QueryClientProvider>
  );
}
```

The order matters: `UserThemeProvider` reads `ThemeProvider`, `AccentColorProvider` and
`SiteProvider`, and almost every component reads `I18nProvider`. Spacify adds two more pre-paint
scripts, one for the accent colour and one for the browser's `theme-color` meta tag; see
[Theming](./theming.md#avoiding-a-flash-on-load).

`I18nProvider` here is your app's wrapper around gondol's, which passes your message catalogue; see
[Internationalization](./i18n.md).

## The shell route

Most of an app on gondol is one component, the shell, that every route renders. It sets up the
per-page providers, renders `AppShell` and picks what to show from the path. A catch-all route makes
every app feature reachable without a route file of its own:

```tsx
// src/routes/$.tsx
import { createFileRoute } from "@tanstack/react-router";
import { validateDateRangeSearch } from "gondol/navigation/dateRangeSearch";
import { Home } from "@/routes/index";

export const Route = createFileRoute("/$")({
  validateSearch: validateDateRangeSearch,
  component: Home,
});
```

[The application shell](./app-shell.md) walks through `Home`.

## Supabase environment

The shared clients read their settings from the environment:

| Variable | Used by |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | The browser client (replaced at build time by Vite) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | The same client during SSR, and the auth middleware |
| `SUPABASE_SERVICE_ROLE_KEY` | The server-only admin client |

## Next steps

- [Core concepts](./concepts.md) explains how apps, features and entities fit together.
- [Build your first app](../tutorial/first-app.md) adds a complete app with an entity type, a list,
  a create/edit sheet, actions and a widget.
