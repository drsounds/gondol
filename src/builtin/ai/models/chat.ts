import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addAiMessage, aiConversationsKey, aiMessagesKey, conversationTitle, createAiConversation, touchAiConversation } from "./conversations";
import { AiProviderError, getAiProvider, type AiChatMessage, type AiSettings, type AiToolCall } from "./providers";
import { callAppTool, toolResultText } from "../../../api/client";
import { aiToolsFor, instructionsWithApps, toolNeedsApproval, type AppTools, type McpTool } from "./tools";
import { aiToolPermissionsKey, allowAiTool, isToolAllowed, useAiToolPermissions, type AiToolDecision } from "./permissions";
import type { AiConversation, AiMessage, AiMetrics, AiService } from "./types";

/** How many times an answer may go back to the model with tool results. */
const MAX_TOOL_ROUNDS = 8;
/** The most of a tool's result a model gets, in characters. */
const MAX_TOOL_RESULT = 20_000;

export interface AiChatTarget {
  conversation: AiConversation | null;
  provider: string;
  /** The service to ask (one of the user's ai_services), or null for the provider's settings. */
  service?: AiService | null;
  model: string | null;
}

/** The answer being written, while it streams. */
export interface AiStreamingAnswer {
  conversationId: string;
  content: string;
  /** The tool running right now, by its title or name. */
  tool?: string;
}

/** A tool call waiting for the user's yes or no, shown in the answer being written. */
export interface AiToolApproval {
  conversationId: string;
  tool: McpTool;
  arguments: Record<string, unknown>;
}

/**
 * Sending a message and streaming the answer: saves the user's message (starting a conversation
 * when there is none), sends the instructions and the latest `contextMessages` messages to the
 * provider, shows the answer as it streams and saves it, also when it stops short (with `error`).
 *
 * With `tools` (useAiAppTools) and a provider that supports them, the model may call the apps'
 * tools: the chat runs each call through the app router, asking the user first when the
 * `toolApproval` setting says so, and sends the results back until the model answers. The tools it
 * used are kept in the answer's metrics. Asking is `approval` (shown in the answer being written)
 * until `decide()` answers it: once, for the conversation or always (both kept, permissions.ts), or
 * no; Stop says no. A host may pass its own `confirmTool` instead. A provider that `runsTools` (an agent on the server) gets
 * the same runner as `runTool` and calls it while it works; what it's doing shows as the `tool`.
 */
export function useAiChat(
  settings: AiSettings,
  options: {
    onConversationCreated?: (conversation: AiConversation) => void;
    tools?: AppTools | null;
    confirmTool?: (tool: McpTool, args: Record<string, unknown>, context: { conversationId: string }) => boolean | Promise<boolean>;
  } = {},
) {
  const queryClient = useQueryClient();
  const [streaming, setStreaming] = useState<AiStreamingAnswer | null>(null);
  const [error, setError] = useState<AiProviderError | Error | null>(null);
  const [approval, setApproval] = useState<AiToolApproval | null>(null);
  const controller = useRef<AbortController | null>(null);
  const answerApproval = useRef<((decision: AiToolDecision) => void) | null>(null);
  const { onConversationCreated, tools, confirmTool } = options;
  const permissions = useAiToolPermissions();
  const allowed = useRef(permissions.data);
  allowed.current = permissions.data;

  /** Asks the user about a tool call (unless they allowed it before), keeping what they decide. */
  const mayRun = useCallback(
    async (tool: McpTool, args: Record<string, unknown>, conversationId: string): Promise<boolean> => {
      if (confirmTool) return await confirmTool(tool, args, { conversationId });
      const known = allowed.current ?? queryClient.getQueryData(aiToolPermissionsKey);
      if (isToolAllowed(known, tool.name, conversationId)) return true;
      const decision = await new Promise<AiToolDecision>((resolve) => {
        answerApproval.current = resolve;
        setApproval({ conversationId, tool, arguments: args });
      });
      answerApproval.current = null;
      setApproval(null);
      if (decision === "conversation" || decision === "always") {
        const title = tool.title ?? tool.annotations?.title ?? null;
        await allowAiTool(queryClient, { tool: tool.name, title, conversationId: decision === "always" ? null : conversationId }).catch((caught) => {
          console.warn("ai: couldn't keep the tool permission", caught);
        });
        allowed.current = queryClient.getQueryData(aiToolPermissionsKey);
      }
      return decision !== "deny";
    },
    [confirmTool, queryClient],
  );

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
          conversation = await createAiConversation({
            title: conversationTitle(content),
            provider: provider.id,
            service_id: target.service?.id ?? null,
            model: target.model,
            system_prompt: systemPrompt,
          });
          conversationId = conversation.id;
          queryClient.setQueryData<AiConversation[]>(aiConversationsKey, (previous) => [conversation!, ...(previous ?? [])]);
          queryClient.setQueryData<AiMessage[]>(aiMessagesKey(conversation.id), []);
          onConversationCreated?.(conversation);
        }
        const history = queryClient.getQueryData<AiMessage[]>(aiMessagesKey(conversation.id)) ?? [];
        const userMessage = await addAiMessage({ conversation_id: conversation.id, role: "user", content });
        appendToCache(userMessage);

        const limit = typeof settings.contextMessages === "number" ? settings.contextMessages : 20;
        const appTools = provider.supportsTools && tools?.tools.length ? tools : null;
        const instructions = instructionsWithApps(conversation.system_prompt ?? (typeof settings.systemPrompt === "string" ? settings.systemPrompt.trim() : ""), appTools);
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
        let metrics: AiMetrics | null = null;
        const used: NonNullable<AiMetrics["tools"]> = [];
        // What has streamed in so far, kept when the answer stops short.
        let live = "";
        const toolTitle = (call: AiToolCall) => appTools?.tools.find((t) => t.name === call.name)?.title ?? call.name;
        /** Runs a tool call through the app router (asking first when the settings say so), for what to tell the model. */
        const runTool = async (call: AiToolCall): Promise<string> => {
          const tool = appTools?.tools.find((t) => t.name === call.name);
          let text: string;
          let ok = false;
          let denied = false;
          if (!tool) {
            text = `There is no tool named ${call.name}.`;
          } else if (toolNeedsApproval(tool, settings) && !(await mayRun(tool, call.arguments, conversation!.id))) {
            if (abort.signal.aborted) throw new AiProviderError("Stopped", "aborted");
            text = "The user didn't let this tool run.";
            denied = true;
          } else {
            try {
              const answer = await callAppTool(call.name, call.arguments, abort.signal);
              text = toolResultText(answer);
              ok = !answer.isError;
            } catch (caught) {
              if (abort.signal.aborted) throw new AiProviderError("Stopped", "aborted");
              text = caught instanceof Error ? caught.message : String(caught);
            }
          }
          used.push({ name: call.name, ...(tool?.title ? { title: tool.title } : {}), ok, ...(denied ? { denied } : {}) });
          return text.length > MAX_TOOL_RESULT ? `${text.slice(0, MAX_TOOL_RESULT)}…` : text;
        };
        try {
          for (let round = 0; ; round++) {
            // Each round's text follows the last's.
            const before = partial ? `${partial}\n\n` : "";
            let piecewise = "";
            const result = await provider.chat(settings, {
              model: target.model,
              messages,
              temperature: typeof settings.temperature === "number" ? settings.temperature : undefined,
              signal: abort.signal,
              service: target.service ?? null,
              ...(appTools && round < MAX_TOOL_ROUNDS ? { tools: aiToolsFor(appTools.tools) } : {}),
              ...(provider.runsTools
                ? {
                    runTool: async (call: AiToolCall) => {
                      setStreaming({ conversationId: conversation!.id, content: live, tool: toolTitle(call) });
                      return runTool(call);
                    },
                    onStatus: (status: string) => setStreaming({ conversationId: conversation!.id, content: live, tool: status }),
                  }
                : {}),
              onToken: (piece) => {
                piecewise += piece;
                live = before + piecewise;
                setStreaming({ conversationId: conversation!.id, content: live });
              },
            });
            if (result.content) partial = before + result.content;
            live = partial;
            metrics = result.metrics ?? null;
            if (!appTools || !result.toolCalls?.length || round >= MAX_TOOL_ROUNDS) break;

            messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
            for (const call of result.toolCalls) {
              setStreaming({ conversationId: conversation.id, content: partial, tool: toolTitle(call) });
              messages.push({ role: "tool", content: await runTool(call), toolCallId: call.id, toolName: call.name });
            }
          }
        } catch (caught) {
          if (live.length > partial.length) partial = live;
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
            metrics: used.length ? { ...(metrics ?? {}), tools: used } : metrics,
            error: failure,
          });
          appendToCache(answer);
        }
        const serviceId = target.service?.id ?? null;
        await touchAiConversation(
          conversation.id,
          target.model !== conversation.model || provider.id !== conversation.provider || serviceId !== (conversation.service_id ?? null)
            ? { model: target.model, provider: provider.id, service_id: serviceId }
            : {},
        );
        void queryClient.invalidateQueries({ queryKey: aiConversationsKey });
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        if (conversationId) void queryClient.invalidateQueries({ queryKey: aiMessagesKey(conversationId) });
      } finally {
        controller.current = null;
        setStreaming(null);
      }
    },
    [settings, queryClient, appendToCache, onConversationCreated, tools, mayRun],
  );

  const decide = useCallback((decision: AiToolDecision) => answerApproval.current?.(decision), []);
  const stop = useCallback(() => {
    controller.current?.abort();
    answerApproval.current?.("deny");
  }, []);

  return { send, stop, streaming, approval, decide, busy: streaming !== null, error, clearError: () => setError(null) };
}
