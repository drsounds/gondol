# Sites

A site is one configuration of your app per domain. The site served on the current host decides
which apps are on, who may use it, the page's base layout, a theme that replaces the visitor's own,
and which entities show up. One deployment can then serve, say, a full workspace on `app.example.com`
and a public wiki on `docs.example.com`.

Storing and editing sites is your app's job (Spacify has a `sites` table and a Sites app). Gondol
resolves the current site and applies it.

## Resolving the site

`SiteProvider` (`gondol/sites/sites`), in the root route, calls `site_for_domain(domain)` for the
current host. It works before sign-in, so the sign-in page already wears the site's theme. The
answer is cached per domain and account, so a reload doesn't flash every app before the site loads.

`?site=<domain>` previews another domain's site on any host; the preview is remembered for the tab
and `?site=` with no value ends it.

```tsx
const { site, domain, loading, previewing, endPreview } = useSite();
```

`site` is a `SiteConfig`, or null when no site is configured for the domain (then nothing is
restricted).

When a site is resolved, its name becomes the browser tab title and its domain supplies the favicon.

| Field | Meaning |
| --- | --- |
| `name`, `domain` | The browser tab title and the domain used to find the site's favicon. |
| `enabled_apps` | App ids that are on (plus their dependencies), or null for all. |
| `layout` | `SiteLayout`: `homePath` (where `/` goes) and the [visitor preferences](#visitor-preferences) the site sets (`desktopLayout` + `classicFrame`, `layoutStyle`, `locale`, `player`, `darkTabBar`, `darkFrame`, `savedIcon`, `sheetStyle`, `tableLines`, `highContrast`, `hideSoftDeletedEntities`, `hideFutureEntities`, `developerMode`), with `locked` listing the ones visitors can't change. |
| `theme` | `SiteTheme`: an engine and user theme, a colour scheme (`mode`) and an `accentColor` (a colour, `"foreground"` or `"theme"`), with `locked` listing the parts visitors can't change. Each part is optional. |
| `master_domain` | The domain of the owner's master site, which OAuth flows on all of their sites go through (`oauthReturnUrl`), or null. |
| `roles`, `aspects` | The [roles and aspects](#roles-and-aspects) of the apps the site offers, or null for all. |
| `entity_types`, `conditions`, `condition_match` | Which entities show up, with the same conditions as the [global filter](./search-and-filters.md#conditions). |
| `restricted`, `is_member`, `is_owner` | Whether the site is limited to its owner and linked accounts, and the caller's standing. |
| `allow_anonymous` | Visitors without an account may browse the owner's public entities. |

## What a site changes

- **Apps.** `useAppBundle`, `useRegisteredBundles` and `useActiveBundles` treat apps the site
  leaves out as off (`siteDisabled`), whatever the user's own switch says, so they vanish from the
  navigation, palette and widgets. Check `siteAllowsApp(site, appId, dependencies)` before rendering
  a feature to show a "not on this site" message instead.
- **Theme and layout.** Each part of the site's theme (`SITE_THEME_PARTS`: `engine` with its
  theme, `mode`, `accentColor`) works like a visitor preference: a default for visitors who haven't
  picked their own, or, listed in `theme.locked`, what everyone gets there
  (`isSiteThemeLocked()`, `useSiteThemeLock(part)`, `<SiteLockHint themePart=…/>`). A theme saved
  before `locked` locks every part it sets unless it has the old `allowPersonal`.
  `useUserTheme().fromSite` says which parts come from the site right now and `applied` holds the
  engine, colour scheme and accent in effect; the visitor's own settings stay stored.
- **Preferences.** See [Visitor preferences](#visitor-preferences).
- **Features and actions.** Features, palette actions and `ActionMenu` items the site's roles and
  aspects don't cover are left out; see below.
- **Entities.** An entity type shows on a site when it's among the site's entity types, the app it
  belongs to is enabled there (or is a dependency of one that is), and the site offers that app
  feature's roles and aspects: `siteShowsType(site, type)`. A type belongs to the feature whose path
  (or alias) is the longest prefix of its edit sheet, else its own page; list it in the feature's
  manifest `entityTypes` when neither says. `useEntitySearch`, `SearchPanel` (recents too) and
  pickers only return entities the site shows, and `ActionMenu` hides any `.action-row` whose `uri`
  it doesn't, so mixed lists (library, playlists) leave them out entirely. Use
  `useSiteEntityFilter()` to apply the same filter to your own lists, `useSiteShows()` for URIs and
  types, or `siteShowsEntity(site, row)` / `siteShowsType(site, type)` for single checks.
- **Home.** Redirect `/` to `site.layout.homePath` in your shell when it is set.

## Master site and OAuth

An owner can make one of their sites the master site. Sign-ins and other third-party
authentication on any of their sites then return through the master's domain, so providers only
need that one callback address. Pass the provider your return address through
`oauthReturnUrl(target)` (the current site by default): on a sub-site it becomes `https://<master>/auth/relay?to=<target>`
(`oauthRelayUrl(master)` without a target, for providers that carry it elsewhere). The app serves
`/auth/relay`: it checks that the target is one of the master owner's sites and redirects there
with the provider's query, and the browser keeps the fragment.

## Roles and aspects

Two dimensions tag what an app declares (`gondol/sites/capabilities`):

- **Roles**, who it is for: `admin`, `analytics`, `creator`, `curator`, `operator`, `consumer`.
- **Aspects**, what kind of work it does: `view`, `create`, `edit`, `organize`, `share`,
  `analyze`, `configure`, `delete`.

A site lists the roles and aspects it serves. Something tagged is offered when, in each dimension,
it shares a value with the site; an untagged dimension, or a site that leaves one unset, is always
offered. So nothing disappears until it is tagged, and a site with no roles or aspects shows
everything.

Where to tag:

| What | How |
| --- | --- |
| A feature | `"roles"`/`"aspects"` on its entry in `manifest.json` (or on the manifest, for every feature), or on the `AppFeature`. `featureCapability(app, feature)` merges them. |
| A palette action | `roles`/`aspects` on the `AppAction`; a feature's actions take the feature's tags otherwise. |
| A menu item | `roles`/`aspects` on the `MenuAction`. Untagged items keyed `edit`, `delete`, `open`, `play`, … get an aspect from `DEFAULT_ACTION_ASPECTS`. |

`useAppNavigation` drops features the site doesn't offer (and apps left with none), the actions
palette drops their actions, `ActionMenu` drops the items, `FormActions` hides Delete without the
`delete` aspect, and without the `create` aspect the plus button, each list header's add button
(the primary button in a `.panel-head`, hidden through `data-site-create="off"` on `<html>`), the
`EmptyState` action and `useEntityModal`'s create sheet all go; and `useDynamicRoute` sets `offeredBySite` so the shell can show "not on this
site". Use `useSiteOffers()` (or `siteOffers(site, capability)`) to gate anything else. This is
the interface only: data stays under each table's own access rules.

Domains are compared lower-case without scheme, port, path or a leading `www.`
(`normalizeSiteDomain`); `SITE_DOMAIN_PATTERN` validates one, and `toSiteConfig(row)` turns a raw
`site_for_domain()` row into a `SiteConfig`.

## Visitor preferences

Every Account option besides the theme can be set per site in `SiteLayout` (`gondol/sites/preferences`,
`SITE_PREFERENCES`). A value the site sets is a default for visitors who haven't picked their own;
listed in `layout.locked` it is what everyone gets there. A layout saved before `locked` existed
locks `desktopLayout` and `layoutStyle` (they used to always win) and nothing else.

- `resolveSitePreference(layout, key, own)` gives the value in effect, `isSitePreferenceLocked()`
  whether the visitor's own is ignored, and `useSitePreferenceLock(key)` the same for the site
  served here. Put `<SiteLockHint preference=…/>` under a setting and disable it while locked.
- `useUserTheme().preferences` holds the shell preferences in effect (desktop layout, dark tab bar
  and frame, saved icon, player, hidden entities); the theme engine, `useSavedIconStyle()`,
  `useEntityLifecycle()` and `AppShell` read it. `I18nProvider` applies `locale`, and SiteProvider
  passes `developerMode` to the browser's developer mode.
- `sheetStyle` is `modal` (the default) or `page`: edit sheets cover everything, edge to edge
  (`data-sheet-style="page"` on `<html>`). `tableLines` draws lines between data table rows
  (`data-table-lines`), and `highContrast` limits every colour token to the foreground and the
  background (`data-high-contrast`, `styles/base.css`).
- `player` is `always`, `auto` (only while something plays or is queued: the bottom widgets get
  `alwaysShow={false}`) or `hidden` (`AppShell` renders no bottom widgets).
- To edit a theme that isn't the visitor's own (a site's), wrap `AppearanceSettings`,
  `AeroThemeSettings` or `TuiThemeSettings` in `<ThemeEditorProvider value={…}>`
  (`gondol/theme/userTheme`); without `saveCurrentTheme`/`deleteSavedTheme` the visitor's saved
  themes can only be applied.
