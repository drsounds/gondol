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

/**
 * A project name guessed from an idea: the first words that read like a name, lower-cased and
 * kebab-cased ("Build a habit tracker with streaks" → "habit-tracker"), skipping filler ("build a",
 * "make a", "an app that"), at most four words, so `code_create_repository` gets a name to create.
 */
export function guessProjectName(idea: string): string {
  const words = idea
    .toLowerCase()
    .split(/[^a-z0-9#+]+/)
    .filter(Boolean);
  const filler = new Set([
    "a", "an", "and", "app", "application", "as", "based", "build", "create", "develop", "for", "from", "i", "in", "kickstart",
    "like", "make", "me", "my", "new", "of", "on", "please", "project", "should", "start", "that", "the", "to", "us", "using", "want", "website", "with", "would",
  ]);
  const picked: string[] = [];
  for (const word of words) {
    if (picked.length >= 4) break;
    if (filler.has(word) || /^\d+$/.test(word)) continue;
    picked.push(word);
  }
  const name = picked.join("-").slice(0, 100).replace(/^-+|-+$/g, "");
  return name || "new-project";
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
  /** Repositories created on GitHub for the idea (a prompt that named none). */
  createdRepositories: { id: string; full_name: string; html_url: string | null; default_branch: string }[];
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
 *
 * With `createRepository` set, a prompt that names none gets a new private GitHub repository of
 * its own instead (the user's GitHub connection makes it): the name is `guessProjectName(idea)`
 * unless `createRepository.name` says otherwise, created with `code_create_repository` (which
 * connects and clones it), and the workspace is made first so it lands there.
 */
export async function ensureAgentWorkspace(input: {
  conversationId: string | null;
  agentId: string | null;
  /** Repositories the prompt mentions, as owner/name (rows that don't exist yet are skipped). */
  repositoryUrls?: string[];
  /** Rows already in the library, connected to the workspace as they are. */
  repositoryIds?: string[];
  /** When the prompt names no repository, create one on GitHub with this name (and description). */
  createRepository?: { name: string; description?: string | null; private?: boolean; owner?: string | null };
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
  let createdRepos: { id: string; full_name: string; html_url: string | null; default_branch: string }[] = [];
  const links = await db.from("agent_workspace_repositories").select("repository_id").eq("workspace_id", workspace.id);
  const had = new Set(((links.data ?? []) as { repository_id: string }[]).map((l) => l.repository_id));
  const wanted = new Set(input.repositoryIds ?? []);
  const unknownUrls: string[] = [];
  if (input.repositoryUrls?.length) {
    const { data: existing } = await db
      .from("code_repositories")
      .select("id, full_name")
      .eq("user_id", userId)
      .or(input.repositoryUrls.filter((url) => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(url)).map((url) => `full_name.ilike.${url.replace(/%/g, "")}`).join(","))
      .limit(50);
    for (const url of input.repositoryUrls) {
      const row = ((existing ?? []) as { id: string; full_name: string | null }[]).find((r) => r.full_name?.toLowerCase() === url.toLowerCase());
      if (row) wanted.add(row.id);
      else unknownUrls.push(url);
    }
  }
  for (const id of [...wanted].filter((id) => !had.has(id))) {
    const { error } = await db.from("agent_workspace_repositories").insert({ workspace_id: workspace.id, repository_id: id, user_id: userId });
    if (error) throw error;
  }
  if (unknownUrls.length && !input.createRepository) {
    // Mentioned but not in the library yet: code_add_repository saves them from GitHub and clones.
    for (const url of unknownUrls) {
      await callAppFunction("agents", "code_add_repository", { workspace: workspace.id, repository: url });
    }
  } else if (!wanted.size && !unknownUrls.length && !createdRepos.length && input.createRepository) {
    // No repository in the prompt: make the idea its own on GitHub, connected and cloned at once
    // (code_create_repository saves its row and links it to the workspace itself).
    const made = (await callAppFunction("agents", "code_create_repository", {
      workspace: workspace.id,
      name: input.createRepository.name,
      ...(input.createRepository.description ? { description: input.createRepository.description } : {}),
      ...(input.createRepository.private === false ? { private: false } : {}),
      ...(input.createRepository.owner ? { owner: input.createRepository.owner } : {}),
    })) as { repository: { id: string; full_name: string; html_url: string | null; default_branch: string } };
    createdRepos = made ? [made.repository] : [];
  }
  // The same call the workspace page's "Set up" makes: the folder, the git config, the clones.
  const setup = (await callAppFunction("agents", "code_setup_workspace", { workspace: workspace.id })) as {
    repositories: { repository: string; cloned: boolean }[];
  };
  await db.from("agent_workspaces").update({ last_used_at: new Date().toISOString() }).eq("id", workspace.id);
  return { workspace, created, createdRepositories: createdRepos, setup };
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
