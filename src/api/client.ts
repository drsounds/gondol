import { FunctionsHttpError } from "@supabase/supabase-js";
import { getInternalApp } from "../apps/registry";
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

/**
 * What the router lets the caller's MCP tools reach (router.ts): the apps they have on
 * (`x-gondol-apps`) and the entity types the site shows (`x-gondol-entity-types`); null: no limit.
 */
export type AppRouterScope = { apps: string[] | null; entityTypes: string[] | null };

let scope: AppRouterScope = { apps: null, entityTypes: null };

/** Narrows what the router serves this browser (the ai app sets it from the apps on and the site). */
export function setAppRouterScope(next: AppRouterScope): void {
  scope = next;
}

function scopeHeaders(): Record<string, string> {
  return {
    ...(scope.apps ? { "x-gondol-apps": scope.apps.join(",") } : {}),
    ...(scope.entityTypes ? { "x-gondol-entity-types": scope.entityTypes.join(",") } : {}),
  };
}

async function invoke<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal; actor?: string | null }): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`${functionName}${path}`, {
    method: init.method ?? "POST",
    headers: { ...scopeHeaders(), ...(init.actor ? { "x-gondol-actor": init.actor } : {}) },
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

/**
 * Runs a function of a remote app served by `gondol-apps dev` (apps/remote): straight on the
 * runtime on this device, without the app router or an admin's approval, the way its backend will
 * be called once approved (the input as JSON, the user's id in `x-gondol-user`).
 */
async function callDevRuntime<T>(functionsUrl: string, appId: string, name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`${functionsUrl.replace(/\/+$/, "")}/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-gondol-app": appId,
      "x-gondol-function": name,
      ...(data.session?.user.id ? { "x-gondol-user": data.session.user.id } : {}),
    },
    body: JSON.stringify(input),
    signal,
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (response.ok) return body as T;
  const detail = body && typeof body === "object" ? ((body as { detail?: string }).detail ?? (body as { title?: string }).title) : undefined;
  throw new AppRouterError(detail ?? `The apps runtime answered ${response.status}`, response.status);
}

/** Runs an app's server function (its manifest's `functions.<name>`) with `input`. */
export function callAppFunction<T = unknown>(appId: string, name: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const remote = getInternalApp(appId)?.remote;
  if (remote?.dev && remote.functionsUrl && remote.functions.includes(name)) return callDevRuntime<T>(remote.functionsUrl, appId, name, input, signal);
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
  /** One of the user's own MCP servers (ai_mcp_servers), with its tools as it listed them. */
  userServer?: boolean;
  /** Why a user's server couldn't list its tools. */
  error?: string;
  /** gondol's own tools (apps__…, entities__…), served as an app. */
  builtin?: boolean;
};

export async function fetchAppCatalog(signal?: AbortSignal): Promise<{ mcp: string; apps: AppCatalogEntry[] }> {
  return await invoke(`/apps`, { method: "GET", signal });
}

let nextId = 1;

/**
 * One JSON-RPC request to the router's MCP server (`/mcp`, or one app's with `appId`). `actor` is the
 * entity URI of whoever is acting (an AI conversation, an agent), sent as `x-gondol-actor`; the
 * router passes it on to the database, so the app can tell writes made by AI from the user's own.
 */
export async function mcpRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  options: { appId?: string; signal?: AbortSignal; actor?: string | null } = {},
): Promise<T> {
  const path = options.appId ? `/apps/${encodeURIComponent(options.appId)}/mcp` : "/mcp";
  const answer = await invoke<{ result?: T; error?: { code: number; message: string } }>(path, {
    body: { jsonrpc: "2.0", id: nextId++, method, params },
    signal: options.signal,
    actor: options.actor,
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

/** Runs a tool (as `actor`, see mcpRequest()); a failure is a result with `isError`, as MCP has it. */
export function callAppTool(name: string, args: Record<string, unknown>, signal?: AbortSignal, actor?: string | null): Promise<McpToolResult> {
  return mcpRequest<McpToolResult>("tools/call", { name, arguments: args }, { signal, actor });
}

/** A tool result as text, for a model. */
export function toolResultText(result: McpToolResult): string {
  return result.content
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : JSON.stringify(part)))
    .join("\n");
}

export type { McpTool, McpToolResult };
