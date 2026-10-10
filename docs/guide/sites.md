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

| Field | Meaning |
| --- | --- |
| `enabled_apps` | App ids that are on (plus their dependencies), or null for all. |
| `layout` | `SiteLayout`: `desktopLayout`, `classicFrame`, `layoutStyle`, and `homePath` (where `/` goes). |
| `theme` | `SiteTheme`: an engine and user theme, a colour scheme (`mode`), an `accentColor`, and `allowPersonal` (visitors may use their own theme there). Each part is optional. |
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
- **Theme and layout.** `UserThemeProvider` applies the site's engine, theme, colour scheme, accent
  and layout while the visitor is on it; their own settings stay stored. When the site sets
  `allowPersonal`, `SiteThemeNotice` (`gondol/theme/SiteThemeNotice`, put it above your appearance
  settings) lets the visitor switch to their own theme there, remembered per site and device
  (`useUserTheme().usingPersonalTheme`); otherwise it says the site's theme applies.
- **Features and actions.** Features, palette actions and `ActionMenu` items the site's roles and
  aspects don't cover are left out; see below.
- **Entities.** `useEntitySearch`, `SearchPanel` and pickers only return entities the site shows.
  Use `useSiteEntityFilter()` to apply the same filter to your own lists, or `siteShowsEntity(site,
  row)` and `siteAllowsType(site, type)` for single checks.
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
