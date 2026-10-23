# The ai app

Gondol ships one app of its own, `ai`: LLM support for an app built on gondol, and an AI chat.

- **Providers** are what it talks to. [Ollama](https://ollama.com) and OpenAI-compatible APIs are
  built in; more can be registered in code.
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
| `/ai`, `/ai/new` | `chat` | A new conversation, beside the list of the user's conversations. |
| `/ai/<conversation id>` | `chat` | A conversation: its messages, the model picker, and the box to write the next message. Answers stream in; **Stop** ends one early and keeps what was written. |
| `/ai-models` | `models` | Each provider in use with the models it serves now: which the chat offers, the default, and the app's settings. Tagged `admin`/`operator` and `configure` for [sites](./sites.md). |

The palette has "Open AI chat", "New AI conversation" and "AI models and providers".

## Settings

| Key | Type | Scopes | |
| --- | --- | --- | --- |
| `defaultModel` | string | user, workspace, site | The model new conversations start with (e.g. `llama3.2`). |
| `systemPrompt` | text | user, workspace, site | Instructions sent first; a conversation keeps the ones it started with. |
| `temperature` | number 0–2 | user, workspace, site | Empty leaves the model's own. |
| `contextMessages` | whole number | user, workspace, site | How many earlier messages are sent along (default 20). |
| `sendWith` | select (radio) | user | Enter or Ctrl/⌘+Enter sends. |
| `showMetrics` | checkbox | user | Tokens, speed and time under answers. |
| `providers` | checkboxes | user, workspace, site | The providers in use (default: Ollama). |
| `openai.baseUrl` | URL (submenu OpenAI-compatible API) | user, workspace, site | API base URL (default `https://api.openai.com/v1`), as the server reaches it. |
| `openai.apiKey` | password (submenu OpenAI-compatible API) | user | Read by the server function and sent as a bearer token; empty for APIs that don't require one. |
| `ollama.baseUrl` | URL (submenu Ollama) | user, workspace, site | Ollama's API address, as the server reaches it. Empty uses the function's `OLLAMA_BASE_URL`. |
| `ollama.apiKey` | password (submenu Ollama) | user | A bearer token, for an Ollama behind a proxy that asks for one. |
| `ollama.keepAlive` | string (submenu Ollama) | user, workspace, site | How long Ollama keeps the model loaded (`5m`, `1h`, `-1`). |
| `ollama.numCtx` | whole number (submenu Ollama) | user, workspace, site | The context window, in tokens. |

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
| `{ action: "models", baseUrl }` | The API's `/models` JSON response (`{ data: [...] }`). |
| `{ action: "chat", baseUrl, model, messages, temperature? }` | The API's streaming `/chat/completions` response as server-sent events. |

The function reads the signed-in user's `openai.apiKey` from `app_settings` and sends it as a bearer
token; do not accept the key in the request body. Validate the base URL and restrict hosts the
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
| `{ action: "models", baseUrl? }` | `{ models: [{ name, model, size, modified_at, details }] }`, Ollama's `/api/tags` |
| `{ action: "chat", baseUrl?, model, messages: [{ role, content }], options?, keep_alive? }` | `text/event-stream`: one `data: <Ollama's JSON chunk>` event per piece, the last with `done: true`, or `data: {"error": "…"}` |

`baseUrl` is the `ollama.baseUrl` setting in effect; when it's empty the function uses its own
`OLLAMA_BASE_URL`. The API key isn't sent along: the function reads the user's own `ollama.apiKey`
from `app_settings`. Since anyone can type an address, Spacify's function only calls public hosts,
except for:

| Secret | |
| --- | --- |
| `OLLAMA_BASE_URL` | The server's own Ollama, used when no address is set (its host is always allowed). |
| `OLLAMA_ALLOWED_HOSTS` | Comma-separated host names or `host:port` that may be internal (an Ollama on the LAN). |
| `OLLAMA_ALLOW_PRIVATE` | `true` lets every address through (a single-user install). |

For the OpenAI-compatible function, use an equivalent allowlist for any internal API hosts.

A host whose function has another name sets it once, before anything renders:

```ts
import { configureOllama, configureOpenAi } from "gondol/builtin/ai/models";

configureOllama({ functionName: "my-ollama" });
configureOpenAi({ functionName: "my-openai" });
```

## Using it from code

`gondol/builtin/ai/models` has everything the pages are built on:

| Export | |
| --- | --- |
| `useAiSettings()` | The app's settings in effect. |
| `useAiConversations()`, `useAiMessages(id)` | The user's conversations (latest first) and a conversation's messages. |
| `useAiChat(settings, { onConversationCreated })` | `send(text, { conversation, provider, model })`, `stop()`, the answer `streaming`, `busy`, `error`. |
| `useAiModelChoices(settings)` | The chat's model picker. |
| `useProviderModels(providerId, settings)` | What a provider serves now. |
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
piece of the answer to `request.onToken` and stopping when `request.signal` aborts:

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
| `ai_conversations` | `id`, `user_id` (default `auth.uid()`), `title`, `provider`, `model`, `system_prompt`, `created_at`, `updated_at` |
| `ai_messages` | `id`, `conversation_id` (cascades), `user_id`, `role` (`system`, `user`, `assistant`), `content`, `provider`, `model`, `metrics` (jsonb), `error`, `created_at` |
| `ai_models` | `id`, `user_id`, `provider`, `name`, `label`, `details` (jsonb), `enabled`, `created_at`, `updated_at`; unique `(user_id, provider, name)` |

Each is private to its user (`user_id = auth.uid()` policies); a message can only be added to the
user's own conversation. Spacify's migration `20261022210000_app_settings_and_ai.sql` creates them,
with `app_settings`.
