import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callAppFunction } from "../../../api/client";
import { sessionUserId } from "../../../supabase/session";
import {
  agentWorkspacesKey,
  codeSandboxesKey,
  db,
  type AgentWorkspace,
} from "./code";

// ── Workspace mentions ──────────────────────────────────────────────────────────────────────

/**
 * The GitHub repositories a prompt mentions: `owner/name` (one slash, so URLs, `a/b/c`, `#123` and
 * "a b" are not; the name may carry dots but not a final sentence one), so "kickstart development
 * on drsounds/spacify and drsounds/gondol" gives both, without also picking up words from the
 * prompt itself.
 */
export function mentionedRepos(input: string): string[] {
  const found = new Set<string>();
  for (const match of input.matchAll(/(?:^|(?<=[\s("'`]))@?([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]*[A-Za-z0-9_-])(?=$|[\s)"'`,.;:!?])/g)) {
    const name = match[1].replace(/\.git$/i, "");
    if (/[/_-]{2,}/.test(name)) continue;
    if (/\.(com|org|net|io|se|dev|app)$/i.test(name.split("/")[1])) continue;
    found.add(name);
  }
  return [...found];
}

/** The workspace a prompt's `owner/name` mentions, if any. */
export async function findWorkspaceByMention(input: string, userId: string): Promise<AgentWorkspace | null> {
  const keys = mentionedRepos(input);
  if (!keys.length) return null;
  const likes = keys.map((k) => `full_name.ilike.${k.replace(/%/g, "")}`).join(",");
  const { data: repos } = await db.from("code_repositories").select("id").eq("user_id", userId).or(likes).limit(1);
  if (!repos?.length) return null;
  const { data: link } = await db.from("agent_workspace_repositories").select("workspace_id").eq("repository_id", repos[0].id).limit(1).maybeSingle();
  if (!link) return null;
  const { data: workspace } = await db.from("agent_workspaces").select("*").eq("id", link.workspace_id).maybeSingle();
  return (workspace as unknown as AgentWorkspace) ?? null;
}

// ── Creating and preparing ──────────────────────────────────────────────────────────────────

/** The first sandbox of the user's that's on (none: the server's own, where its operator allows it). */
async function defaultSandbox(userId: string): Promise<string | null> {
  const { data } = await db.from("code_sandboxes").select("id, enabled").eq("user_id", userId).order("created_at").limit(50);
  return ((data ?? []) as { id: string; enabled: boolean }[]).find((s) => s.enabled)?.id ?? null;
}

export interface EnsureWorkspaceResult {
  workspace: AgentWorkspace;
  /** True when this call created the workspace (else it existed, and repositories were only merged). */
  created: boolean;
  /** What the setup step answers: the repositories it cloned. */
  setup: { repositories: { repository: string; cloned: boolean }[] } | null;
}

/**
 * A conversation's workspace, made and prepared on the spot: the one connected to `conversationId`
 * when it exists (or the agent's main thread's, when a prompt mentions one of its repositories),
 * else a new one with the repositories the prompt mentions (owner/name, existing rows first), then
 * the `code_setup_workspace` function prepares it (its folder, git identity, clones of the
 * repositories). Sandboxes: the one `sandboxId` names, else the user's first enabled one; none: the
 * server's own, where its operator allows it — the workspace keeps the choice, so later edits stay.
 */
export async function ensureAgentWorkspace(input: {
  conversationId: string | null;
  agentId: string | null;
  /** Repositories the prompt mentions, as owner/name (rows that don't exist yet are skipped). */
  repositoryUrls?: string[];
  /** Rows already in the library, connected to the workspace as they are. */
  repositoryIds?: string[];
  sandboxId?: string | null;
  title?: string | null;
}): Promise<EnsureWorkspaceResult> {
  const userId = await sessionUserId();
  if (!userId) throw new Error("Sign in first");
  // One per conversation: reuse the conversation's (or the agent's main thread's) workspace.
  let workspace: AgentWorkspace | null = null;
  if (input.conversationId) {
    const { data } = await db.from("agent_workspaces").select("*").eq("conversation_id", input.conversationId).maybeSingle();
    workspace = (data as unknown as AgentWorkspace) ?? null;
  }
  const created = !workspace;
  if (!workspace) {
    const { data, error } = await db
      .from("agent_workspaces")
      .insert({
        user_id: userId,
        title: input.title ?? null,
        agent_id: input.agentId,
        conversation_id: input.conversationId,
        sandbox_id: (await defaultSandbox(userId)) ?? input.sandboxId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    workspace = data as unknown as AgentWorkspace;
  }
  // The repositories: their own rows, then rows for urls already in the library.
  const links = await db.from("agent_workspace_repositories").select("repository_id").eq("workspace_id", workspace.id);
  const had = new Set(((links.data ?? []) as { repository_id: string }[]).map((l) => l.repository_id));
  const wanted = new Set(input.repositoryIds ?? []);
  if (input.repositoryUrls?.length) {
    const { data: existing } = await db
      .from("code_repositories")
      .select("id, full_name")
      .eq("user_id", userId)
      .or(input.repositoryUrls.filter((url) => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(url)).map((url) => `full_name.ilike.${url.replace(/%/g, "")}`).join(","))
      .limit(50);
    for (const repo of (existing ?? []) as { id: string; full_name: string | null }[]) {
      if (repo.full_name && input.repositoryUrls.some((url) => url.toLowerCase() === repo.full_name!.toLowerCase())) wanted.add(repo.id);
    }
  }
  for (const id of [...wanted].filter((id) => !had.has(id))) {
    const { error } = await db.from("agent_workspace_repositories").insert({ workspace_id: workspace.id, repository_id: id, user_id: userId });
    if (error) throw error;
  }
  // The same call the workspace page's "Set up" makes: the folder, the git config, the clones.
  const setup = (await callAppFunction("agents", "code_setup_workspace", { workspace: workspace.id })) as {
    repositories: { repository: string; cloned: boolean }[];
  };
  await db.from("agent_workspaces").update({ last_used_at: new Date().toISOString() }).eq("id", workspace.id);
  return { workspace, created, setup };
}

/** Kicks development off: the workspace made and prepared when need be, invalidating what changed. */
export function useKickstartWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ensureAgentWorkspace,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: agentWorkspacesKey });
      void queryClient.invalidateQueries({ queryKey: ["agents", "code", "workspace-repositories"] });
      void queryClient.invalidateQueries({ queryKey: codeSandboxesKey });
    },
  });
}
