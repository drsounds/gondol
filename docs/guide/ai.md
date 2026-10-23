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

Then create [its tables](#the-tables), deploy [the `ai-ollama` edge function](#ollama-through-the-server)
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
| `openai.baseUrl` | URL (submenu OpenAI-compatible API) | user, workspace, site | API base URL (default `https://api.openai.com/v1`). |
| `openai.apiKey` | password (submenu OpenAI-compatible API) | user | Sent as a bearer token; empty for APIs that don't require one. |
| `ollama.baseUrl` | URL (submenu Ollama) | user, workspace, site | Ollama's API address, as the server reaches it. Empty uses the function's `OLLAMA_BASE_URL`. |
| `ollama.apiKey` | password (submenu Ollama) | user | A bearer token, for an Ollama behind a proxy that asks for one. |
| `ollama.keepAlive` | string (submenu Ollama) | user, workspace, site | How long Ollama keeps the model loaded (`5m`, `1h`, `-1`). |
| `ollama.numCtx` | whole number (submenu Ollama) | user, workspace, site | The context window, in tokens. |

A site's owner can point everyone on the site at a shared Ollama by setting `ollama.baseUrl` in the
site's settings; a user's own address still wins.

The OpenAI-compatible provider calls the configured `/models` and `/chat/completions` endpoints
directly from the browser, streaming chat completions as server-sent events. The API must allow
requests from the site's origin (CORS). OpenAI uses `https://api.openai.com/v1` by default; set
`openai.baseUrl` to the versioned base URL for another compatible service. OpenAI-compatible APIs
are available when selected in the `providers` setting; Ollama remains the default.

## Ollama through the server

The browser never calls Ollama itself. It asks a Supabase edge function (`ai-ollama` by default),
which calls Ollama's API (`GET /api/tags`, `POST /api/chat`) for the signed-in user and streams the
answer back. So the address has to be reachable **from the server**, not from the user's device, and
Ollama needs no CORS setup (`OLLAMA_ORIGINS`).

The function is the host app's to deploy (Spacify's is `supabase/functions/ai-ollama`), with
`verify_jwt` on. Its contract:

| Request (POST, JSON) | Answer |
| --- | --- |
| `{ action: "models", baseUrl? }` | `{ models: [{ name, model, size, modified_at, details }] }`, Ollama's `/api/tags` |
| `{ action: "chat", baseUrl?, model, messages: [{ role, content }], options?, keep_alive? }` | `text/event-stream`: one `data: <Ollama's JSON chunk>` event per piece, the last with `done: true`, or `data: {"error": "…"}` |

Errors are JSON `{ error, kind }` with `kind` one of `config` (no address, or not a URL),
`forbidden` (an address the server won't call), `unreachable`, `http` (Ollama answered with an
error) or `invalid` (a bad request); the chat and the models page show the message and what to check.

`baseUrl` is the `ollama.baseUrl` setting in effect; when it's empty the function uses its own
`OLLAMA_BASE_URL`. The API key isn't sent along: the function reads the user's own `ollama.apiKey`
from `app_settings`. Since anyone can type an address, Spacify's function only calls public hosts,
except for:

| Secret | |
| --- | --- |
| `OLLAMA_BASE_URL` | The server's own Ollama, used when no address is set (its host is always allowed). |
| `OLLAMA_ALLOWED_HOSTS` | Comma-separated host names or `host:port` that may be internal (an Ollama on the LAN). |
| `OLLAMA_ALLOW_PRIVATE` | `true` lets every address through (a single-user install). |

A host whose function has another name sets it once, before anything renders:

```ts
import { configureOllama } from "gondol/builtin/ai/models";

configureOllama({ functionName: "my-ollama" });
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
