import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../supabase/client";
import type { McpTool, McpToolResult } from "./router";

/**
 * Calling the app router (router.ts) from the browser, as the signed-in user: apps' server functions
 * (`callAppFunction`), the catalogue of apps (`fetchAppCatalog`) and the MCP server of every app's
 * tools (`mcpRequest`, `listAppTools`, `callAppTool`), which the ai app hands its models.
 */

let functionName = "app-router";

/** Names the edge function that serves the router (default `app-router`). */
export function configureAppRouter(options: { functionName?: string }): void {
  if (options.functionName) functionName = options.functionName;
}

/** The router failed, or a function it ran did (`status` is the HTTP status). */
export class AppRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AppRouterError";
  }
}

async function invoke<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`${functionName}${path}`, {
    method: init.method ?? "POST",
    ...(init.body !== undefined ? { body: init.body as Record<string, unknown> } : {}),
    signal: init.signal,
  });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    let message = `The app router answered ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string; title?: string };
      message = payload.detail ?? payload.title ?? message;
    } catch {
      // not JSON
    }
    throw new AppRouterError(message, response.status);
  }
  throw new AppRouterError(error instanceof Error ? error.message : String(error));
}

/** Runs an app's server function (its manifest's `functions.<name>`) with `input`. */
export function callAppFunction<T = unknown>(appId: string, name: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  return invoke<T>(`/apps/${encodeURIComponent(appId)}/functions/${encodeURIComponent(name)}`, { body: input, signal });
}

/** An app as the router's catalogue describes it, with what the user may call. */
export type AppCatalogEntry = {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  functions: { name: string; title?: string; description: string; url: string; input: unknown; readOnly: boolean; destructive: boolean }[];
  tools: McpTool[];
  mcp: string;
  ownMcpServer: boolean;
};

export async function fetchAppCatalog(signal?: AbortSignal): Promise<{ mcp: string; apps: AppCatalogEntry[] }> {
  return await invoke(`/apps`, { method: "GET", signal });
}

let nextId = 1;

/** One JSON-RPC request to the router's MCP server (`/mcp`, or one app's with `appId`). */
export async function mcpRequest<T = unknown>(method: string, params: Record<string, unknown> = {}, options: { appId?: string; signal?: AbortSignal } = {}): Promise<T> {
  const path = options.appId ? `/apps/${encodeURIComponent(options.appId)}/mcp` : "/mcp";
  const answer = await invoke<{ result?: T; error?: { code: number; message: string } }>(path, {
    body: { jsonrpc: "2.0", id: nextId++, method, params },
    signal: options.signal,
  });
  if (answer?.error) throw new AppRouterError(answer.error.message);
  return answer.result as T;
}

/** What the apps offer AI models: their tools (named `<app>__<tool>`) and the instructions. */
export type AppTools = { tools: McpTool[]; instructions: string };

export async function listAppTools(signal?: AbortSignal): Promise<AppTools> {
  const [init, list] = await Promise.all([
    mcpRequest<{ instructions?: string }>("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gondol-ai", version: "1.0.0" } }, { signal }),
    mcpRequest<{ tools: McpTool[] }>("tools/list", {}, { signal }),
  ]);
  return { tools: list?.tools ?? [], instructions: init?.instructions ?? "" };
}

/** Runs a tool; a failure is a result with `isError`, as MCP has it. */
export function callAppTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
  return mcpRequest<McpToolResult>("tools/call", { name, arguments: args }, { signal });
}

/** A tool result as text, for a model. */
export function toolResultText(result: McpToolResult): string {
  return result.content
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : JSON.stringify(part)))
    .join("\n");
}

export type { McpTool, McpToolResult };
