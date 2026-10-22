import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addAiMessage, aiConversationsKey, aiMessagesKey, conversationTitle, createAiConversation, touchAiConversation } from "./conversations";
import { AiProviderError, getAiProvider, type AiChatMessage, type AiSettings } from "./providers";
import type { AiConversation, AiMessage } from "./types";

export interface AiChatTarget {
  conversation: AiConversation | null;
  provider: string;
  model: string | null;
}

/** The answer being written, while it streams. */
export interface AiStreamingAnswer {
  conversationId: string;
  content: string;
}

/**
 * Sending a message and streaming the answer: saves the user's message (starting a conversation
 * when there is none), sends the instructions and the latest `contextMessages` messages to the
 * provider, shows the answer as it streams and saves it, also when it stops short (with `error`).
 */
export function useAiChat(settings: AiSettings, options: { onConversationCreated?: (conversation: AiConversation) => void } = {}) {
  const queryClient = useQueryClient();
  const [streaming, setStreaming] = useState<AiStreamingAnswer | null>(null);
  const [error, setError] = useState<AiProviderError | Error | null>(null);
  const controller = useRef<AbortController | null>(null);
  const { onConversationCreated } = options;

  const appendToCache = useCallback(
    (message: AiMessage) => {
      queryClient.setQueryData<AiMessage[]>(aiMessagesKey(message.conversation_id), (previous) => [...(previous ?? []), message]);
    },
    [queryClient],
  );

  const send = useCallback(
    async (text: string, target: AiChatTarget) => {
      const content = text.trim();
      if (!content || controller.current) return;
      setError(null);
      const provider = getAiProvider(target.provider);
      if (!provider) {
        setError(new Error(`No AI provider "${target.provider}"`));
        return;
      }
      if (!target.model) {
        setError(new AiProviderError("Pick a model first", "invalid"));
        return;
      }
      const abort = new AbortController();
      controller.current = abort;
      let conversationId = target.conversation?.id ?? null;
      try {
        let conversation = target.conversation;
        if (!conversation) {
          const systemPrompt = typeof settings.systemPrompt === "string" && settings.systemPrompt.trim() ? settings.systemPrompt.trim() : null;
          conversation = await createAiConversation({ title: conversationTitle(content), provider: provider.id, model: target.model, system_prompt: systemPrompt });
          conversationId = conversation.id;
          queryClient.setQueryData<AiConversation[]>(aiConversationsKey, (previous) => [conversation!, ...(previous ?? [])]);
          queryClient.setQueryData<AiMessage[]>(aiMessagesKey(conversation.id), []);
          onConversationCreated?.(conversation);
        }
        const history = queryClient.getQueryData<AiMessage[]>(aiMessagesKey(conversation.id)) ?? [];
        const userMessage = await addAiMessage({ conversation_id: conversation.id, role: "user", content });
        appendToCache(userMessage);

        const limit = typeof settings.contextMessages === "number" ? settings.contextMessages : 20;
        const instructions = conversation.system_prompt ?? (typeof settings.systemPrompt === "string" ? settings.systemPrompt.trim() : "");
        const messages: AiChatMessage[] = [
          ...(instructions ? [{ role: "system" as const, content: instructions }] : []),
          ...[...history, userMessage]
            .filter((m) => m.role !== "system" && (m.content || !m.error))
            .slice(-limit)
            .map((m) => ({ role: m.role, content: m.content })),
        ];

        setStreaming({ conversationId: conversation.id, content: "" });
        let partial = "";
        let failure: string | null = null;
        let metrics = null;
        try {
          const result = await provider.chat(settings, {
            model: target.model,
            messages,
            temperature: typeof settings.temperature === "number" ? settings.temperature : undefined,
            signal: abort.signal,
            onToken: (piece) => {
              partial += piece;
              setStreaming({ conversationId: conversation!.id, content: partial });
            },
          });
          partial = result.content;
          metrics = result.metrics ?? null;
        } catch (caught) {
          failure = caught instanceof Error ? caught.message : String(caught);
          if (!(caught instanceof AiProviderError && caught.kind === "aborted")) setError(caught instanceof Error ? caught : new Error(failure));
        }
        if (partial || failure) {
          const answer = await addAiMessage({
            conversation_id: conversation.id,
            role: "assistant",
            content: partial,
            provider: provider.id,
            model: target.model,
            metrics,
            error: failure,
          });
          appendToCache(answer);
        }
        await touchAiConversation(conversation.id, target.model !== conversation.model ? { model: target.model, provider: provider.id } : {});
        void queryClient.invalidateQueries({ queryKey: aiConversationsKey });
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        if (conversationId) void queryClient.invalidateQueries({ queryKey: aiMessagesKey(conversationId) });
      } finally {
        controller.current = null;
        setStreaming(null);
      }
    },
    [settings, queryClient, appendToCache, onConversationCreated],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  return { send, stop, streaming, busy: streaming !== null, error, clearError: () => setError(null) };
}
