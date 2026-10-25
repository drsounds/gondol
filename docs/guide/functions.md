# App functions and MCP

An app can let other code call it on the server: other apps, HTML5 apps, scripts and AI models. It
declares **functions** in its manifest, and what it offers AI models over the
[Model Context Protocol](https://modelcontextprotocol.io) as **`mcp`**. One edge function, the
**app router**, serves them all:

```
caller (an app, a script, the ai app, Claude Desktop, …)
  │  Authorization: Bearer <the user's session, or an OAuth access token>
  ▼
app-router (an edge function)              ← apps.json: every app's `functions` and `mcp`
  ├─ GET  /apps                            the catalogue: apps, their functions and tools
  ├─ POST /apps/<app>/functions/<name>     a function → its Postgres function or edge function
  ├─ POST /mcp                             every app's tools as one MCP server
  └─ POST /apps/<app>/mcp                  one app's (and its own MCP server's, proxied)
```

## Declaring functions

`functions` in `manifest.json`, by name (snake case):

```json
"functions": {
  "create_idea": {
    "title": "Note an idea",
    "description": "Create an idea with a title and, optionally, a description and status.",
    "rpc": "api_create_idea",
    "input": {
      "type": "object",
      "additionalProperties": false,
      "required": ["title"],
      "properties": {
        "title": { "type": "string", "minLength": 1, "maxLength": 200 },
        "status": { "type": "string", "enum": ["new", "exploring", "planned"] }
      }
    }
  },
  "summarize_week": {
    "description": "Summarize the ideas of the last week.",
    "function": "ideas-summary",
    "readOnly": true
  }
}
```

| Key | |
| --- | --- |
| `description` | What it does, for developers and AI models (English). Required. |
| `title` | A short name. |
| `rpc` | A Postgres function that answers it, called **as the user** (RLS applies) with one argument per input field, `p_` plus the name in snake case, exactly like an [app API](./api.md) operation. |
| `function` | Or an edge function: it gets the input as its JSON body, the caller's token as `Authorization` (for OAuth callers a one-minute JWT for the user) and `x-gondol-app` / `x-gondol-function` headers. |
| `input` | A JSON Schema for the input object; the router checks every call against it. `#/components/schemas/<name>` refers to the app API's shared schemas. |
| `output` | What it answers with (documentation; MCP clients see it in the catalogue). |
| `scopes` | OAuth scopes a token needs (all of them; declare them in the app's `api.scopes`). Left out: any signed-in caller. `[]`: anyone, also signed out. |
| `readOnly` | It only reads: the AI may run it without asking. |
| `destructive` | It deletes or overwrites: the AI always asks first. |

A function answers `POST /app-router/apps/<app>/functions/<name>` with the input as JSON. Errors are
[problem details](https://www.rfc-editor.org/rfc/rfc9457) with the status from the SQLSTATE, as in
the app API (`P0002` → 404, `42501` → 403, `22023` → 422, …).

From the browser, as the signed-in user:

```ts
import { callAppFunction } from "gondol/api/client";

const idea = await callAppFunction("ideas", "create_idea", { title: "Fly to the moon" });
```

## Offering tools to AI models (`mcp`)

```json
"mcp": {
  "instructions": "Ideas are things the user wants to remember and follow up. Note one when the user says they had an idea.",
  "tools": [
    { "name": "create_idea", "function": "create_idea" },
    { "name": "get_stream", "operation": "getStream" }
  ],
  "endpoint": {
    "url": "https://mcp.example.com/mcp",
    "headers": { "Authorization": "EXAMPLE_MCP_TOKEN" }
  }
}
```

| Key | |
| --- | --- |
| `instructions` | What the app is for and when to use its tools, told to models (MCP's `initialize` instructions; the ai app adds them to the conversation's). |
| `tools` | Each runs one of the app's `functions` or one `operation` of its [`api`](./api.md) (by `operationId`: its parameters and body fields become the tool's arguments, its scopes the tool's). `description`, `title`, `inputSchema`, `readOnly` and `destructive` override what the function or operation says. A `get` operation is read-only and a `delete` destructive unless the tool says otherwise. |
| `endpoint` | An MCP server of the app's own (Streamable HTTP). The router proxies it: its tools join the app's. `headers` name server **secrets** (env vars), never values. |

The router serves the tools as MCP servers (protocol 2025-06-18, also 2025-03-26 and 2024-11-05;
JSON answers over POST, no sessions or event stream):

- `/mcp`: every app's tools, named `<app>__<tool>` (`ideas__create_idea`), described as
  `<App>: <description>`, and every app's instructions in `initialize`.
- `/apps/<app>/mcp`: one app's, by their own names.

`tools/list` only lists the tools the token may call. A tool's failure (a wrong argument, a missing
scope, the function raising) is a result with `isError: true`, so the model can read it and try
again; an unknown tool or method is a JSON-RPC error.

An MCP client outside the app (Claude Desktop, an agent) connects to `/mcp` with an OAuth access
token from the [oauth app](./oauth.md). The router answers a call without a token with `401` and
`WWW-Authenticate: Bearer resource_metadata=…`, its
[protected resource metadata](https://www.rfc-editor.org/rfc/rfc9728) names the app API as the
authorization server, and the app API serves its endpoints at
`/.well-known/oauth-authorization-server` ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)).
Clients aren't registered dynamically: create the credentials at `/oauth`.

## The ai app finds them

The [ai app](./ai.md) is an MCP client of `/mcp`: with the `appTools` setting on (the default) and a
provider that calls tools (Ollama and OpenAI-compatible APIs both do), the model gets every app's
tools and their instructions. When it calls one the chat runs it through the router as the user,
asking first when the `toolApproval` setting says so (`changes`: tools that aren't read-only;
`always`; `never`), and hands the result back until the model answers. The answer notes the tools
it used. The chat's **Apps** button lists what the AI can use.

## gondol's own tools: apps and entities

For a caller with their own session (the ai app, not OAuth clients), `/mcp` also serves two groups
of tools of gondol's own, so a model can work with any app without the app writing tools for it:

| Tool | |
| --- | --- |
| `apps__list_apps` | The apps the user has: what each is for, its pages (features, with paths), entity types and the names of its functions. |
| `apps__describe_app` | One app in full: features with their palette actions (`navigate`, `shortcut`), entity types with their addresses (`slug`, `view`, `edit`), functions with their input. |
| `apps__call_function` | Runs any of an app's `functions` as the user, also ones that aren't tools (the input is checked like a direct call). Not read-only, so the chat asks first. |
| `entities__list_types` | Every entity type: its table, the app it belongs to, the field that names it, whether deletes go to the trash, what the user may do (read, create, update, delete). |
| `entities__describe_type` | A type's fields (type, required, writable, default, enum values, what a foreign key points at, URI fields), check constraints, the types pointing at it, and the row level security policies. |
| `entities__search` | Full-text search over everything the user can see. |
| `entities__list` | One type's rows, filtered by `conditions` (`[{field, op, value}]`, ops `eq` … `not_empty`, dates as `{{today+7}}`) matched `all` or `any`, words in the label, ordered and paged. |
| `entities__get` | One entity with its fields, what its references point at, what points at it and its tags. |
| `entities__create`, `entities__update` | Writes field values (never the row's identity, owner, timestamps, trash or workspace, nor secret-looking columns). |
| `entities__delete`, `entities__restore` | To the trash and back; `permanent` deletes for good (destructive: the chat always asks). |

The `apps__` tools read the registry: `gondol-api` puts every app's features, actions and entity
types in `apps.json` next to its functions. Turn them off with `discovery: false`.

The `entities__` tools (`entities: true`, on in gondol's edge function unless
`APP_ROUTER_ENTITIES=false`) don't know the host's schema: each calls a Postgres function of the
host's **entity API** as the user (`ENTITY_API_FUNCTIONS`: `entity_api_types`,
`entity_api_describe`, `entity_api_search`, `entity_api_list`, `entity_api_get`,
`entity_api_create`, `entity_api_update`, `entity_api_delete`, `entity_api_restore`), with the tool's
arguments as `p_<name>` and `p_allowed_types`. They must be SECURITY INVOKER, so row level security
decides exactly what the model may read and change: the user's rights in the app, no more. Entities
are addressed by `uri` (`<scheme>:<type>:<id, identifier or slug>`) or `type` + `key`. Spacify's
are in its migration `20261023230000_entity_api.sql`.

Two request headers narrow what the router serves on `/mcp` and in the catalogue: `x-gondol-apps`
(comma-separated app ids: only those apps' tools, and only they are discovered and callable) and
`x-gondol-entity-types` (only those entity types, as `p_allowed_types`). The ai app sends the apps the
user has on and, on a [site](./sites.md), the entity types the site shows (`useAppRouterScope()`,
`setAppRouterScope()` in `gondol/api/client`). They only ever narrow: the database still decides.

## Building and deploying the router

`gondol-api` (see [App APIs](./api.md)) writes the router's files next to the gateway's:

```sh
bun node_modules/gondol/src/api/cli.ts --apps src/apps --builtin ai,oauth,streams \
  --out supabase/functions/_shared/gondol-api --functions supabase/functions
```

- `apps.json`: every app's `functions` and `mcp` (and its features, actions and entity types, for discovery), resolved (`buildAppRegistry()`): tools point at
  their Postgres or edge function, refs are inlined. It refuses a tool naming a function or
  operation the app doesn't have, a scope no app declares and an app with the id `apps` or `entities`.
- `router.ts`: the router, `createAppRouter()`; it only imports `gateway.ts` beside it.
- with `--functions <dir>`: `<dir>/app-router/index.ts`, gondol's Supabase edge function for it
  (`supabase/functions/app-router` in gondol). It takes the user's Supabase session (a JWT) as a
  first-party caller with every scope, and the app API's opaque OAuth tokens through
  `oauth_authenticate()`.

`--check` fails when any of them is out of date. Deploy the function with `verify_jwt = false`
(OAuth tokens aren't JWTs; it checks every token itself), and give it these secrets:

| Secret | |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Always. |
| `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` (or `SUPABASE_JWT_SECRET`) | For OAuth callers: looking up their tokens and signing a JWT for the user. |
| `APP_ROUTER_PUBLIC_URL` | Its public address, for the links it hands out (default: from the request). |
| `APP_API_PUBLIC_URL` | The app API's public address, named to MCP clients as the authorization server. |
| `APP_ROUTER_FORWARD_HEADERS` | Request headers passed on to functions, comma-separated (e.g. `x-spacify-workspace`); they're also allowed by CORS. `x-gondol-actor` always is: the AI chat and the agents send the entity URI of the conversation or the agent with their tool calls (`callAppTool(…, actor)`), so the database can log who made a write (PostgREST's `request.headers`). |
| `APP_ROUTER_ENTITIES`, `APP_ROUTER_DISCOVERY` | `false` turns off the `entities__` (for a host without the entity API) or `apps__` tools. |
| whatever `mcp.endpoint.headers` name | Apps' own MCP servers' credentials. |
| `MCP_ALLOWED_HOSTS`, `MCP_ALLOW_PRIVATE` | Users' own MCP servers (the ai app's `ai_mcp_servers`, read with `SUPABASE_SERVICE_ROLE_KEY`) must be public HTTPS hosts; these allow listed hosts (comma separated, `host` or `host:port`) or every address. |

A host with another function name tells the client once, before anything renders:

```ts
import { configureAppRouter } from "gondol/api/client";

configureAppRouter({ functionName: "my-router" });
```

To serve the router some other way (Node, a worker), call `createAppRouter({ registry, basePath,
authenticate, rpc, callFunction })` yourself; see the comments in `router.ts`.
