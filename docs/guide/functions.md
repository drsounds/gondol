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

## Building and deploying the router

`gondol-api` (see [App APIs](./api.md)) writes the router's files next to the gateway's:

```sh
bun node_modules/gondol/src/api/cli.ts --apps src/apps --builtin ai,oauth,streams \
  --out supabase/functions/_shared/gondol-api --functions supabase/functions
```

- `apps.json`: every app's `functions` and `mcp`, resolved (`buildAppRegistry()`): tools point at
  their Postgres or edge function, refs are inlined. It refuses a tool naming a function or
  operation the app doesn't have and a scope no app declares.
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
| `APP_ROUTER_FORWARD_HEADERS` | Request headers passed on to functions, comma-separated (e.g. `x-spacify-workspace`); they're also allowed by CORS. |
| whatever `mcp.endpoint.headers` name | Apps' own MCP servers' credentials. |
| `MCP_ALLOWED_HOSTS`, `MCP_ALLOW_PRIVATE` | Users' own MCP servers (the ai app's `ai_mcp_servers`, read with `SUPABASE_SERVICE_ROLE_KEY`) must be public HTTPS hosts; these allow listed hosts (comma separated, `host` or `host:port`) or every address. |

A host with another function name tells the client once, before anything renders:

```ts
import { configureAppRouter } from "gondol/api/client";

configureAppRouter({ functionName: "my-router" });
```

To serve the router some other way (Node, a worker), call `createAppRouter({ registry, basePath,
authenticate, rpc, callFunction })` yourself; see the comments in `router.ts`.
