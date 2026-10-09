# The application shell

Every route of an app on gondol renders the same component, the shell. It sets up the providers a
page needs, renders `AppShell` (the frame) and decides from the path what goes inside it. In Spacify
that component is `Home` in `src/routes/index.tsx`.

## A minimal shell

```tsx
// src/routes/index.tsx
import { createFileRoute, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import { Icon } from "gondol/design-system/bungalow-79d923";
import { ActionsProvider } from "gondol/apps/actions";
import { AppDeactivatedNotice } from "gondol/apps/components/AppDeactivatedNotice";
import { setAppActivation } from "gondol/apps/hooks";
import { ActiveAppsProvider, useActiveAppWidgets, useDynamicRoute } from "gondol/apps/navigation";
import { DragEntityProvider } from "gondol/entities/dragEntity";
import { resolveEntityUri, type EntityUriTarget } from "gondol/entities/uri";
import { useSlugRedirect } from "gondol/entities/useSlugRedirect";
import { validateDateRangeSearch, type DateRangeSearch, type SearchRouteSearch } from "gondol/navigation/dateRangeSearch";
import { GlobalFilterProvider } from "gondol/search/globalFilterState";
import { SearchPanel } from "gondol/search/SearchPanel";
import { AppShell, useNavCollapsed } from "gondol/shell/AppShell";
import { useChromeSearch } from "gondol/shell/ChromeSearch";
import { NavItem } from "gondol/shell/NavItem";
import { useTheme } from "gondol/theme/theme";

export const Route = createFileRoute("/")({
  validateSearch: validateDateRangeSearch,
  component: Home,
});

export function Home() {
  return (
    <DragEntityProvider>
      <GlobalFilterProvider>
        <ActiveAppsProvider>
          <Shell />
        </ActiveAppsProvider>
      </GlobalFilterProvider>
    </DragEntityProvider>
  );
}

function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useSearch({ strict: false }) as SearchRouteSearch;
  const navigate = useNavigate();
  const [navCollapsed, toggleNav] = useNavCollapsed();
  const { theme, setTheme } = useTheme();
  const match = useDynamicRoute(pathname);
  const { overviewWidgets } = useActiveAppWidgets();
  useSlugRedirect();

  // Every in-app navigation keeps the global search params (period and filter).
  const navigateTo = useCallback(
    (to: string) => navigate({ to, search: (prev: DateRangeSearch) => prev } as Parameters<typeof navigate>[0]),
    [navigate],
  );
  const openTarget = (target: EntityUriTarget) => {
    if (target.kind === "path") navigateTo(target.path);
    // target.kind === "entry": a shell-sheet type, see "Opening entities" below.
  };
  const openUri = (uri: string) => {
    const target = resolveEntityUri(uri);
    if (target) openTarget(target);
  };
  const chromeSearch = useChromeSearch({
    onSearchPage: pathname === "/search",
    routeQuery: search.q ?? "",
    openTarget,
  });

  return (
    <ActionsProvider
      navigate={navigateTo}
      toggleSidebar={toggleNav}
      toggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      pathname={pathname}
    >
      <AppShell
        search={chromeSearch}
        navCollapsed={navCollapsed}
        onToggleNav={toggleNav}
        navItems={
          <NavItem icon={<Icon name="home" />} label="Home" active={pathname === "/"} onClick={() => navigateTo("/")} />
        }
        drawerItems={(go) => (
          <NavItem icon={<Icon name="home" />} label="Home" active={pathname === "/"} onClick={() => go("/")} />
        )}
        onAdd={() => navigateTo("/notes/new")}
        addOpen={false}
        onNavigate={navigateTo}
        onOpenUri={openUri}
      >
        {pathname === "/" ? overviewWidgets.map((Widget, i) => <Widget key={i} />) : null}
        {pathname === "/search" ? <SearchPanel onOpenUri={openUri} /> : null}
        {match && pathname !== "/" ? (
          match.isActive ? (
            <match.feature.Page
              appId={match.appId}
              featureId={match.featureId}
              splat={match.subpath}
              onOpenUri={openUri}
              onNavigateFeature={(featureId, subpath) => {
                const feature = match.app.features.find((f) => f.id === featureId);
                navigateTo(feature ? `/${feature.path}${subpath ? `/${subpath}` : ""}` : `/app/${match.appId}/${featureId}`);
              }}
            />
          ) : (
            <AppDeactivatedNotice
              app={match.app}
              onActivate={() => setAppActivation(match.app.id, true)}
              onBackToApps={() => navigateTo("/")}
            />
          )
        ) : null}
      </AppShell>
    </ActionsProvider>
  );
}
```

That is a working shell: the sidebar lists every active app's features, the chrome search opens the
search page and entity URIs, the palette and shortcuts work, and every feature page renders at its
path.

## Provider order

| Provider | From | Why |
| --- | --- | --- |
| `DragEntityProvider` | `gondol/entities/dragEntity` | Shares the entity being dragged, for drop docks and highlights. |
| `GlobalFilterProvider` | `gondol/search/globalFilterState` | The global type, condition and period filter, read from the URL. |
| `ActiveAppsProvider` | `gondol/apps/navigation` | Nests every active app's `Providers`. |
| `ActionsProvider` | `gondol/apps/actions` | Actions, shortcuts and the palette; `AppShell` renders the palette. |

Anything your apps rely on everywhere (Spacify's `EntityCollectionsProvider` for library and
playlist actions) goes around these too.

## `AppShell` props

| Prop | Meaning |
| --- | --- |
| `search` | The chrome search field's state, from `useChromeSearch()`. |
| `children` | The current page. |
| `navCollapsed`, `onToggleNav` | The desktop sidebar's collapsed state, from `useNavCollapsed()`. |
| `navItems` | Your own items at the top of the navigation (`NavItem`s), before the apps' sections. |
| `navExtra` | Groups between the apps' sidebar widgets and the apps' sections. |
| `drawerItems(go)`, `drawerExtra(go)` | The same for the phone menu drawer; `go` navigates and closes it. |
| `onAdd`, `addOpen` | The "+ Add" button under the navigation, and whether its picker is open. |
| `onNavigate(path)`, `onOpenUri(uri)` | Used by nav items and widgets. |
| `topBarActions` | View-dependent header actions (filter buttons), left of `chromeActions`. |
| `chromeActions` | The header's own actions on the right (home, notifications, account menu). |
| `sidebarChromeActions` | Next to back and forward at the top of the sidebar, in the classic desktop layout. |
| `banners` | Strips under the header (update available, previews). |
| `filterStrip` | The strip above the content, such as `GlobalFilterBar`. |
| `contentFlush` | Drops the content padding for full-bleed pages. |
| `featureDot(target)` | Renders a "new feature" dot on `data-tour` targets; every `NavItem` asks it. |
| `overlays` | Sheets, drawers and guides rendered over everything. |

`NavItem` (`gondol/shell/NavItem`) is one item of the sidebar, tab bar and drawer. `extra` limits it to
the desktop sidebar, `mobileOnly` to the phone tab bar, `afterAdd` places it right of the plus button
on phones, `tourId` sets its `data-tour` key and `dot` shows an update dot.

## Rendering the current page

The shell picks its content from the path. A typical order, as in Spacify:

1. Fixed pages your app owns (`/`, `/search`, `/account`).
2. `/app/<id>/…`: an internal app inside its frame (`AppBundleView`), or an external app's iframe.
3. `/entity/<type>/<key>`: the generic view of any entity (see below).
4. `useDynamicRoute(pathname)`: a feature page, or `AppDeactivatedNotice`.

Before rendering a feature, check that the [site](./sites.md) allows its app:
`siteAllowsApp(site, match.app.id, (id) => getInternalApp(id)?.dependencies ?? [])`. `isActive`
already includes the site, so `AppDeactivatedNotice` covers both cases if you don't need a separate
message.

## Opening entities

Anything that opens an entity by URI goes through one function in the shell, so special cases live
in one place:

```ts
function openTarget(target: EntityUriTarget) {
  if (target.kind === "entry") {
    // A type registered with `shellSheetTypes`: the shell opens its own sheet for it.
    openEntrySheet(target.entryId);
    return;
  }
  navigateTo(target.path);
}
```

Pass it to `useChromeSearch` and to `SearchPanel`, widgets and feature pages as `onOpenUri`. The
chrome search field also opens URIs posted to the window as `{ type: "navigate", uri }`, which is how
a desktop shell (Electron, Tauri) deep-links into the app.

### Generic entity views

Entity types without a page of their own open at `/entity/<type>/<key>`, shown at `/<slug>/<key>` in
the address bar. Gondol resolves the row (`fetchEntityRow(type, key)`) and related rows
(`fetchEntitiesWhere`, `fetchEntitiesById`), and lists the sub-views a generic page can have
(`ENTITY_VIEW_TABS`, `entitySectionSlug`, `isEntitySection`). Rendering the view is up to your app;
Spacify's `EntityView` is an example.

## Other shell pieces

| Module | What it is |
| --- | --- |
| `gondol/shell/EmptyState` | The "nothing here" placeholder for an empty list, with a create button. |
| `gondol/shell/Spinner`, `SimpleSpinnerIcon` | Loading indicators. |
| `gondol/shell/Walkthrough` | A spotlight tour over `data-tour` targets. |
| `gondol/shell/MobileNavDrawer` | The phone menu drawer (`AppShell` renders it). |
| `gondol/shell/clipboard` | `copyText(text, success, failure)` and `showToast(message)`. |
| `gondol/navigation/NavigationProgress` | Keeps the current page on screen with a progress bar until the next page's data has loaded. Render it once in the root route. |
| `gondol/shell/dataTableLabels` | `installDataTableLabels()` annotates every `.data-table`'s cells so tables render as list rows on phones. Call it once from the root route. |
| `gondol/shell/registerServiceWorker` | Registers `/sw.js` in production builds (not in the desktop app). |
| `gondol/shell/developerMode` | Native context menu and selection only in developer mode; see [Platform](./platform.md). |
