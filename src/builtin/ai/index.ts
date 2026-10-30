import { defineApp, lazyWidget } from "../../apps/defineApp";
import manifest from "./manifest.json";
import { AiCreditScopeSync } from "./models/credits";

/**
 * The ai app, built into gondol: LLM support for the apps on it (providers, models, the user's
 * conversations and messages) and an AI chat on Ollama. Provider settings, such as Ollama's API
 * address, are the app's settings (its manifest's `settings`): per user, workspace or site.
 *
 * Switch it on by adding it to the host's apps: `configureGondol({ apps: [...apps, aiApp] })`, or
 * `gondolApps({ builtin: ["ai"] })` with the Vite plugin. Its tables are in docs/guide/ai.md.
 */
export const aiApp = defineApp({
  manifest,
  pages: {
    chat: () => import("./features/chat/src/pages/AiChatPage").then((m) => m.AiChatPage),
    models: () => import("./features/models/src/pages/AiModelsPage").then((m) => m.AiModelsPage),
    credits: () => import("./features/credits/src/pages/AiCreditsPage").then((m) => m.AiCreditsPage),
  },
  widgets: {
    // "New conversation" and the recent conversations, below the app's pages in the menu.
    menuWidgets: [lazyWidget(() => import("./features/chat/src/widgets/AiMenuConversations").then((m) => m.AiMenuConversations))],
    // The credits left, as a pie left of the account menu (only while a tier limits them).
    headerWidgets: [lazyWidget(() => import("./features/credits/src/widgets/AiCreditsHeaderPie").then((m) => m.AiCreditsHeaderPie))],
    // Keeps the workspace AI requests name (for its credits) in step with the open one.
    Providers: [AiCreditScopeSync],
  },
});

export default aiApp;
