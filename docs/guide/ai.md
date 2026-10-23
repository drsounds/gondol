# The ai app

Gondol ships one app of its own, `ai`: LLM support for an app built on gondol, and an AI chat.

- **Providers** are the APIs it speaks. [Ollama](https://ollama.com), OpenAI-compatible APIs and
  [LangChain Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) (an agent on
  the server, on an Ollama's or an OpenAI-compatible API's model) are built in; more can be
  registered in code.
- **Services** are the user's own AI APIs (`ai_services`): OpenAI, Berget AI, a local Ollama, …,
  each linked to a provider, with an address and a key of its own that stays on the server. A
  provider can also be used straight from the app's settings, as before.
- **Models** are what a provider serves. The user picks which ones the chat offers and a default.
- **Conversations** and their **messages** are kept per account, and answers stream in as the
  model writes them.
- Its **settings** (the provider's API address, the default model, instructions, temperature, …)
  are [app settings](./settings.md), per user, workspace or site.

## Switching it on

The app lives in `gondol/builtin/ai`. Add it to your apps:

```ts
import { configureGondol } from "gondol";
import { aiApp } from "gondol/builtin/ai";

configureGondol({
  // …
  apps: [...myApps, aiApp],
});
```

or, with the [Vite plugin](./apps.md#building-a-subset), build it in with your own apps:

```ts
gondolApps({ dir: "apps", builtin: ["ai"] });
```

Then create [its tables](#the-tables), deploy the [AI edge functions](#calling-compatible-apis-through-the-server)
to your Supabase project, and show the [settings panel](./settings.md#showing-the-settings)
somewhere (Account) so users can set the address. Like any app, users can switch it off, and a site
can leave it out.

## Pages

| Path | Feature | |
| --- | --- | --- |
| `/ai`, `/ai/new` | `chat` | A new conversation, beside the list of the user's conversations (wide screens only: phones have them in the menu). |
| `/ai/<conversation id>` | `chat` | A conversation: its messages, the model picker, and the box to write the next message. Answers stream in, formatted from markdown; **Stop** ends one early and keeps what was written. |
| `/ai/settings`, `/ai/<conversation id>/settings` | `chat` | The AI settings as a dialog over the chat: the app's settings for the user and the tools allowed without asking, to take back. |
| `/ai-models` | `models` | The user's services, then each source in use (a service, or a provider from the settings) with the models it serves now: which the chat offers, the default, and the app's settings. Tagged `admin`/`operator` and `configure` for [sites](./sites.md). |
| `/ai-models/services/new`, `/ai-models/services/<id>/edit` | `models` | The routed sheets for a service: a preset (OpenAI, Berget AI, Ollama, another OpenAI-compatible API), its name, provider, address and key, and whether the chat uses it. |
| `/ai-models/mcp/new`, `/ai-models/mcp/<id>/edit` | `models` | The routed sheets for one of the user's [MCP servers](#the-users-own-mcp-servers): name, address, what it's for, headers and whether the chat uses it. |

The palette has "Open AI chat", "New AI conversation", "AI settings", "AI models and providers",
"Add AI service" and "Add MCP server".

Answers are markdown as models write it, rendered by `<Markdown/>` (`models/markdown.ts` parses it:
headings, lists and task lists, code blocks, quotes, tables, emphasis and links). It never produces
HTML: HTML in an answer stays text, and only http(s) and mailto links are kept, opening in a new tab.

## Services

A service is one API the chat gets answers from, speaking a provider's protocol (`provider`:
`openai` for OpenAI, Berget AI, vLLM, LM Studio and other OpenAI-compatible APIs, `ollama` for an
Ollama). Its `base_url` is the API's address as the server reaches it (empty: OpenAI's
`https://api.openai.com/v1`, or the server's own Ollama), and its key is set with
`set_ai_service_key()` into `ai_service_keys`, which the client can't read: only the AI functions
do, with the service role. The model picker offers the models kept for each enabled service (and
for the providers the `providers` setting switches on), so one account can use several services
side by side; a conversation remembers the service it uses (`service_id`).

A provider can be added as a service when it says `supportsServices` (both built-in ones do); it
then gets `service` (`{ id, base_url }`) in `listModels(settings, signal, service)` and
`chat(settings, { …, service })` and sends `serviceId` to its function instead of an address.

## Settings

| Key | Type | Scopes | |
| --- | --- | --- | --- |
| `defaultModel` | string | user, workspace, site | The model new conversations start with (e.g. `llama3.2`). |
| `systemPrompt` | text | user, workspace, site | Instructions sent first; a conversation keeps the ones it started with. |
| `temperature` | number 0–2 | user, workspace, site | Empty leaves the model's own. |
| `contextMessages` | whole number | user, workspace, site | How many earlier messages are sent along (default 20). |
| `sendWith` | select (radio) | user | Enter or Ctrl/⌘+Enter sends. |
| `composerPosition` | select (radio) | user | `bottom` (default): the conversation, then the message box. `top`: the box first and the exchanges newest first under it, each question above its answer. |
| `showMetrics` | checkbox | user | Tokens, speed and time under answers. |
| `providers` | checkboxes | user, workspace, site | The providers in use (default: Ollama). |
| `openai.baseUrl` | URL (submenu OpenAI-compatible API) | user, workspace, site | API base URL (default `https://api.openai.com/v1`), as the server reaches it. |
| `openai.apiKey` | password (submenu OpenAI-compatible API) | user | Read by the server function and sent as a bearer token; empty for APIs that don't require one. |
| `ollama.baseUrl` | URL (submenu Ollama) | user, workspace, site | Ollama's API address, as the server reaches it. Empty uses the function's `OLLAMA_BASE_URL`. |
| `ollama.apiKey` | password (submenu Ollama) | user | A bearer token, for an Ollama behind a proxy that asks for one. |
| `ollama.keepAlive` | string (submenu Ollama) | user, workspace, site | How long Ollama keeps the model loaded (`5m`, `1h`, `-1`). |
| `ollama.numCtx` | whole number (submenu Ollama) | user, workspace, site | The context window, in tokens. |
| `ollama.transport` | select (radio, submenu Ollama) | user, workspace, site | `websocket` (default; falls back to HTTP) or `http`: how answers travel, see [Over a WebSocket](#over-a-websocket). |
| `deepagents.backend` | select (radio, submenu LangChain Deep Agents) | user, workspace, site | The API the agent's model runs on: `ollama` (default) or `openai`, with that provider's address and key. |
| `deepagents.maxSteps` | whole number (submenu LangChain Deep Agents) | user, workspace, site | The most model and tool calls per answer (default 100). |

A site's owner can point everyone on the site at a shared Ollama by setting `ollama.baseUrl` in the
site's settings; a user's own address still wins.

The OpenAI-compatible provider calls the configured `/models` and `/chat/completions` endpoints
through a Supabase edge function, streaming chat completions as server-sent events. The API address
must be reachable from the server; no CORS setup is needed. OpenAI uses
`https://api.openai.com/v1` by default; set `openai.baseUrl` to the versioned base URL for another
compatible service. OpenAI-compatible APIs are available when selected in the `providers` setting;
Ollama remains the default.

## Calling compatible APIs through the server

The browser never calls either API itself. It asks a Supabase edge function, which calls the API for
the signed-in user and streams the answer back. So the address has to be reachable **from the
server**, not from the user's device, and the APIs need no CORS setup.

The functions are the host app's to deploy, with `verify_jwt` on. `ai-openai` is the default
OpenAI-compatible function name and `ai-ollama` is the default Ollama function name. `ai-openai`'s
contract:

| Request (POST, JSON) | Answer |
| --- | --- |
| `{ action: "models", baseUrl }` or `{ action: "models", serviceId }` | The API's `/models` JSON response (`{ data: [...] }`). |
| `{ action: "chat", baseUrl \| serviceId, model, messages, temperature?, tools? }` | The API's streaming `/chat/completions` response as server-sent events. `messages` may hold `assistant` messages with `tool_calls` and `tool` messages (`tool_call_id`), `tools` is chat completions' `[{ type: "function", function: { name, description, parameters } }]`. |

The function reads the signed-in user's `openai.apiKey` from `app_settings` and sends it as a bearer
token; do not accept the key in the request body. With `serviceId` it reads the service (as the
user, so only their own) and its key from `ai_service_keys` (with `SUPABASE_SERVICE_ROLE_KEY`), and
calls the service's address instead. `gondol-api --functions <dir>` writes gondol's `ai-openai` into
the host's functions when `--builtin` includes `ai`, next to the app router. Validate the base URL and restrict hosts the
function may call to avoid using it to reach private services.

By default, the function only calls public HTTPS hosts. Set `OPENAI_ALLOWED_HOSTS` to a comma-separated
list of host names or `host:port` values to allow internal APIs, or set `OPENAI_ALLOW_PRIVATE=true`
to allow any address in a single-user installation.

Both functions return errors as JSON `{ error, kind }`, with `kind` one of `config`, `forbidden`,
`unreachable`, `http` or `invalid`; the chat and models page show the message and what to check.

`ai-ollama` calls Ollama's API (`GET /api/tags`, `POST /api/chat`) and streams the answer back. Its
contract:

| Request (POST, JSON) | Answer |
| --- | --- |
| `{ action: "models", baseUrl? \| serviceId }` | `{ models: [{ name, model, size, modified_at, details }] }`, Ollama's `/api/tags` |
| `{ action: "chat", baseUrl? \| serviceId, model, messages: [{ role, content, tool_calls?, tool_name? }], tools?, options?, keep_alive? }` | `text/event-stream`: one `data: <Ollama's JSON chunk>` event per piece (tool calls in `message.tool_calls`), the last with `done: true`, or `data: {"error": "…"}` |

`baseUrl` is the `ollama.baseUrl` setting in effect; when it's empty the function uses its own
`OLLAMA_BASE_URL`. The API key isn't sent along: the function reads the user's own `ollama.apiKey`
from `app_settings` (or, with `serviceId`, the service's address and key, as `ai-openai` does). Since anyone can type an address, Spacify's function only calls public hosts,
except for:

| Secret | |
| --- | --- |
| `OLLAMA_BASE_URL` | The server's own Ollama, used when no address is set (its host is always allowed). |
| `OLLAMA_ALLOWED_HOSTS` | Comma-separated host names or `host:port` that may be internal (an Ollama on the LAN). |
| `OLLAMA_ALLOW_PRIVATE` | `true` lets every address through (a single-user install). |

For the OpenAI-compatible function, use an equivalent allowlist for any internal API hosts.

### Over a WebSocket

An answer can take long to start (a model loading on the Ollama server) or to finish, and a proxy
between the browser and the function (Kong, nginx) closes an HTTP request that sends nothing for a
while. So the chat asks `ai-ollama` over a **WebSocket** by default (the `ollama.transport` setting,
`websocket` or `http`), and `ai-deepagents` only takes WebSockets. The protocol
(`src/builtin/ai/models/socket.ts`, `runAiSocket()`):

| Direction | Message | |
| --- | --- | --- |
| browser → | `{ type: "start", accessToken, body }` | First. `body` is what the HTTP POST would send; the token is the session's (a browser can't put headers on a WebSocket, and it never goes in the URL). |
| ← function | `{ type: "ready" }` | Signed in, working on it. |
| ← function | `{ type: "ping" }` | Every 10 seconds while it works, so nothing in between counts the connection as idle. |
| ← function | the function's own events | `ai-ollama`: `{ type: "chunk", chunk }`, one per Ollama JSON chunk. |
| ← function | `{ type: "done", … }` or `{ type: "error", error, kind }` | The end (then it closes). |
| browser → | `{ type: "cancel" }` | Stop (closing the socket does too). |

The functions check the token themselves, so the gateway must let the upgrade through without an
`Authorization` header: `verify_jwt = false` for them, or, on a self-hosted Supabase, their names in
the main router's exempt list (`volumes/functions/main/index.ts`). When the socket can't be opened
(an older function, a gateway that still wants the header) the Ollama provider asks over HTTP as
before; its HTTP answer sends a `: keep-alive` comment every 10 seconds too.

### LangChain Deep Agents

The `deepagents` provider runs a [Deep Agent](https://docs.langchain.com/oss/javascript/deepagents/overview)
in gondol's `ai-deepagents` function (`supabase/functions/ai-deepagents`, written into the host's
functions by `gondol-api --functions` next to `ai-openai`): an agent that plans, keeps notes in a
scratch file system of its own (gone after the answer), hands parts of the work to a sub-agent and
calls the apps' tools until it has an answer. Its model is an Ollama's or an OpenAI-compatible
API's: the `deepagents.backend` setting picks which, with that provider's address and key settings;
a Deep Agent service (provider `deepagents`) has its own `options.backend`, address and key. The
same host rules apply (`OLLAMA_*` for an Ollama, `OPENAI_*` for the rest).

The agent runs the loop on the server, so the provider says `runsTools`: when the agent calls one
of the apps' tools, the function sends `{ type: "tool_call", id, name, arguments }` and the chat
runs it as usual (asking first when `toolApproval` says so, through the app router as the user) and
answers `{ type: "tool_result", id, content, ok }`. Besides `ready`, `ping` and `cancel`:

| Event | |
| --- | --- |
| `{ type: "token", text }` | A piece of the answer. |
| `{ type: "status", status }` | What the agent is doing ("Planning", "Working with a sub-agent", "Taking notes", …), shown where a tool's name shows. |
| `{ type: "done", models }` | For `{ action: "models", backend, baseUrl? \| serviceId }`: what the backend serves. |
| `{ type: "done", content, usage }` | For `{ action: "chat", backend, baseUrl? \| serviceId, model, messages, tools?, temperature?, numCtx?, maxSteps? }`. |

`deepagents.maxSteps` (default 100) caps the model and tool calls of one answer. A long run keeps the
function's worker alive for as long, so allow for it in the edge runtime's worker timeout.

## The apps' tools

Other apps can offer the model tools over MCP (their manifests' `mcp`, see
[App functions and MCP](./functions.md)). The chat fetches them from the app router's `/mcp`
(`useAiAppTools()`), hands them to the model with what the apps say about themselves, runs the calls
the model makes through the router as the user and sends the results back, up to eight rounds per
answer. The tools used are kept in the answer's `metrics.tools` (`denied` when the user said no).

Next to the apps' own tools the model gets gondol's: `apps__…` to find the apps the user has, their
pages, actions, entity types and functions (and run any function), and `entities__…` to search,
read, create, change and delete any entity as the user, under row level security (see
[gondol's own tools](./functions.md#gondols-own-tools-apps-and-entities)). The chat tells the router
which apps are on and, on a site, which entity types the site shows (`useAppRouterScope()`), so the
model reaches only what the user could in the app. Reading tools run without asking; creating,
changing, deleting and running functions ask under `changes`.

When a tool needs asking (`toolApproval`), the answer being written shows what the model wants to run
and with what, and the user picks **Allow once**, **Allow in this conversation**, **Always allow** or
**Don't allow** (Stop also says no). The two that last are kept in `ai_tool_permissions`, by the
tool's name on the router (`<app>__<tool>`), with the conversation or none for always; the AI
settings dialog lists them to take back, and deleting a conversation takes its own with it.
`useAiChat()` returns the question as `approval` and takes the answer with `decide()`; a host can
pass `confirmTool` to ask its own way instead.

### The user's own MCP servers

Users can add MCP servers of their own on `/ai-models` (`ai_mcp_servers`): a remote server speaking
Streamable HTTP, with headers such as `Authorization: Bearer …`. The headers are write-only, like a
service's key: `set_ai_mcp_server_headers(p_server_id, p_set, p_remove)` keeps the values in
`ai_mcp_server_headers`, which the client can't read, and `header_names` on the server says which are
set. The app router (`userMcpServers` in `createAppRouter()`) adds each enabled one to `/mcp` and the
catalogue for callers with their own session (never OAuth clients) as an app `mcp_<first 8 hex
digits of its id>`, so its tools are `mcp_1a2b3c4d__<tool>`, and calls it server-side without
following redirects. With `toolApproval` at `changes`, the chat asks before any of their tools runs,
whatever the server says about it. The function reads them with `SUPABASE_SERVICE_ROLE_KEY` and only calls public
HTTPS hosts, unless `MCP_ALLOWED_HOSTS` lists the host or `MCP_ALLOW_PRIVATE=true`.

| Setting | Type | Scope | |
| --- | --- | --- | --- |
| `appTools` | checkbox | user, workspace, site | Hand the model the apps' tools (default on). |
| `toolApproval` | radio | user | Ask before a tool runs: `changes` (tools that aren't read-only, the default), `always` or `never`. |

A provider says it can call tools with `supportsTools`; `AiChatRequest.tools` and
`AiChatResult.toolCalls` carry them, `AiChatMessage` has `toolCalls` and the `tool` role.

A host whose function has another name sets it once, before anything renders:

```ts
import { configureDeepAgents, configureOllama, configureOpenAi } from "gondol/builtin/ai/models";

configureOllama({ functionName: "my-ollama" });
configureOpenAi({ functionName: "my-openai" });
configureDeepAgents({ functionName: "my-deepagents" });
```

## Using it from code

`gondol/builtin/ai/models` has everything the pages are built on:

| Export | |
| --- | --- |
| `useAiSettings()` | The app's settings in effect. |
| `useAiConversations()`, `useAiMessages(id)` | The user's conversations (latest first) and a conversation's messages. |
| `useAiChat(settings, { onConversationCreated })` | `send(text, { conversation, provider, model })`, `stop()`, the answer `streaming`, `busy`, `error`. |
| `useAiModelChoices(settings)` | The chat's model picker (each choice with its `provider`, `serviceId` and `sourceName`). |
| `useProviderModels(providerId, settings, enabled?, service?)` | What a provider (or a service) serves now. |
| `useAiServices()`, `useSaveAiService()`, `useDeleteAiService()`, `AI_SERVICE_PRESETS` | The user's services (`apiKey` on save sets, keeps or removes the key). |
| `useAiSources(settings)`, `aiSources(settings, services)` | Where answers can come from: the enabled services, then the providers in the settings. |
| `useSavedAiModels()`, `useSaveAiModel()`, `useRemoveAiModel()` | The models kept in `ai_models`. |
| `getAiProvider(id)`, `getAiProviders()`, `enabledAiProviders(settings)` | The provider registry (Ollama and OpenAI-compatible APIs are built in). |

To ask a model something without the chat:

```ts
import { getAiProvider, useAiSettings } from "gondol/builtin/ai/models";

const { settings } = useAiSettings();
const ollama = getAiProvider("ollama")!;
const { content } = await ollama.chat(settings, {
  model: "llama3.2",
  messages: [{ role: "user", content: "Summarize: …" }],
  onToken: (piece) => console.log(piece),
});
```

### Adding a provider

A provider implements `listModels(settings, signal)` and `chat(settings, request)`, streaming each
piece of the answer to `request.onToken` and stopping when `request.signal` aborts. One that runs
its own agent loop says `runsTools` and calls `request.runTool(call)` for the apps' tools (and
`request.onStatus(text)` for what it's doing) instead of returning `toolCalls`:

```ts
import { registerAiProvider, type AiProvider } from "gondol/builtin/ai/models";

const myProvider: AiProvider = {
  id: "my-llm",
  name: "My LLM",
  describe: (settings) => String(settings["myLlm.baseUrl"] ?? ""),
  listModels: async (settings, signal) => [/* { name, size?, details? } */],
  chat: async (settings, { model, messages, temperature, signal, onToken }) => {
    // call the API, onToken(piece) as it streams
    return { content, metrics: { completionTokens, durationMs } };
  },
};

registerAiProvider(myProvider); // once, before anything renders
```

Its settings (an address, a key) are app settings of the `ai` app, so a provider of your own needs
them in the app's manifest; a provider for everyone belongs in gondol, next to `ollama.ts`.

## The tables

| Table | Columns |
| --- | --- |
| `ai_services` | `id`, `user_id` (default `auth.uid()`), `name`, `provider`, `base_url`, `has_api_key` (kept by `set_ai_service_key()`), `enabled`, `position`, `options` (jsonb, `{}`; a Deep Agent's `backend`), `created_at`, `updated_at` |
| `ai_service_keys` | `service_id` (cascades), `user_id`, `api_key`: no grants to `authenticated`, written by `set_ai_service_key(p_service_id, p_api_key)` (null removes it), read by the AI functions |
| `ai_tool_permissions` | `id`, `user_id` (default `auth.uid()`), `tool`, `title`, `conversation_id` (null: always; cascades), `created_at`; unique `(user_id, conversation_id, tool)`, nulls not distinct |
| `ai_mcp_servers` | `id`, `user_id` (default `auth.uid()`), `name`, `url`, `description`, `header_names` (kept by `set_ai_mcp_server_headers()`), `enabled`, `position`, `created_at`, `updated_at` |
| `ai_mcp_server_headers` | `server_id` (cascades), `user_id`, `headers` (jsonb, name → value): no grants to `authenticated`, written by `set_ai_mcp_server_headers()`, read by the app router |
| `ai_conversations` | `id`, `user_id` (default `auth.uid()`), `title`, `provider`, `service_id` (set null when the service goes), `model`, `system_prompt`, `created_at`, `updated_at` |
| `ai_messages` | `id`, `conversation_id` (cascades), `user_id`, `role` (`system`, `user`, `assistant`), `content`, `provider`, `model`, `metrics` (jsonb), `error`, `created_at` |
| `ai_models` | `id`, `user_id`, `provider`, `service_id` (cascades), `name`, `label`, `details` (jsonb), `enabled`, `created_at`, `updated_at`; unique `(user_id, provider, service_id, name)`, nulls not distinct |

Each is private to its user (`user_id = auth.uid()` policies); a message can only be added to the
user's own conversation. Spacify's migration `20261022210000_app_settings_and_ai.sql` creates them,
with `app_settings`; `20261023170000_ai_services.sql` adds the services and
`20261023190000_ai_service_options.sql` their `options`, and `20261023210000_ai_tool_permissions_and_mcp_servers.sql`
the tool permissions and MCP servers.
