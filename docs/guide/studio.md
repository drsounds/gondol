# The studio app

Gondol's built-in `studio` app holds lightweight apps that users build, or ask agents to build,
from [generative UI](./genui.md):

- An **app** (`lite_apps`, entity type `lite_app`) has a name, a description, an icon, whether it
  is in the main menu, instructions for the agents that change it and its builder (`builder_uri`,
  the agent that built it).
- Its **pages** (`lite_app_pages`) are one document each, in A2UI, Open-JSON-UI or MCP-UI, at
  `/lite/<app>/<page>`. Every app with pages becomes an app bundle of its own at run time
  (`registerDynamicApps("studio", …)`), so its pages route and are entries in the main menu like any
  app's. Those bundles follow the studio app's site settings (`partOf: "studio"`).
- Its **entity types** (`lite_entity_types`) have typed fields (text, long text, number, integer,
  yes/no, date, date and time, URL, e-mail, choice, choices and entity), and **relations**
  (`lite_entity_relations`) link a type to another of the app's types or to any entity type of the
  host, one or many.
- Its **records** (`lite_records`, entity type `lite_record`) are entities like any other:
  searchable, taggable, in playlists and the library. A record's `data` is a jsonb object keyed by
  field and relation keys.

## Switching it on

```ts
import { studioApp } from "gondol/builtin/studio";

configureGondol({ apps: [...myApps, studioApp] });
// or: gondolApps({ dir: "apps", builtin: ["studio"] })
```

Pass `--builtin studio` to `gondol-api` too, so its tools are served on `/mcp`.

## Pages

| Path | |
| --- | --- |
| `/studio` | The user's apps. |
| `/studio/new`, `/studio/ask` | A new app; asking an agent to build one. |
| `/studio/<app>` | An app's pages, entity types and relations. |
| `/studio/<app>/edit`, `/studio/<app>/ask` | Editing the app; asking an agent to change it. |
| `/studio/<app>/{pages,types,relations}/{new,<key>/edit}` | The routed sheets. The page sheet previews the page live. |
| `/studio/records/<key>` | Where a `lite_record` URI points: forwards to the record's sheet on its app's first page. |
| `/lite/<app>/<page>` | A page of a built app. |
| `/lite/<app>/<page>/records/{new/<type>,<key>/edit}` | A record's sheet. |

## What a page can do

Every page's data model holds `/app`, `/page`, `/types` (each type's name and fields) and
`/records/<type key>` (its records, newest first, each with `id`, `uri`, `title` and its fields).
On top of A2UI's catalogue, pages get `RecordList {type, title?}` (a type's records with New, Edit
and Delete) and `RecordForm {type, submitLabel?}`.

Button actions the page runs itself: `create_record {type, …fields}`, `update_record {id, …fields}`,
`delete_record {id}`, `new_record {type}` and `edit_record {id}` (open the sheets),
`navigate {page}` or `{path}` and `open_uri {uri}`. MCP-UI views call the same names as tools
(`mcpUi.tool("create_record", {...})`), and any app router tool. Any other action, and a view's
prompts, go to the app's builder.

## Agents

Agents build apps with the app's MCP tools (`studio__list_apps`, `get_app`, `save_app`, `save_page`,
`save_entity_type`, `save_relation`, `list_records`, `save_record`, the `delete_*` ones), whose
instructions describe the three formats. "Ask an agent" reaches the host's agents through
`studioAgentsHook`:

```ts
import { answer } from "gondol/apps/contributions";
import { studioAgentsHook } from "gondol/builtin/studio";

answer(studioAgentsHook, {
  useAgents: () => ({ agents: [{ id, name, description, uri }], loading: false }),
  ask: async ({ agent, prompt, title }) => "/where/to/follow/it",
});
```

Without an answer, the request opens in the AI chat (`/ai/new`) instead.

## The tables and functions

The host's migration creates the five tables (each owned through a `(app_id, user_id)` foreign key
to `lite_apps`, with RLS to their owner), checks records against their type
(`lite_records_check()`: required fields, numbers, yes/no and lists; it also keeps `title` from the
type's title field) and adds the `api_studio_*` functions the tools call (SECURITY INVOKER, so RLS
applies). Spacify's is `supabase/migrations/20261024190000_app_studio.sql`.
