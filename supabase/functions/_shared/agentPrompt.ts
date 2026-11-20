// What an AI agent (the agents app, src/builtin/agents) is told when it works: who it is, when and where
// it is, and the conversation so far. Shared by the browser (src/builtin/agents/models/runAgent.ts) and
// the ai-agents edge function, so plain TypeScript without imports.

export interface PromptAgent {
  id: string;
  name: string;
  username: string;
  gender: string | null;
  title: string | null;
  bio: string | null;
  instructions: string | null;
  time_zone: string;
}

/** Where the agent answers. */
export type PromptSituation =
  | { kind: "direct"; with: string; withAgent?: boolean; topic?: string | null; thread?: boolean }
  | { kind: "channel"; channel: string | null; thread: boolean }
  | { kind: "task"; title?: string | null };

/** One message of the conversation so far, by who wrote it. */
export interface PromptLine {
  /** The agent itself wrote it. */
  own: boolean;
  author: string;
  text: string;
}

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const GENDER_WORDS: Record<string, string> = {
  female: "a woman",
  male: "a man",
  non_binary: "non-binary",
  agender: "agender",
  genderfluid: "genderfluid",
};

/** "Saturday 24 October 2026, 14:05 (Europe/Stockholm)". */
export function agentLocalNow(timeZone: string, at: Date = new Date()): string {
  try {
    const text = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "full", timeStyle: "short" }).format(at);
    return `${text} (${timeZone})`;
  } catch {
    return at.toISOString();
  }
}

/** The agent's instructions: who it is, its own instructions, the time and where it answers. */
export function agentSystemPrompt(agent: PromptAgent, situation: PromptSituation, at: Date = new Date()): string {
  const who = [`You are ${agent.name} (@${agent.username})${agent.title ? `, ${agent.title}` : ""}, an AI agent working in Spacify.`];
  const gender = agent.gender ? GENDER_WORDS[agent.gender] : null;
  if (gender) who.push(`You are ${gender}.`);
  const parts = [who.join(" ")];
  if (agent.bio?.trim()) parts.push(`About you: ${agent.bio.trim()}`);
  if (agent.instructions?.trim()) parts.push(agent.instructions.trim());
  parts.push(`It is now ${agentLocalNow(agent.time_zone, at)}.`);
  switch (situation.kind) {
    case "direct":
      parts.push(
        situation.withAgent
          ? `You are in a direct conversation with another AI agent, ${situation.with}. Write your next message to them, as yourself, without a name prefix.`
          : `You are in a direct conversation with ${situation.with}. Answer their latest message.`,
      );
      if (situation.thread) parts.push("You are replying in a thread under one of the conversation's messages: answer what is being discussed there.");
      if (situation.topic?.trim()) parts.push(`The conversation is about: ${situation.topic.trim()}`);
      break;
    case "channel":
      parts.push(
        `You are posting in ${situation.channel ? `the #${situation.channel} channel` : "a channel"}${situation.thread ? ", replying in a thread. Answer what you were asked there" : ""}. Messages are shown with the author's name first; write only your own message, without a name prefix.`,
      );
      break;
    case "task":
      parts.push(`You are carrying out a task${situation.title ? ` ("${situation.title}")` : ""} on your own. Do it, using your tools when they help, and answer with the result, as you would report it.`);
      break;
  }
  return parts.join("\n\n");
}

/**
 * The messages for the model: the instructions, the latest `limit` lines (the agent's own as its
 * answers, everyone else's as "Name: text"), and the task's instructions last.
 */
export function agentPromptMessages(system: string, lines: PromptLine[], task: string | null | undefined, limit = 30): PromptMessage[] {
  const messages: PromptMessage[] = [{ role: "system", content: system }];
  for (const line of lines.slice(-limit)) {
    if (!line.text.trim()) continue;
    messages.push(line.own ? { role: "assistant", content: line.text } : { role: "user", content: `${line.author}: ${line.text}` });
  }
  if (task?.trim()) messages.push({ role: "user", content: task.trim() });
  // A model needs something to answer.
  if (messages.length === 1) messages.push({ role: "user", content: "Start the conversation." });
  return messages;
}

/** Whether a tool may run for an agent with this tool access (MCP annotations decide what only reads). */
export function agentMayUseTool(access: string, tool: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }): boolean {
  if (access === "all") return true;
  if (access !== "read") return false;
  // The user's own MCP servers' hints are their own say-so (gondol's toolNeedsApproval()).
  if (/^mcp_[0-9a-f]{8}__/.test(tool.name)) return false;
  return !!tool.annotations?.readOnlyHint && !tool.annotations?.destructiveHint;
}

/** A message of a direct conversation, as much as placing it in its thread takes. */
export interface ThreadRow {
  id: string;
  parent_id: string | null;
  created_at: string;
  soft_deleted_at: string | null;
}

/**
 * What an agent has read when it answers in the thread under `parentId` (null: the conversation's
 * own line): every level on the way there, up to and including the message the thread hangs on,
 * then the thread so far, oldest first and without deleted messages. `before` stops just before
 * that message of the thread (writing it again). The same as gondol's threadContext().
 */
export function agentThreadContext<T extends ThreadRow>(rows: T[], parentId: string | null, before?: string | null): T[] {
  const byId = new Map(rows.map((m) => [m.id, m]));
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const list = byParent.get(row.parent_id ?? null);
    if (list) list.push(row);
    else byParent.set(row.parent_id ?? null, [row]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const level = (parent: string | null, cut?: { id: string; inclusive: boolean }) => {
    const own = byParent.get(parent) ?? [];
    if (!cut) return own;
    const at = own.findIndex((m) => m.id === cut.id);
    return at < 0 ? own : own.slice(0, cut.inclusive ? at + 1 : at);
  };
  const seen = new Set<string>();
  const walk = (parent: string | null, cut?: { id: string; inclusive: boolean }): T[] => {
    if (parent === null || seen.has(parent)) return level(null, cut);
    seen.add(parent);
    const message = byId.get(parent);
    const above = message ? walk(message.parent_id ?? null, { id: message.id, inclusive: true }) : [];
    return [...above, ...level(parent, cut)];
  };
  return walk(parentId, before ? { id: before, inclusive: false } : undefined).filter((m) => !m.soft_deleted_at);
}
