import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callAppTool, listAppTools, toolResultText, type McpTool } from "../../../api/client";
import { getAiProvider, type AiChatMessage, type AiSettings, type AiToolCall } from "../../ai/models/providers";
import { aiToolsFor } from "../../ai/models/tools";
import { useAiSettings } from "../../ai/models/models";
import { useAiServices } from "../../ai/models/services";
import type { AiMetrics, AiService } from "../../ai/models/types";
import { supabase } from "./db";
import { sessionUserId } from "../../../supabase/session";
import { accountDisplayName, agentsHost, type AgentEgo } from "./host";
import type { Json } from "../../../supabase/types";
import {
  agentMayUseTool,
  agentPromptMessages,
  agentSystemPrompt,
  agentThreadContext,
  type PromptLine,
  type PromptSituation,
} from "../../../../supabase/functions/_shared/agentPrompt.ts";
import {
  agentConversationsKey,
  agentMessagesKey,
  agentRunsKey,
  claimAgentRuns,
  mentionedAgentIds,
  openAgentConversation,
  queueAgentRun,
  parseWorkingHours,
  type Agent,
  type AgentConversation,
  type AgentRun,
} from "./agents";

/** How many times an answer may go back to the model with tool results. */
const MAX_TOOL_ROUNDS = 8;
/** The most of a tool's result a model gets, in characters. */
const MAX_TOOL_RESULT = 20_000;
/** How many earlier messages go along. */
const CONTEXT_MESSAGES = 30;

export interface AgentRunContext {
  settings: AiSettings;
  services: AiService[];
  egos: AgentEgo[];
  accountName: string;
  signal?: AbortSignal;
}

async function loadAgent(id: string): Promise<Agent | null> {
  const { data, error } = await supabase.from("agents").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? ({ ...data, working_hours: parseWorkingHours(data.working_hours) } as unknown as Agent) : null;
}

/**
 * The lines the agent has read and who it talks with: the way to the thread it answers in and the
 * thread so far (up to the answer it writes again).
 */
async function conversationContext(run: AgentRun, speaker: Agent, ctx: AgentRunContext) {
  const conversationId = run.conversation_id!;
  const { data: conversation, error } = await supabase.from("agent_conversations").select("*").eq("id", conversationId).single();
  if (error) throw error;
  const c = conversation as AgentConversation;
  const { data: stored, error: messagesError } = await supabase
    .from("agent_messages")
    .select("id, parent_id, soft_deleted_at, author_kind, author_ego_id, author_agent_id, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (messagesError) throw messagesError;
  const rows = agentThreadContext(stored ?? [], run.message_parent_id ?? null, run.replace_message_id);
  const otherAgentId = c.with_kind === "agent" ? (c.agent_id === speaker.id ? c.with_agent_id : c.agent_id) : null;
  const otherAgent = otherAgentId ? await loadAgent(otherAgentId) : null;
  const ego = c.with_ego_id ? ctx.egos.find((e) => e.id === c.with_ego_id) : null;
  const withName = otherAgent ? otherAgent.name : ego ? `${ego.name} (@${ego.username})` : ctx.accountName || "the user";
  const lines: PromptLine[] = rows.map((m) => ({
    own: m.author_kind === "agent" && m.author_agent_id === speaker.id,
    author: m.author_kind === "agent" ? (m.author_agent_id === otherAgent?.id ? otherAgent.name : speaker.name) : withName,
    text: m.content,
  }));
  const situation: PromptSituation = { kind: "direct", with: withName, withAgent: !!otherAgent, topic: c.topic, thread: !!run.message_parent_id };
  return { lines, situation };
}

/** The channel thread's lines (the thread from its top, up to the message the agent answers), from the host. */
async function channelContext(run: AgentRun, speaker: Agent) {
  const channels = agentsHost().channels;
  const { channel, lines } = channels
    ? await channels.context({ channelId: run.channel_id!, parentId: run.channel_parent_id, speakerUsername: speaker.username })
    : { channel: null, lines: [] as PromptLine[] };
  const situation: PromptSituation = { kind: "channel", channel, thread: !!run.channel_parent_id };
  return { lines, situation };
}

/** The tools an agent may use, from the app router's /mcp (empty when it may use none). */
async function agentTools(agent: Agent, providerSupportsTools: boolean, signal?: AbortSignal): Promise<{ tools: McpTool[]; instructions: string }> {
  if (agent.tool_access === "none" || !providerSupportsTools) return { tools: [], instructions: "" };
  try {
    const listed = await listAppTools(signal);
    return { tools: listed.tools.filter((tool) => agentMayUseTool(agent.tool_access, tool)), instructions: listed.instructions };
  } catch (caught) {
    console.warn("agents: couldn't list the apps' tools", caught);
    return { tools: [], instructions: "" };
  }
}

async function finishRun(runId: string, values: { status: "done" | "failed" | "skipped"; output?: string | null; error?: string | null; metrics?: AiMetrics | null }) {
  const { error } = await supabase
    .from("agent_runs")
    .update({ status: values.status, output: values.output ?? null, error: values.error ?? null, metrics: (values.metrics ?? null) as Json, finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.warn("agents: couldn't log the run", error);
}

/**
 * Does one claimed run in the browser: builds the agent's prompt for where it answers (a direct
 * thread, a channel thread, or a task), asks its model, letting it call the apps' MCP tools its
 * `tool_access` allows (no one is asked: the agent works on its own), and posts the answer as the
 * agent: in the thread, in the channel, or (for a task without a channel) in the owner's direct
 * thread with it. The run is logged done or failed either way.
 */
export async function executeAgentRun(run: AgentRun, ctx: AgentRunContext): Promise<void> {
  const used: NonNullable<AiMetrics["tools"]> = [];
  let metrics: AiMetrics | null = null;
  let content = "";
  let failure: string | null = null;
  const speaker = await loadAgent(run.speaker_agent_id ?? run.agent_id).catch(() => null);
  if (!speaker || speaker.status !== "active") {
    await finishRun(run.id, { status: "skipped", error: speaker ? `The agent is ${speaker.status}` : "The agent is gone" });
    return;
  }
  try {
    const provider = getAiProvider(speaker.provider);
    if (!provider) throw new Error(`No AI provider "${speaker.provider}"`);
    const model = speaker.model?.trim() || (typeof ctx.settings.defaultModel === "string" ? ctx.settings.defaultModel.trim() : "");
    if (!model) throw new Error("The agent has no model");
    const service = speaker.service_id ? (ctx.services.find((s) => s.id === speaker.service_id) ?? null) : null;

    const context = run.conversation_id
      ? await conversationContext(run, speaker, ctx)
      : run.channel_id
        ? await channelContext(run, speaker)
        : { lines: [] as PromptLine[], situation: { kind: "task" } as PromptSituation };
    if (run.schedule_id && context.situation.kind !== "direct") {
      const { data: schedule } = await supabase.from("agent_schedules").select("title").eq("id", run.schedule_id).maybeSingle();
      if (context.situation.kind === "task") context.situation = { kind: "task", title: schedule?.title ?? null };
    }
    const tools = await agentTools(speaker, !!provider.supportsTools, ctx.signal);
    let system = agentSystemPrompt(speaker, context.situation);
    if (tools.tools.length && tools.instructions.trim()) system += `\n\nYou can use these apps through their tools:\n${tools.instructions.trim()}`;
    const messages: AiChatMessage[] = agentPromptMessages(system, context.lines, run.instructions, CONTEXT_MESSAGES);

    const runTool = async (call: AiToolCall): Promise<string> => {
      const tool = tools.tools.find((t) => t.name === call.name);
      let text: string;
      let ok = false;
      if (!tool) {
        text = `There is no tool named ${call.name}, or the agent may not use it.`;
      } else {
        try {
          const answer = await callAppTool(call.name, call.arguments, ctx.signal);
          text = toolResultText(answer);
          ok = !answer.isError;
        } catch (caught) {
          text = caught instanceof Error ? caught.message : String(caught);
        }
      }
      used.push({ name: call.name, ...(tool?.title ? { title: tool.title } : {}), ok });
      return text.length > MAX_TOOL_RESULT ? `${text.slice(0, MAX_TOOL_RESULT)}…` : text;
    };

    for (let round = 0; ; round++) {
      const result = await provider.chat(ctx.settings, {
        model,
        messages,
        temperature: speaker.temperature ?? (typeof ctx.settings.temperature === "number" ? ctx.settings.temperature : undefined),
        signal: ctx.signal,
        service,
        ...(tools.tools.length && round < MAX_TOOL_ROUNDS ? { tools: aiToolsFor(tools.tools) } : {}),
        ...(provider.runsTools ? { runTool } : {}),
        onToken: () => undefined,
      });
      if (result.content) content = content ? `${content}\n\n${result.content}` : result.content;
      metrics = result.metrics ?? null;
      if (!result.toolCalls?.length || round >= MAX_TOOL_ROUNDS) break;
      messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        messages.push({ role: "tool", content: await runTool(call), toolCallId: call.id, toolName: call.name });
      }
    }
    content = content.trim();
    if (!content) throw new Error("The model gave no answer");
  } catch (caught) {
    failure = caught instanceof Error ? caught.message : String(caught);
  }

  const allMetrics: AiMetrics | null = used.length ? { ...(metrics ?? {}), tools: used } : metrics;
  try {
    await postAnswer(run, speaker, content, failure, allMetrics);
  } catch (caught) {
    failure = failure ?? (caught instanceof Error ? caught.message : String(caught));
  }
  await finishRun(run.id, { status: failure ? "failed" : "done", output: content || null, error: failure, metrics: allMetrics });
}

/** Posts what the agent answered where the run says, as the agent. */
async function postAnswer(run: AgentRun, speaker: Agent, content: string, failure: string | null, metrics: AiMetrics | null) {
  if (run.channel_id && !run.conversation_id) {
    if (!content) return;
    const channels = agentsHost().channels;
    if (!channels) throw new Error("This app has no channels to post in");
    await channels.post({ channelId: run.channel_id, parentId: run.channel_parent_id, agentId: speaker.id, userId: run.user_id, body: content });
    return;
  }
  const conversationId = run.conversation_id ?? (await openAgentConversation(speaker.id, "account"));
  if (!content && !failure) return;
  if (run.replace_message_id) {
    // Written again: the earlier answer stays when the new one failed outright.
    if (!content) return;
    const { data, error } = await supabase
      .from("agent_messages")
      .update({ content, error: failure, metrics: metrics as Json, run_id: run.id, edited_at: new Date().toISOString() })
      .eq("id", run.replace_message_id)
      .select("id");
    if (error) throw error;
    if (data?.length) return;
  }
  const { error } = await supabase.from("agent_messages").insert({
    conversation_id: conversationId,
    parent_id: run.message_parent_id,
    author_kind: "agent",
    author_agent_id: speaker.id,
    content,
    error: failure,
    metrics: metrics as Json,
    run_id: run.id,
  });
  if (error) throw error;
}

const KICK_EVENT = "gondol:agent-runs";

/** Asks every mounted runner (useAgentRunner) to look for due runs now, e.g. right after queueing one. */
export function kickAgentRunners(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(KICK_EVENT));
}

/**
 * Answers the agents a channel message @mentions: each of the user's own agents gets a run that
 * replies under the message (at once while it's at work, else when its working hours start).
 */
export async function answerAgentMentions(input: { body: string; channelId: string; messageId: string }): Promise<number> {
  const ids = mentionedAgentIds(input.body);
  if (!ids.length) return 0;
  const userId = await sessionUserId();
  const { data, error } = await supabase.from("agents").select("id").in("id", ids).eq("user_id", userId).eq("status", "active");
  if (error) throw error;
  for (const agent of data ?? []) {
    await queueAgentRun({ agentId: agent.id, trigger: "mention", channelId: input.channelId, channelParentId: input.messageId });
  }
  if (data?.length) kickAgentRunners();
  return data?.length ?? 0;
}

/**
 * Runs the user's due agent runs in this browser while it's mounted (the Agents app, Channels):
 * claims them every 20 seconds and right after `kick()`, so a direct message or a mention is
 * answered at once, and scheduled work gets done even without the server runner. Claiming makes
 * sure no run is done twice (by two tabs, or by the server).
 */
export function useAgentRunner() {
  const queryClient = useQueryClient();
  const { settings, isLoading } = useAiSettings();
  const services = useAiServices();
  const egos = agentsHost().useEgos();
  const busy = useRef(false);
  const context = useRef<Omit<AgentRunContext, "accountName"> | null>(null);
  context.current = isLoading || services.isLoading || egos.isLoading ? null : { settings, services: services.data ?? [], egos: egos.data ?? [] };

  const kick = useCallback(async () => {
    if (busy.current || !context.current) return;
    busy.current = true;
    try {
      const { data: session } = await supabase.auth.getSession();
      const accountName = accountDisplayName(session.session?.user);
      for (let i = 0; i < 10; i++) {
        const claimed = await claimAgentRuns();
        if (!claimed.length) break;
        for (const run of claimed) {
          await executeAgentRun(run, { ...context.current!, accountName });
          void queryClient.invalidateQueries({ queryKey: agentRunsKey(run.agent_id) });
          if (run.conversation_id) void queryClient.invalidateQueries({ queryKey: agentMessagesKey(run.conversation_id) });
          void queryClient.invalidateQueries({ queryKey: agentConversationsKey(run.agent_id) });
          if (run.channel_id) {
            for (const queryKey of agentsHost().channels?.queryKeys ?? []) void queryClient.invalidateQueries({ queryKey });
          }
        }
      }
    } catch (caught) {
      console.warn("agents: couldn't run the agents' work", caught);
    } finally {
      busy.current = false;
    }
  }, [queryClient]);

  const ready = !!context.current;
  useEffect(() => {
    if (!ready) return;
    void kick();
    const timer = window.setInterval(() => void kick(), 20_000);
    const onKick = () => void kick();
    window.addEventListener(KICK_EVENT, onKick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(KICK_EVENT, onKick);
    };
  }, [ready, kick]);

  return { kick };
}
