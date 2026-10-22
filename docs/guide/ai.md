# The ai app

Gondol ships one app of its own, `ai`: LLM support for an app built on gondol, and an AI chat.

- **Providers** are what it talks to. [Ollama](https://ollama.com) is built in; more can be
  registered in code.
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

Then create [its tables](#the-tables), and show the [settings panel](./settings.md#showing-the-settings)
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
| `ollama.baseUrl` | URL (submenu Ollama) | user, workspace, site | Ollama's API address (default `http://localhost:11434`). |
| `ollama.apiKey` | password (submenu Ollama) | user | A bearer token, for an Ollama behind a proxy that asks for one. |
| `ollama.keepAlive` | string (submenu Ollama) | user, workspace, site | How long Ollama keeps the model loaded (`5m`, `1h`, `-1`). |
| `ollama.numCtx` | whole number (submenu Ollama) | user, workspace, site | The context window, in tokens. |

A site's owner can point everyone on the site at a shared Ollama by setting `ollama.baseUrl` in the
site's settings; a user's own address still wins.

## Ollama and the browser

The browser calls Ollama directly (`GET /api/tags`, `POST /api/chat`), so:

- the address has to be reachable **from the user's device** (`http://localhost:11434` is the
  Ollama on their own computer);
- Ollama has to **allow the page's origin**, or the browser blocks the answer. Start it with the
  origin listed, e.g. `OLLAMA_ORIGINS=https://app.example.com ollama serve` (or set the
  environment variable for the Ollama service);
- an `https` page can call `http://localhost`, but not plain `http` on another host: serve a remote
  Ollama over `https` (behind a reverse proxy).

When Ollama can't be reached, the chat and the models page say so and what to check.

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
| `getAiProvider(id)`, `getAiProviders()`, `enabledAiProviders(settings)` | The provider registry. |

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
