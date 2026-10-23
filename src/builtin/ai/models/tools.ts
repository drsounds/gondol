import { useQuery } from "@tanstack/react-query";
import { listAppTools, type AppTools, type McpTool } from "../../../api/client";
import type { AiSettings, AiTool } from "./provider";

/**
 * The apps' tools in the chat: the ai app is an MCP client of the app router's `/mcp` (router.ts),
 * which serves every app's manifest `mcp` tools (and apps' own MCP servers' tools) as one server.
 * The model gets them as functions it may call; what the apps tell it about themselves (their
 * `instructions`) goes with the conversation's instructions.
 */

export const aiAppToolsKey = ["gondol", "ai", "app-tools"] as const;

/** Whether the chat hands the model the apps' tools (the `appTools` setting, on by default). */
export function appToolsEnabled(settings: AiSettings): boolean {
  return settings.appTools !== false;
}

/** The apps' tools, while the setting is on; empty when the router isn't deployed. */
export function useAiAppTools(settings: AiSettings) {
  const enabled = appToolsEnabled(settings);
  const query = useQuery({
    queryKey: aiAppToolsKey,
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => listAppTools(signal),
  });
  return { ...query, tools: enabled ? (query.data ?? null) : null };
}

/** MCP tools as a model's functions. */
export function aiToolsFor(tools: McpTool[]): AiTool[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema as Record<string, unknown> }));
}

/** The tools of the user's own MCP servers (router.ts's userMcpAppId()), whose hints are their own say-so. */
const USER_SERVER_TOOL = /^mcp_[0-9a-f]{8}__/;

/**
 * Whether the user is asked before a tool runs (the `toolApproval` setting: changes, always, never).
 * With `changes`, a tool of the user's own MCP servers is asked about even when it says it only reads.
 */
export function toolNeedsApproval(tool: McpTool, settings: AiSettings): boolean {
  const approval = typeof settings.toolApproval === "string" ? settings.toolApproval : "changes";
  if (approval === "never") return false;
  if (approval === "always" || USER_SERVER_TOOL.test(tool.name)) return true;
  return !tool.annotations?.readOnlyHint || !!tool.annotations?.destructiveHint;
}

/** The instructions with what the apps say about themselves, for a model that has their tools. */
export function instructionsWithApps(instructions: string, tools: AppTools | null): string {
  if (!tools?.tools.length || !tools.instructions.trim()) return instructions;
  const apps = `You can use these apps through their tools:\n${tools.instructions.trim()}`;
  return instructions ? `${instructions}\n\n${apps}` : apps;
}

export type { AppTools, McpTool };
