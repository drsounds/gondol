# App settings

An app can have settings of its own: what the user, a site's owner or a workspace's admins can
choose for it. The app declares them in its `manifest.json`, gondol stores their values, and one
component, `<AppSettingsPanel>`, edits them wherever the host shows settings: in the user's
account, in a site's settings and in a workspace's.

## Declaring settings

Settings live under `settings` in the manifest, laid out the way they're shown:

- **sections**: a titled group of settings,
- **settings**: one value each, of a [type](#setting-types),
- **submenus**: a row that opens a page of its own sections (and further submenus), like a
  submenu in iPhone settings.

```json
{
  "id": "notes",
  "settings": {
    "scope": ["user", "workspace", "site"],
    "sections": [
      {
        "id": "editor",
        "title": { "en": "Editor", "sv": "Redigerare" },
        "settings": [
          { "key": "fontSize", "type": "number", "label": { "en": "Font size" }, "min": 10, "max": 32, "unit": "px", "default": 15 },
          { "key": "spellcheck", "type": "checkbox", "label": { "en": "Check spelling" }, "default": true, "scope": "user" }
        ]
      }
    ],
    "submenus": [
      {
        "id": "sync",
        "title": { "en": "Sync" },
        "description": { "en": "Where notes are backed up" },
        "iconName": "globe",
        "sections": [
          {
            "id": "server",
            "settings": [
              { "key": "sync.url", "type": "string", "format": "url", "label": { "en": "Server address" } }
            ]
          }
        ]
      }
    ]
  }
}
```

`defineApp` validates the block along with the rest of the manifest: unknown fields, a duplicate
setting key, section or submenu id, a `default` that isn't one of the options, or a `min` above
`max` fail with a message naming the place. A bundle built by hand (without `defineApp`) is
checked the first time its settings are read.

### Setting types

| `type` | Control | Value | Its own fields |
| --- | --- | --- | --- |
| `select` | A dropdown, or radio buttons with `"display": "radio"` | One option's `value` | `options` (`value`, `label`, `description?`), `display`, `default` |
| `checkbox` | One checkbox | `true` / `false` | `default` |
| `checkboxes` | A checkbox per option | The ticked options' values | `options`, `default` (a list) |
| `text` | Free text over several lines | A string | `rows`, `maxLength`, `placeholder`, `default` |
| `string` | One line: plain, `url`, `email` or `password` (masked) | A string | `format`, `pattern` (a regular expression the whole value must match), `maxLength`, `placeholder`, `default` |
| `number` | A number field | A number | `min`, `max`, `step`, `integer`, `unit`, `placeholder`, `default` |

Every setting has a `key` (unique in the app, never change it: it's what values are stored under),
a localized `label`, an optional `description` and an optional `scope`.

### Scopes

A setting is stored at one or more scopes:

| Scope | Whose | Edited in | Who can change it |
| --- | --- | --- | --- |
| `user` | The signed-in account | Account | The user |
| `workspace` | The open workspace | The workspace's settings | Its admins and owners |
| `site` | The site served on this domain | The site's settings | Its owner |

`scope` is a scope or a list of them. A setting without one takes its section's, a section its
submenu's, a submenu the `settings` block's, and the block defaults to `user`. A setting stored at
several scopes takes the most specific value there is: the user's, else the workspace's, else the
site's, else its `default`. So `"scope": ["user", "site"]` lets a site's owner set a default for
everyone there that each user can still change.

Values at the `site` and `workspace` scopes are read by everyone they apply to: never put secrets
there. A secret (an API key) belongs at the `user` scope, with `"format": "password"`.

## Reading values

```ts
import { useAppSetting, useAppSettings } from "gondol/settings/settings";

const fontSize = useAppSetting<number>("notes", "fontSize"); // 15 unless someone set it

const { values, sources, isLoading } = useAppSettings("notes");
values["sync.url"]; // the value in effect
sources["sync.url"]; // "user" | "workspace" | "site" | "default"
```

The values come from the signed-in user, the site served here and the open workspace (see
[Workspaces](#workspaces)). Each scope's values are one query (`useScopeSettings(scope, id)`),
shared by every app.

To change one from a control of your own, `useSaveAppSetting(scope, scopeId)` returns a mutation:
`mutate({ appId, key, value })` sets it, `value: undefined` clears it (falling back to the next
scope). `useSettingsScopeIds()` gives the ids of the account, site and workspace in effect here.

## Showing the settings

```tsx
import { AppSettingsPanel } from "gondol/settings/AppSettingsPanel";

// Account: the signed-in user's settings of every app that is on.
<AppSettingsPanel scope="user" />

// A site's settings sheet: that site's values.
<AppSettingsPanel scope="site" scopeId={site.id} />

// A workspace's sheet; members who can't manage it see the values but can't change them.
<AppSettingsPanel scope="workspace" scopeId={workspace.id} readOnly={!canManage} />

// One app's settings only, inside the app.
<AppSettingsPanel scope="user" appIds={["notes"]} title={null} />
```

The panel lists every app with settings at the scope; an app opens its sections and submenu rows,
a submenu its own, with a back button. Only the settings stored at `scope` are shown. Each change
is saved as it's made (text, strings and numbers when the field loses focus or on Enter); an
invalid value is shown with the problem and not saved. In Account, a setting without a value of
the user's shows what applies instead (the workspace's, the site's or the default), with a Reset
button once the user has set their own.

| Prop | Default | |
| --- | --- | --- |
| `scope` | (required) | `user`, `workspace` or `site`. |
| `scopeId` | The account, open workspace or site served here | Whose values to edit. `null` shows them disabled (e.g. a site not saved yet). |
| `readOnly` | `false` | Shows the values without letting them change. |
| `appIds` | Every app with settings at the scope (Account: only apps that are on) | Limit it to some apps; with one, the panel opens straight into it. |
| `title` | "App settings" | The heading; `null` for none. |

The styles are in `gondol/styles/settings.css` (part of `gondol.css`).

## Workspaces

Gondol has no workspaces of its own. If your app has them, tell gondol which one is open, so
workspace-scoped values apply:

```ts
configureGondol({
  // …
  settings: { useWorkspaceId: () => useActiveWorkspace().id },
});
```

`useWorkspaceId` is a hook (it runs inside components), returning the open workspace's id or
`null`. Without it, workspace-scoped settings fall back to the site's values and the defaults.

## The table

Values live in one table, `app_settings`, one row per app and scope, whose `data` is an object of
values by setting key:

| Column | |
| --- | --- |
| `id` | `uuid`, primary key |
| `app_id` | The app's id |
| `scope` | `user`, `site` or `workspace` |
| `scope_id` | The account's, site's or workspace's id |
| `data` | `jsonb` object: values by setting key |
| `updated_by` | The account that saved it last |
| `created_at`, `updated_at` | Timestamps |

with a unique `(app_id, scope, scope_id)` (the panel upserts on it). Row-level security decides who
reads and writes each scope; in Spacify, `app_settings_can_read(scope, scope_id)` and
`app_settings_can_write(scope, scope_id)` implement the table [above](#scopes):

```sql
create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  app_id text not null,
  scope text not null check (scope in ('user', 'site', 'workspace')),
  scope_id uuid not null,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, scope, scope_id)
);

alter table public.app_settings enable row level security;
create policy "read" on public.app_settings for select to authenticated
  using (public.app_settings_can_read(scope, scope_id));
create policy "insert" on public.app_settings for insert to authenticated
  with check (public.app_settings_can_write(scope, scope_id));
create policy "update" on public.app_settings for update to authenticated
  using (public.app_settings_can_write(scope, scope_id)) with check (public.app_settings_can_write(scope, scope_id));
create policy "delete" on public.app_settings for delete to authenticated
  using (public.app_settings_can_write(scope, scope_id));
```

Spacify's migration `20261022210000_app_settings_and_ai.sql` has the whole thing, functions included.
