import { useQuery } from "@tanstack/react-query";
import { supabase } from "./db";
import { entityIdentifier, entityKey, findByEntityKey } from "../../../entities/slugs";
import { sessionUserId } from "../../../supabase/session";
import type { Json } from "../../../supabase/types";
import { entityUriScheme } from "../../../entities/uri";

/** An agent's gender, as it describes itself. */
export const AGENT_GENDERS = ["female", "male", "non_binary", "agender", "genderfluid", "other"] as const;
export type AgentGender = (typeof AGENT_GENDERS)[number];

/** How far an agent may use the apps' MCP tools on its own: none, the ones that only read, or all. */
export const AGENT_TOOL_ACCESS = ["none", "read", "all"] as const;
export type AgentToolAccess = (typeof AGENT_TOOL_ACCESS)[number];

/** Employment: active (works), suspended (paused, keeps its hire date) or fired (rehire to start over). */
export const AGENT_STATUSES = ["active", "suspended", "fired"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** ISO weekdays, Monday = 1. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** One working window: a weekday and a local start and end time ("HH:MM", end after start). */
export interface WorkingWindow {
  day: number;
  start: string;
  end: string;
}

/**
 * An AI agent (`agents`): a language model hired to work for the user under its own name and
 * @username (shared with egos), with an avatar, a gender and a job title. It runs on a provider of
 * the ai app (optionally one of the user's AI services) and may use the apps' MCP tools as far as
 * `tool_access` says. It works in `working_hours` (none = always) in its time zone. Private to its
 * owner.
 */
export interface Agent {
  id: string;
  user_id: string;
  slug: string;
  identifier?: string;
  name: string;
  username: string;
  avatar_media_id: string | null;
  gender: AgentGender | null;
  title: string | null;
  bio: string | null;
  instructions: string | null;
  provider: string;
  service_id: string | null;
  model: string | null;
  temperature: number | null;
  tool_access: AgentToolAccess;
  time_zone: string;
  working_hours: WorkingWindow[];
  status: AgentStatus;
  hired_at: string;
  suspended_at: string | null;
  fired_at: string | null;
  created_at: string;
  updated_at: string;
}

const AGENT_COLUMNS =
  "id, user_id, slug, identifier, name, username, avatar_media_id, gender, title, bio, instructions, provider, service_id, model, temperature, tool_access, time_zone, working_hours, status, hired_at, suspended_at, fired_at, created_at, updated_at";

export const agentsQueryKey = ["agents"] as const;

export const agentsQueryOptions = {
  queryKey: agentsQueryKey,
  queryFn: async () => {
    const userId = await sessionUserId();
    const { data, error } = await supabase.from("agents").select(AGENT_COLUMNS).eq("user_id", userId).is("soft_deleted_at", null).order("name");
    if (error) throw error;
    // Active agents first, then suspended, fired last; by name within each.
    const rank = { active: 0, suspended: 1, fired: 2 } as Record<string, number>;
    return ((data ?? []).map((row) => ({ ...row, working_hours: parseWorkingHours(row.working_hours) })) as Agent[]).sort(
      (a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3),
    );
  },
};

export function useAgents() {
  return useQuery(agentsQueryOptions);
}

/** The agent a URL key names: its slug, identifier or uuid, or else its @username. */
export function findAgent(agents: Agent[], key: string): Agent | undefined {
  const name = key.replace(/^@/, "").toLowerCase();
  return findByEntityKey(agents, key) ?? agents.find((a) => a.username.toLowerCase() === name);
}

/** Working hours from the jsonb column, dropping anything malformed. */
export function parseWorkingHours(value: Json | unknown): WorkingWindow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((w): w is WorkingWindow => !!w && typeof w === "object" && typeof (w as WorkingWindow).day === "number")
    .map((w) => ({ day: w.day, start: String(w.start ?? ""), end: String(w.end ?? "") }))
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
}

/** Monday to Friday, 09:00–17:00: what a new agent starts with. */
export const OFFICE_HOURS: WorkingWindow[] = [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" }));

const minutes = (clock: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(clock);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Whether the windows are well-formed (what agents_before_write() checks). */
export function validWorkingHours(windows: WorkingWindow[]): boolean {
  return windows.every((w) => WEEKDAYS.includes(w.day as never) && minutes(w.start) < minutes(w.end) && minutes(w.end) <= 1440);
}

/** A moment as weekday (ISO) and minutes since midnight in a time zone. */
function localParts(at: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Whether an agent works at a moment (mirrors agent_is_working()). */
export function agentIsWorking(agent: Pick<Agent, "status" | "working_hours" | "time_zone">, at: Date = new Date()): boolean {
  if (agent.status !== "active") return false;
  if (!agent.working_hours.length) return true;
  let local: { day: number; minute: number };
  try {
    local = localParts(at, agent.time_zone);
  } catch {
    return false;
  }
  return agent.working_hours.some((w) => w.day === local.day && local.minute >= minutes(w.start) && local.minute < minutes(w.end));
}

/** The time zones the browser knows, for the time zone picker. */
export function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? ["UTC", "Europe/Stockholm"];
  } catch {
    return ["UTC", "Europe/Stockholm"];
  }
}

/** The badge tone for an agent's status. */
export function agentStatusTone(status: AgentStatus): "success" | "warning" | "danger" {
  return status === "active" ? "success" : status === "suspended" ? "warning" : "danger";
}

/** Whether an agent works now and when it next does (agent_availability(), refreshed each minute). */
export function useAgentAvailability(agentIds: string[]) {
  const ids = [...agentIds].sort();
  return useQuery({
    queryKey: ["agent-availability", ids],
    enabled: ids.length > 0,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("agent_availability", { p_agent_ids: ids });
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.agent_id, row]));
    },
  });
}

// ---- Schedules --------------------------------------------------------------------------------

/** Instructions an agent carries out on a cron schedule (agent_schedules). */
export interface AgentSchedule {
  id: string;
  slug: string;
  identifier?: string;
  agent_id: string;
  title: string;
  instructions: string;
  cron: string;
  enabled: boolean;
  outside_hours: boolean;
  channel_id: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export const agentSchedulesKey = (agentId: string | null) => ["agent-schedules", agentId ?? ""] as const;

export function useAgentSchedules(agentId: string | null) {
  return useQuery({
    queryKey: agentSchedulesKey(agentId),
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_schedules")
        .select("id, slug, identifier, agent_id, title, instructions, cron, enabled, outside_hours, channel_id, last_run_at, created_at, updated_at")
        .eq("agent_id", agentId!)
        .order("title");
      if (error) throw error;
      return (data ?? []) as AgentSchedule[];
    },
  });
}

/** Ready-made schedules for the cron field. */
export const CRON_PRESETS = [
  { cron: "0 9 * * 1-5", key: "weekdays9" },
  { cron: "0 * * * *", key: "hourly" },
  { cron: "0 8 * * *", key: "daily8" },
  { cron: "0 16 * * 5", key: "friday16" },
  { cron: "0 9 1 * *", key: "monthly" },
] as const;

/** A five-field cron expression's shape (the server checks it fully, automation_cron_valid()). */
export const isCronShaped = (cron: string) => /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(cron.trim());

// ---- Direct threads ---------------------------------------------------------------------------

export type AgentPartyKind = "account" | "ego" | "agent";

/**
 * A direct conversation between an agent and the account, an ego or another agent
 * (agent_conversations). The main one with each party (`is_main`) is where "Message" goes; any
 * number of others, with a `title`, can be started beside it.
 */
export interface AgentConversation {
  id: string;
  agent_id: string;
  with_kind: AgentPartyKind;
  with_ego_id: string | null;
  with_agent_id: string | null;
  title: string | null;
  is_main: boolean;
  topic: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  author_kind: AgentPartyKind;
  author_ego_id: string | null;
  author_agent_id: string | null;
  content: string;
  metrics: { tools?: { name: string; title?: string; ok: boolean }[] } | null;
  error: string | null;
  run_id: string | null;
  /** The message it replies to, in the thread under it; null on the conversation's own line. */
  parent_id: string | null;
  /** When its author changed it, or the agent wrote the answer again. */
  edited_at: string | null;
  /** Deleted: shown as deleted, restored from the conversation's deleted messages. */
  soft_deleted_at: string | null;
  created_at: string;
}

const CONVERSATION_COLUMNS = "id, agent_id, with_kind, with_ego_id, with_agent_id, title, is_main, topic, last_message_at, created_at";
const MESSAGE_COLUMNS = "id, conversation_id, author_kind, author_ego_id, author_agent_id, content, metrics, error, run_id, parent_id, edited_at, soft_deleted_at, created_at";

export const agentConversationsKey = (agentId: string | null) => ["agent-conversations", agentId ?? ""] as const;

/** An agent's threads: its own and those where another agent talks with it. */
export function useAgentConversations(agentId: string | null) {
  return useQuery({
    queryKey: agentConversationsKey(agentId),
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_conversations")
        .select(CONVERSATION_COLUMNS)
        .or(`agent_id.eq.${agentId},with_agent_id.eq.${agentId}`)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as AgentConversation[];
    },
  });
}

export const agentMessagesKey = (conversationId: string | null) => ["agent-messages", conversationId ?? ""] as const;

/** A thread's messages, oldest first; polled so answers from the server runner show up. */
export function useAgentMessages(conversationId: string | null) {
  return useQuery({
    queryKey: agentMessagesKey(conversationId),
    enabled: !!conversationId,
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId!)
        .order("created_at")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as AgentMessage[];
    },
  });
}

export const agentConversationKey = (id: string | null) => ["agent-conversation", id ?? ""] as const;

/** One conversation, by its id. */
export function useAgentConversation(id: string | null) {
  return useQuery({
    queryKey: agentConversationKey(id),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("agent_conversations").select(CONVERSATION_COLUMNS).eq("id", id!).maybeSingle();
      if (error) throw error;
      return (data ?? null) as AgentConversation | null;
    },
  });
}

/** Every conversation of the user's with any agent, most recent first (the intercom's bubbles). */
export function useAllAgentConversations(enabled = true) {
  return useQuery({
    queryKey: ["agent-conversations", "*"],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const userId = await sessionUserId();
      const { data, error } = await supabase
        .from("agent_conversations")
        .select(CONVERSATION_COLUMNS)
        .eq("user_id", userId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AgentConversation[];
    },
  });
}

/** Starts another conversation with an agent, as the account, beside the main one. */
export async function createAgentConversation(agentId: string, title: string | null = null): Promise<AgentConversation> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .insert({ agent_id: agentId, with_kind: "account", is_main: false, title })
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as AgentConversation;
}

/** What can change about a message once written: its text (an edit), and whether it's deleted. */
export async function updateAgentMessage(id: string, values: { content?: string; deleted?: boolean }): Promise<void> {
  const { error } = await supabase
    .from("agent_messages")
    .update({
      ...(values.content !== undefined ? { content: values.content, edited_at: new Date().toISOString() } : {}),
      ...(values.deleted !== undefined ? { soft_deleted_at: values.deleted ? new Date().toISOString() : null } : {}),
    })
    .eq("id", id);
  if (error) throw error;
}

/** The main thread between an agent and someone, created on first use. */
export async function openAgentConversation(agentId: string, withKind: AgentPartyKind, withId: string | null = null): Promise<string> {
  const { data, error } = await supabase.rpc("open_agent_conversation", { p_agent_id: agentId, p_with_kind: withKind, p_with_id: withId });
  if (error) throw error;
  return data as string;
}

/**
 * The URL part naming who an agent talks with: `me` (the account), `ego/<key>` or `agent/<key>`
 * (keys are slugs), so `/agents/<agent>/messages/<party>` is the thread.
 */
export function partyPath(kind: AgentPartyKind, key: string | null): string {
  return kind === "account" ? "me" : `${kind}/${key}`;
}

/** Where a conversation with an agent lives: the main one with the account at `/agents/<agent>`. */
export function agentConversationPath(agent: Agent, agents: Agent[], egos: { id: string; username: string }[], c: AgentConversation): string | null {
  const base = `/agents/${entityKey(agent)}`;
  if (!c.is_main) return `${base}/conversations/${entityIdentifier(c.id)}`;
  if (c.with_kind === "account") return base;
  if (c.with_kind === "ego") {
    const ego = egos.find((e) => e.id === c.with_ego_id);
    return ego ? `${base}/messages/${partyPath("ego", ego.username)}` : null;
  }
  const other = agents.find((a) => a.id === (c.agent_id === agent.id ? c.with_agent_id : c.agent_id));
  return other ? `${base}/messages/${partyPath("agent", entityKey(other))}` : null;
}

// ---- Runs -------------------------------------------------------------------------------------

export type AgentRunTrigger = "schedule" | "manual" | "message" | "mention";
export type AgentRunStatus = "queued" | "running" | "done" | "failed" | "skipped";

/** One time an agent worked, or will (agent_runs). */
export interface AgentRun {
  id: string;
  user_id: string;
  agent_id: string;
  schedule_id: string | null;
  trigger: AgentRunTrigger;
  status: AgentRunStatus;
  instructions: string | null;
  conversation_id: string | null;
  channel_id: string | null;
  channel_parent_id: string | null;
  speaker_agent_id: string | null;
  message_parent_id: string | null;
  replace_message_id: string | null;
  run_after: string;
  runner: "browser" | "server" | null;
  output: string | null;
  error: string | null;
  metrics: Json | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export const agentPendingRunsKey = (conversationId: string | null) => ["agent-conversation-runs", conversationId ?? ""] as const;

export const agentRunsKey = (agentId: string | null) => ["agent-runs", agentId ?? ""] as const;

export function useAgentRuns(agentId: string | null) {
  return useQuery({
    queryKey: agentRunsKey(agentId),
    enabled: !!agentId,
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("agent_runs").select("*").eq("agent_id", agentId!).order("queued_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as AgentRun[];
    },
  });
}

export function agentRunTone(status: AgentRunStatus): "default" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "done":
      return "success";
    case "failed":
      return "danger";
    case "running":
      return "info";
    case "skipped":
      return "warning";
    default:
      return "default";
  }
}

/**
 * Queues work for an agent (queue_agent_run()): due now while it's at work, else at its next
 * working minute; skipped when it's suspended or fired.
 */
export async function queueAgentRun(input: {
  agentId: string;
  trigger: AgentRunTrigger;
  instructions?: string | null;
  conversationId?: string | null;
  channelId?: string | null;
  channelParentId?: string | null;
  speakerAgentId?: string | null;
  scheduleId?: string | null;
  ignoreHours?: boolean;
  /** Answer in the thread under this message (of `conversationId`). */
  messageParentId?: string | null;
  /** Write this answer again in its place (regenerate, retry). */
  replaceMessageId?: string | null;
}): Promise<AgentRun> {
  const { data, error } = await supabase.rpc("queue_agent_run", {
    p_agent_id: input.agentId,
    p_trigger: input.trigger,
    p_instructions: input.instructions ?? null,
    p_conversation_id: input.conversationId ?? null,
    p_channel_id: input.channelId ?? null,
    p_channel_parent_id: input.channelParentId ?? null,
    p_speaker_agent_id: input.speakerAgentId ?? null,
    p_schedule_id: input.scheduleId ?? null,
    p_ignore_hours: input.ignoreHours ?? false,
    p_message_parent_id: input.messageParentId ?? null,
    p_replace_message_id: input.replaceMessageId ?? null,
  });
  if (error) throw error;
  return data as unknown as AgentRun;
}

/** Claims the user's due runs for this browser (queued → running), never one the server has. */
export async function claimAgentRuns(runId?: string): Promise<AgentRun[]> {
  const { data, error } = await supabase.rpc("claim_agent_runs", { p_runner: "browser", p_limit: 3, p_run_id: runId ?? null });
  if (error) throw error;
  return (data ?? []) as unknown as AgentRun[];
}

/** The agents mentioned in a channel message body: `<scheme>:agent:<id>` URIs or `/channels/people/agent/<id>` links. */
export function mentionedAgentIds(body: string): string[] {
  const ids = new Set<string>();
  const scheme = entityUriScheme().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:${scheme}:agent:|/channels/people/agent/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`, "gi");
  for (const m of body.matchAll(pattern)) {
    ids.add(m[1].toLowerCase());
  }
  return [...ids];
}
