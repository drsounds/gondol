import { defineHook, resolutionsOf } from "../../../apps/contributions";
import type { PromptLine } from "../../../../supabase/functions/_shared/agentPrompt.ts";

/**
 * What the host app can tell the agents app, by answering `agentsHostHook` in
 * `configureGondol({ resolutions })`. Everything is optional: without `useEgos` agents only talk
 * with the account and each other, and without `channels` they work in direct threads only.
 */

/** Someone the user acts as (an alter ego), whom an agent can have its own threads with. */
export interface AgentEgo {
  id: string;
  name: string;
  username: string;
}

/** A channel an agent's schedule can post to. */
export interface AgentChannel {
  id: string;
  name: string;
}

export interface AgentsHostChannels {
  /** The channels the user can post to (for a schedule's "Post to"). */
  useChannels(): { data?: AgentChannel[] };
  /** The channel's name and the thread an agent answers: from its top down to `parentId` and its replies. */
  context(input: { channelId: string; parentId: string | null; speakerUsername: string }): Promise<{ channel: string | null; lines: PromptLine[] }>;
  /** Posts an agent's answer in the channel (under `parentId`, when it answers a thread). */
  post(input: { channelId: string; parentId: string | null; agentId: string; userId: string; body: string }): Promise<void>;
  /** Query keys to refetch after an agent has posted in a channel. */
  queryKeys?: readonly (readonly unknown[])[];
}

export interface AgentsHost {
  /** The user's alter egos (the host's `egos` table, which `agent_conversations.with_ego_id` refers to). */
  useEgos(): { data?: AgentEgo[]; isLoading: boolean };
  channels?: AgentsHostChannels;
}

export const agentsHostHook = defineHook<Partial<AgentsHost>>("agents.host");

const NO_EGOS = { data: [] as AgentEgo[], isLoading: false };

/** Every answer to `agentsHostHook`, merged (later answers win). Stable for the life of the page. */
export function agentsHost(): AgentsHost {
  return Object.assign({ useEgos: () => NO_EGOS }, ...resolutionsOf(agentsHostHook).map((a) => a.value)) as AgentsHost;
}

/** A signed-in user's display name: their full name, else the part of the e-mail before the @. */
export function accountDisplayName(user: { email?: string; user_metadata?: Record<string, unknown> } | undefined): string {
  const meta = user?.user_metadata ?? {};
  const fromMeta = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
  return fromMeta ?? user?.email?.split("@")[0] ?? "";
}

/** "@Jane Doe" → "jane-doe": how a typed @username is stored (the same as alter egos'). */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase().replace(/\s+/g, "-");
}

/** 2–30 lowercase letters, digits, _ and -, starting with a letter or digit (the database checks the same). */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,29}$/;

export const isValidUsername = (username: string) => USERNAME_PATTERN.test(username);

const NO_CHANNELS = { data: [] as AgentChannel[] };
const useNoChannels = () => NO_CHANNELS;

/** The host's alter egos (none without an answer to `agentsHostHook`). */
export function useAgentEgos(): { data?: AgentEgo[]; isLoading: boolean } {
  return agentsHost().useEgos();
}

/** The host's channels (none when it has no channels). */
export function useAgentChannels(): { data?: AgentChannel[] } {
  const useChannels = agentsHost().channels?.useChannels ?? useNoChannels;
  return useChannels();
}
