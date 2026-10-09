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
| `theme` | `SiteTheme`: an engine and a user theme applied instead of the visitor's. |
| `entity_types`, `conditions`, `condition_match` | Which entities show up, with the same conditions as the [global filter](./search-and-filters.md#conditions). |
| `restricted`, `is_member`, `is_owner` | Whether the site is limited to its owner and linked accounts, and the caller's standing. |
| `allow_anonymous` | Visitors without an account may browse the owner's public entities. |

## What a site changes

- **Apps.** `useAppBundle`, `useRegisteredBundles` and `useActiveBundles` treat apps the site
  leaves out as off (`siteDisabled`), whatever the user's own switch says, so they vanish from the
  navigation, palette and widgets. Check `siteAllowsApp(site, appId, dependencies)` before rendering
  a feature to show a "not on this site" message instead.
- **Theme and layout.** `UserThemeProvider` applies the site's engine, theme and layout while the
  visitor is on it; their own settings stay stored.
- **Entities.** `useEntitySearch`, `SearchPanel` and pickers only return entities the site shows.
  Use `useSiteEntityFilter()` to apply the same filter to your own lists, or `siteShowsEntity(site,
  row)` and `siteAllowsType(site, type)` for single checks.
- **Home.** Redirect `/` to `site.layout.homePath` in your shell when it is set.

Domains are compared lower-case without scheme, port, path or a leading `www.`
(`normalizeSiteDomain`); `SITE_DOMAIN_PATTERN` validates one, and `toSiteConfig(row)` turns a raw
`site_for_domain()` row into a `SiteConfig`.
