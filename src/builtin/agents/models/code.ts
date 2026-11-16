import { useMemo, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "../../../supabase/client";
import { lazy } from "../../../supabase/fetch";
import { sessionUserId } from "../../../supabase/session";
import { callAppFunction } from "../../../api/client";
import type { Json } from "../../../supabase/types";
import type { RemoteAppSource } from "../../../apps/remote/loader";
import type { PromptWorkspace } from "../../../../supabase/functions/_shared/codeWorkspace.ts";

/**
 * Agentic coding in the agents app (`/code`): the user's code repositories, the sandboxes they run in
 * (OpenHands agent servers), the workspaces that connect an agent conversation to repositories in a
 * sandbox, and the releases of gondol apps built there, which the user publishes into the apps
 * registry. The coding itself is the agents app's MCP tools (`agents__code_*`, answered by the
 * `agent-code` edge function), so an agent codes on its own model with its own runner. The host's
 * migrations create the tables; see docs/guide/agents.md.
 */

/** Where a repository lives. */
export const CODE_PROVIDERS = ["github", "git"] as const;
export type CodeProvider = (typeof CODE_PROVIDERS)[number];

/** A repository agents may work on (`code_repositories`, spacify type `code_repository`). */
export interface CodeRepository {
  id: string;
  user_id: string;
  slug: string;
  identifier?: string;
  name: string;
  full_name: string | null;
  provider: CodeProvider;
  clone_url: string;
  html_url: string | null;
  default_branch: string | null;
  description: string | null;
  private: boolean;
  /** The GitHub MCP server (ai_mcp_servers) whose token clones and pushes it. */
  github_server_id: string | null;
  created_at: string;
  updated_at: string;
}

/** An OpenHands agent server the user's workspaces run in (`code_sandboxes`); its key is write-only. */
export interface CodeSandbox {
  id: string;
  user_id: string;
  slug: string;
  identifier?: string;
  name: string;
  url: string;
  /** Where its preview ports are reached, with `{port}`: `https://{port}.sandbox.example.com`. */
  preview_url: string | null;
  /** The ports it publishes for live sandboxes, "5180-5199". */
  preview_ports: string | null;
  /** The folder workspaces go in (default /workspace). */
  workspace_root: string | null;
  has_key: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const WORKSPACE_STATUSES = ["new", "setting_up", "ready", "error"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

/** A coding workspace (`agent_workspaces`, spacify type `agent_workspace`): at most one per conversation. */
export interface AgentWorkspace {
  id: string;
  user_id: string;
  slug: string;
  identifier?: string;
  title: string | null;
  agent_id: string | null;
  conversation_id: string | null;
  sandbox_id: string | null;
  status: WorkspaceStatus;
  error: string | null;
  root_path: string | null;
  sandbox_port: number | null;
  sandbox_url: string | null;
  sandbox_app_path: string | null;
  sandbox_started_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentWorkspaceRepository {
  workspace_id: string;
  repository_id: string;
  user_id: string;
  branch: string | null;
  path: string | null;
  cloned_at: string | null;
  created_at: string;
}

export const RELEASE_STATUSES = ["uploading", "ready", "published", "withdrawn"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
export const RELEASE_REVIEWS = ["none", "pending", "approved", "rejected"] as const;
export type ReleaseReview = (typeof RELEASE_REVIEWS)[number];

/**
 * A build of a gondol app (`code_app_releases`): its files sit in the public storage bucket next to
 * an index (`index_url`, a gondol apps index with this one app). Published, it's live for its owner
 * (`private`), or for everyone once a platform admin approved it (`public`).
 */
export interface CodeAppRelease {
  id: string;
  user_id: string;
  app_id: string;
  name: string;
  version: string;
  manifest: Json;
  workspace_id: string | null;
  notes: string | null;
  status: ReleaseStatus;
  index_url: string | null;
  files: Json;
  size_bytes: number | null;
  visibility: "private" | "public";
  review_status: ReleaseReview;
  review_note: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A live app of the registry, as code_app_registry() lists it for the caller. */
export interface CodeRegistryApp {
  release_id: string;
  app_id: string;
  name: string;
  version: string;
  index_url: string;
  user_id: string;
  mine: boolean;
  visibility: "private" | "public";
}

// Mapped, so interfaces become the plain object types supabase-js's generics expect.
type Plain<T> = { [K in keyof T]: T[K] };
type Table<Row> = { Row: Plain<Row>; Insert: Partial<Plain<Row>>; Update: Partial<Plain<Row>>; Relationships: [] };

export type CodeDatabase = {
  public: {
    Tables: {
      code_repositories: Table<CodeRepository>;
      code_sandboxes: Table<CodeSandbox>;
      agent_workspaces: Table<AgentWorkspace>;
      agent_workspace_repositories: Table<AgentWorkspaceRepository>;
      code_app_releases: Table<CodeAppRelease>;
    };
    Views: { [_ in never]: never };
    Functions: {
      set_code_sandbox_key: { Args: { p_sandbox_id: string; p_api_key: string | null }; Returns: boolean };
      publish_code_app_release: { Args: { p_id: string; p_public?: boolean }; Returns: CodeAppRelease };
      withdraw_code_app_release: { Args: { p_id: string }; Returns: CodeAppRelease };
      review_code_app_release: { Args: { p_id: string; p_approve: boolean; p_note?: string | null }; Returns: CodeAppRelease };
      code_app_registry: { Args: Record<string, never>; Returns: CodeRegistryApp[] };
      is_platform_admin: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

const db = lazy(() => getSupabaseClient<CodeDatabase>());

export const codeRepositoriesKey = ["agents", "code", "repositories"] as const;
export const codeSandboxesKey = ["agents", "code", "sandboxes"] as const;
export const agentWorkspacesKey = ["agents", "code", "workspaces"] as const;
export const workspaceRepositoriesKey = (workspaceId: string | null) => ["agents", "code", "workspace-repositories", workspaceId] as const;
export const codeReleasesKey = ["agents", "code", "releases"] as const;
export const codeRegistryKey = ["agents", "code", "registry"] as const;

export function useCodeRepositories() {
  return useQuery({
    queryKey: codeRepositoriesKey,
    queryFn: async () => {
      const userId = await sessionUserId();
      const { data, error } = await db.from("code_repositories").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CodeRepository[];
    },
  });
}

export function useCodeSandboxes() {
  return useQuery({
    queryKey: codeSandboxesKey,
    queryFn: async () => {
      const userId = await sessionUserId();
      const { data, error } = await db.from("code_sandboxes").select("*").eq("user_id", userId).order("name");
      if (error) throw error;
      return (data ?? []) as CodeSandbox[];
    },
  });
}

export function useAgentWorkspaces() {
  return useQuery({
    queryKey: agentWorkspacesKey,
    queryFn: async () => {
      const userId = await sessionUserId();
      const { data, error } = await db.from("agent_workspaces").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AgentWorkspace[];
    },
    // A live sandbox or a clone changes it from the server.
    refetchInterval: 15_000,
  });
}

/** The workspace a conversation is connected to, if any. */
export function useConversationWorkspace(conversationId: string | null) {
  const workspaces = useAgentWorkspaces();
  return useMemo(() => (conversationId ? (workspaces.data ?? []).find((w) => w.conversation_id === conversationId) : undefined), [workspaces.data, conversationId]);
}

export function useWorkspaceRepositories(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceRepositoriesKey(workspaceId),
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await db.from("agent_workspace_repositories").select("*").eq("workspace_id", workspaceId!).order("created_at");
      if (error) throw error;
      return (data ?? []) as AgentWorkspaceRepository[];
    },
  });
}

export function useCodeReleases() {
  return useQuery({
    queryKey: codeReleasesKey,
    queryFn: async () => {
      // Mine, and (RLS) the public ones admins review.
      const { data, error } = await db.from("code_app_releases").select("*").neq("status", "uploading").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as CodeAppRelease[];
    },
  });
}

export function useIsPlatformAdmin() {
  return useQuery({
    queryKey: ["agents", "code", "is-platform-admin"],
    queryFn: async () => {
      const { data, error } = await db.rpc("is_platform_admin");
      return !error && data === true;
    },
    staleTime: 5 * 60_000,
  });
}

/** The apps of the registry the user has: their own published ones and the approved public ones. */
export function useCodeRegistry(enabled = true) {
  return useQuery({
    queryKey: codeRegistryKey,
    enabled,
    queryFn: async () => {
      const { data, error } = await db.rpc("code_app_registry");
      // A host without the registry has no apps in it.
      if (error) return [] as CodeRegistryApp[];
      return (data ?? []) as CodeRegistryApp[];
    },
    staleTime: 60_000,
  });
}

/** What the agent is told about a conversation's workspace (null when it has none). */
export async function conversationWorkspacePrompt(conversationId: string): Promise<PromptWorkspace | null> {
  const { data: workspace, error } = await db.from("agent_workspaces").select("*").eq("conversation_id", conversationId).maybeSingle();
  if (error || !workspace) return null;
  const ws = workspace as AgentWorkspace;
  const { data: links } = await db.from("agent_workspace_repositories").select("*").eq("workspace_id", ws.id);
  const ids = (links ?? []).map((l) => l.repository_id as string);
  const { data: repos } = ids.length ? await db.from("code_repositories").select("*").in("id", ids) : { data: [] };
  const root = ws.root_path ?? "(set up on first use)";
  return {
    id: ws.id,
    title: ws.title,
    root_path: root,
    status: ws.status,
    sandbox_url: ws.sandbox_url,
    repositories: ((links ?? []) as AgentWorkspaceRepository[]).flatMap((link) => {
      const repo = (repos ?? []).find((r) => r.id === link.repository_id) as CodeRepository | undefined;
      return repo ? [{ name: repo.name, full_name: repo.full_name, path: `${root}/${link.path ?? repo.name}`, branch: link.branch, cloned: !!link.cloned_at }] : [];
    }),
  };
}

// ── Writes ────────────────────────────────────────────────────────────────────────────────

export interface RepositoryInput {
  name: string;
  full_name: string | null;
  provider: CodeProvider;
  clone_url: string;
  html_url: string | null;
  default_branch: string | null;
  description: string | null;
  github_server_id: string | null;
}

export function useSaveRepository() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: RepositoryInput }) => {
      const query = id ? db.from("code_repositories").update(values).eq("id", id) : db.from("code_repositories").insert(values);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return data as CodeRepository;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: codeRepositoriesKey }),
  });
}

export interface SandboxInput {
  name: string;
  url: string;
  preview_url: string | null;
  preview_ports: string | null;
  workspace_root: string | null;
  enabled: boolean;
}

export function useSaveSandbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values, apiKey }: { id?: string; values: SandboxInput; apiKey?: string | null }) => {
      const query = id ? db.from("code_sandboxes").update(values).eq("id", id) : db.from("code_sandboxes").insert(values);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      // undefined: leave the key; "" or null: remove it.
      if (apiKey !== undefined) {
        const { error: keyError } = await db.rpc("set_code_sandbox_key", { p_sandbox_id: data.id as string, p_api_key: apiKey || null });
        if (keyError) throw keyError;
      }
      return data as CodeSandbox;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: codeSandboxesKey }),
  });
}

export interface WorkspaceInput {
  title: string | null;
  agent_id: string | null;
  conversation_id: string | null;
  sandbox_id: string | null;
}

/** Saves a workspace and the repositories connected to it (the whole list). */
export function useSaveWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values, repositoryIds }: { id?: string; values: WorkspaceInput; repositoryIds: string[] }) => {
      const query = id ? db.from("agent_workspaces").update(values).eq("id", id) : db.from("agent_workspaces").insert(values);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      const workspace = data as AgentWorkspace;
      const { data: links, error: linksError } = await db.from("agent_workspace_repositories").select("repository_id").eq("workspace_id", workspace.id);
      if (linksError) throw linksError;
      const had = new Set((links ?? []).map((l) => l.repository_id as string));
      const gone = [...had].filter((r) => !repositoryIds.includes(r));
      if (gone.length) {
        const { error: removeError } = await db.from("agent_workspace_repositories").delete().eq("workspace_id", workspace.id).in("repository_id", gone);
        if (removeError) throw removeError;
      }
      const added = repositoryIds.filter((r) => !had.has(r));
      if (added.length) {
        const { error: addError } = await db.from("agent_workspace_repositories").insert(added.map((repository_id) => ({ workspace_id: workspace.id, repository_id })));
        if (addError) throw addError;
        // New repositories are cloned on first use (or now, with "Set up").
        if (workspace.status === "ready") await db.from("agent_workspaces").update({ status: "setting_up" }).eq("id", workspace.id);
      }
      return workspace;
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: agentWorkspacesKey });
      if (variables.id) void queryClient.invalidateQueries({ queryKey: workspaceRepositoriesKey(variables.id) });
    },
  });
}

/** Calls one of the agents app's coding functions as the user (the same the agents' tools run). */
export function useCodeFunction<T = unknown>(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) => (await callAppFunction("agents", name, input)) as T,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: agentWorkspacesKey });
      void queryClient.invalidateQueries({ queryKey: codeReleasesKey });
      void queryClient.invalidateQueries({ queryKey: ["agents", "code", "workspace-repositories"] });
    },
  });
}

export function usePublishRelease() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, publicly }: { id: string; publicly: boolean }) => {
      const { data, error } = await db.rpc("publish_code_app_release", { p_id: id, p_public: publicly });
      if (error) throw error;
      return data as CodeAppRelease;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: codeReleasesKey });
      void queryClient.invalidateQueries({ queryKey: codeRegistryKey });
    },
  });
}

export function useWithdrawRelease() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("withdraw_code_app_release", { p_id: id });
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: codeReleasesKey });
      void queryClient.invalidateQueries({ queryKey: codeRegistryKey });
    },
  });
}

export function useReviewRelease() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, approve, note }: { id: string; approve: boolean; note?: string | null }) => {
      const { error } = await db.rpc("review_code_app_release", { p_id: id, p_approve: approve, p_note: note ?? null });
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: codeReleasesKey });
      void queryClient.invalidateQueries({ queryKey: codeRegistryKey });
    },
  });
}

export async function deleteCodeRow(table: "code_repositories" | "code_sandboxes" | "agent_workspaces", id: string): Promise<void> {
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) throw error;
}

// ── Live sandboxes on this device ───────────────────────────────────────────────────────────

const TRY_LIVE_KEY = "gondol.agents.tryLive";
const listeners = new Set<() => void>();

function readTryLive(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRY_LIVE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

let tryLiveCache: string[] | null = null;
const tryLiveSnapshot = () => (tryLiveCache ??= readTryLive());

/** Turns a workspace's live sandbox on or off in this browser (its app then loads as a dev app here only). */
export function setTryLive(workspaceId: string, on: boolean): void {
  const now = new Set(readTryLive());
  if (on) now.add(workspaceId);
  else now.delete(workspaceId);
  try {
    localStorage.setItem(TRY_LIVE_KEY, JSON.stringify([...now]));
  } catch {
    // storage blocked: only for this page
  }
  tryLiveCache = [...now];
  for (const listener of listeners) listener();
}

/** The workspaces whose live sandbox this browser loads. */
export function useTryLive(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tryLiveSnapshot,
    () => [],
  );
}

/**
 * The remote app sources the agents app adds to the host's (gondol's RemoteAppsRegistrar): every
 * live app of the registry the user has, and, on this device only, the live sandboxes they turned on
 * (as dev sources: loaded from source, reloading as the agent saves). A host renders them with its
 * own sources: `<RemoteAppsRegistrar sources={[...mine, ...useAgentAppSources()]} />`.
 */
export function useAgentAppSources(enabled = true): RemoteAppSource[] {
  const registry = useCodeRegistry(enabled).data;
  const workspaces = useQuery({
    queryKey: [...agentWorkspacesKey, "live"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("agent_workspaces").select("id, sandbox_url").not("sandbox_url", "is", null);
      if (error) return [] as Pick<AgentWorkspace, "id" | "sandbox_url">[];
      return (data ?? []) as Pick<AgentWorkspace, "id" | "sandbox_url">[];
    },
    staleTime: 30_000,
  }).data;
  const live = useTryLive();
  return useMemo(() => {
    const sources: RemoteAppSource[] = [];
    for (const app of registry ?? []) sources.push({ url: app.index_url });
    for (const ws of workspaces ?? []) {
      if (ws.sandbox_url && live.includes(ws.id)) sources.push({ url: ws.sandbox_url, dev: true });
    }
    return sources;
  }, [registry, workspaces, live]);
}

/** The GitHub remote MCP server (an ai_mcp_servers row with the user's token as its Authorization header). */
export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";
