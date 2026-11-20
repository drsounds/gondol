# The Service Finder app

`gondol/builtin/service-finder` finds MCP servers in MCP registries and installs them for the user.
Installed servers are the ai app's MCP servers (`ai_mcp_servers`, see [the ai app](./ai.md#the-users-own-mcp-servers)):
the one list the AI chat and every [agent](./agents.md) draw their tools from, through the app
router's `/mcp`. It depends on the ai app.

```ts
import { serviceFinderApp } from "gondol/builtin/service-finder";
configureGondol({ apps: [...apps, aiApp, serviceFinderApp] });
// or with the Vite plugin: gondolApps({ builtin: ["ai", "service-finder"] })
```

## Pages

| Path | Feature | |
| --- | --- | --- |
| `/service-finder` | `finder` | Searches the registry picked (remembered per device), latest versions only, a page at a time. "Only servers that run here" (on by default) hides servers without a Streamable HTTP remote. |
| `/service-finder/servers/<registry name>` | `finder` | A server's sheet: what it is, how it runs, its packages; for a hosted one, the fields to install it with. An installed server is updated in place (newer version, address), its saved headers kept unless replaced. |
| `/mcp-servers`, `/mcp-servers/new`, `/mcp-servers/<id>/edit` | `installed` | The installed servers, the same list and sheets as on `/ai-models`. |
| `/mcp-registries`, `/mcp-registries/new`, `/mcp-registries/<id>/edit` | `registries` | The registries. Built-in ones are read-only. |

## Registries

A registry speaks the MCP registry's v0 API (`registryApiBase()` adds `/v0` to its address):
`GET /v0/servers?search=&cursor=&limit=&version=latest` and
`GET /v0/servers/{name}/versions/latest` (`listRegistryServers()`, `getRegistryServer()`). The
browser asks it directly, so a registry of your own must allow that (CORS); the official one
(`https://registry.modelcontextprotocol.io`) answers any origin.

## Installing

Only a server's `streamable-http` remote can be installed (`installableRemote()`): the app router
calls servers for the user, server-side, over Streamable HTTP. SSE-only servers and servers that
only ship packages (npm, PyPI, OCI, …, run on one's own computer) are shown but can't be installed.
`installFields()` turns the remote's URL `{variables}` and headers into the sheet's fields (a header
template such as `Bearer {api_key}` asks for `api_key`; a header without a value is asked for
whole), and `resolveInstall()` fills them in. Headers go to `set_ai_mcp_server_headers()`, so they
stay on the server like any MCP server's.

## The tables

| Table | Columns |
| --- | --- |
| `mcp_registries` | `id`, `user_id` (default `auth.uid()`; null: built in, read by everyone, written by no one), `name`, `url`, `description`, `kind` (`mcp-v0`), `enabled`, `position`, `created_at`, `updated_at` |
| `ai_mcp_servers` (the ai app's) | adds `registry_id` (set null when the registry goes), `registry_server` (its name there), `registry_version`, `website_url`, `repository_url`, `icon_url` |

Users read the built-in registries and their own, and write only their own. Spacify's migration
`20261024190000_service_finder.sql` creates the table, seeds the official MCP registry
(`00000000-0000-4000-8000-00000000c0de`) and adds the columns.
