// The agents app's coding tools (src/builtin/agents, manifest `functions` named code_*): what lets an
// AI agent work on code. The app router calls this function for them, as the user (their session, or
// the five-minute JWT the agents' runners sign for the owner), with the input as the JSON body and
// the function's name in `x-gondol-function`. `gondol-api --builtin agents --functions <dir>` writes it
// into the host. Deploy with `verify_jwt = false` (it checks the caller through RLS itself).
//
// No model is called here and nothing is routed to one: the agent keeps running on its own model in
// the agents app's runners, and these are tools like any app's. The work happens in a **sandbox**: an
// OpenHands agent server (github.com/OpenHands/software-agent-sdk, the `ghcr.io/openhands/agent-server`
// docker image) used for its bash and file endpoints only, never its own LLM conversations:
//
//   POST /api/bash/start_bash_command    { command, cwd, timeout }  → { id }
//   GET  /api/bash/bash_events/search    kind__eq=BashOutput, command_id__eq, order__gt → { items, next_page_id }
//   GET  /api/file/download?path=        the file's bytes
//   POST /api/file/upload?path=          multipart `file`
//   (X-Session-API-Key: the server's session key)
//
// Each workspace (agent_workspaces, one per agent conversation at most) is a folder in the sandbox,
// `<workspace_root>/gondol/<workspace id>`, holding its repositories (agent_workspace_repositories ›
// code_repositories) and `.gondol/` (a git config whose credential helper reads the user's GitHub token,
// from the GitHub MCP server they connected in the ai app: ai_mcp_servers + ai_mcp_server_headers).
// Every command runs with GIT_CONFIG_GLOBAL pointing there, so git and npm reach private repositories
// as the user without the token in any command line.
//
// Gondol apps: `code_scaffold_app` writes a remote app package (gondol's docs/guide/remote-apps.md),
// `code_start_sandbox` runs `gondol-apps dev` in the sandbox on a preview port the host can reach (the
// live sandbox: the user's own app loads it, on their device only, as a dev source), and
// `code_prepare_release` builds it and copies `dist/` with its manifest and an index (gondol-apps.json)
// into the public storage bucket as a release (code_app_releases, status `ready`). Publishing it into
// the apps registry is the user's own step (publish_code_app_release(), the Publish button).
//
// Sandboxes: a user's own (code_sandboxes, key in code_sandbox_keys, read here with the service role),
// or the server's (OPENHANDS_AGENT_SERVER_URL + OPENHANDS_SESSION_API_KEY) for whom
// OPENHANDS_SHARED_SANDBOX allows it: `everyone`, `admins` (is_platform_admin()) or `off` (the
// default). Workspaces in one sandbox share its container: give the server's only to people who
// may see each other's work.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Optional:
// OPENHANDS_AGENT_SERVER_URL, OPENHANDS_SESSION_API_KEY, OPENHANDS_SHARED_SANDBOX,
// OPENHANDS_WORKSPACE_ROOT (default /workspace), OPENHANDS_PREVIEW_URL (e.g. https://{port}.sandbox.example.com),
// OPENHANDS_PREVIEW_PORTS (default 5180-5199), OPENHANDS_ALLOWED_HOSTS / OPENHANDS_ALLOW_PRIVATE
// (users' sandboxes on private addresses), CODE_WAIT_MS (how long a command is waited for, default
// 40000), GONDOL_PACKAGE_SPEC (what new apps build against, default git+https://github.com/drsounds/gondol.git),
// CODE_APPS_BUCKET (default gondol-apps), CODE_COMMIT_EMAIL (default {username}@agents.noreply.invalid).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  appIdFrom,
  gondolAppFiles,
  githubFullName,
  portRange,
  previewAddress,
  publishedContentType,
  releaseIndex,
  repositoryFolder,
  shellQuote,
  tail,
  workspacePath,
} from "../_shared/codeWorkspace.ts";
import type { CommandResult, SandboxBackend } from "../_shared/codeSandbox.ts";

const env = (name: string) => Deno.env.get(name)?.trim() || undefined;
const SUPABASE_URL = env("SUPABASE_URL")!;
const ANON_KEY = env("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const WAIT_MS = Math.min(110_000, Math.max(5_000, Number(env("CODE_WAIT_MS")) || 40_000));
const OUTPUT_MAX = 12_000;
const FILE_MAX = 400_000;
const BUCKET = env("CODE_APPS_BUCKET") ?? "gondol-apps";
const GONDOL_SPEC = env("GONDOL_PACKAGE_SPEC") ?? "git+https://github.com/drsounds/gondol.git";
const RELEASE_MAX_BYTES = 25 * 1024 * 1024;

const admin = SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(status: number, message: string): never {
  throw new Problem(status, message);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

// ── Addresses the server may call (users' own sandboxes) ────────────────────────────────────

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function isPrivateIPv6(address: string): boolean {
  const v = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return /^(?:fc|fd|fe[89ab]|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
}

async function assertAllowed(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") fail(422, "The sandbox's address must be an HTTP(S) URL");
  if (url.username || url.password) fail(422, "The sandbox's address can't hold a user name or password");
  if (env("OPENHANDS_ALLOW_PRIVATE") === "true") return;
  const allowed = (env("OPENHANDS_ALLOWED_HOSTS") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.includes(url.host.toLowerCase()) || allowed.includes(url.hostname.toLowerCase())) return;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const refuse = () => fail(422, `The server doesn't call internal addresses such as ${url.host}; ask its operator to list it in OPENHANDS_ALLOWED_HOSTS`);
  if (url.protocol !== "https:") refuse();
  if (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp)$/.test(host)) refuse();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIPv4(host) ? refuse() : undefined;
  if (host.startsWith("[") || host.includes(":")) return isPrivateIPv6(host) ? refuse() : undefined;
  const [v4, v6] = await Promise.all([Deno.resolveDns(host, "A").catch(() => [] as string[]), Deno.resolveDns(host, "AAAA").catch(() => [] as string[])]);
  if (v4.length + v6.length === 0) fail(422, `${host} doesn't resolve`);
  if (v4.some(isPrivateIPv4) || v6.some(isPrivateIPv6)) refuse();
}

// ── The sandbox (an OpenHands agent server) ─────────────────────────────────────────────────

class OpenHandsSandbox implements SandboxBackend {
  constructor(
    readonly url: string,
    readonly key: string | null,
    readonly previewTemplate: string | null,
    readonly ports: number[],
    readonly id: string | null,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.key ? { "X-Session-API-Key": this.key } : {}), ...extra };
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.url}${path}`, { ...init, headers: this.headers(init.headers as Record<string, string>), redirect: "error", signal: AbortSignal.timeout(WAIT_MS + 15_000) });
    } catch (error) {
      fail(502, `The sandbox (${new URL(this.url).host}) can't be reached: ${error instanceof Error ? error.message : error}`);
    }
    if (response!.status === 401 || response!.status === 403) fail(502, "The sandbox refused its session key: check the key saved for it");
    return response!;
  }

  /** Starts a command and waits for it up to `waitMs`; a command still running comes back with `running`. */
  async run(command: string, options: { cwd?: string; timeoutSeconds?: number; waitMs?: number } = {}): Promise<CommandResult> {
    const timeout = Math.min(3600, Math.max(5, Math.round(options.timeoutSeconds ?? 600)));
    const started = await this.call("/api/bash/start_bash_command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeout, ...(options.cwd ? { cwd: options.cwd } : {}) }),
    });
    if (!started.ok) fail(502, `The sandbox didn't start the command (${started.status}): ${tail(await started.text(), 500)}`);
    const id = str(((await started.json()) as { id?: unknown }).id);
    if (!id) fail(502, "The sandbox returned no command id");
    return await this.output(id!, options.waitMs ?? WAIT_MS);
  }

  /** The output of a command so far, waiting up to `waitMs` for it to finish. */
  async output(commandId: string, waitMs = 0): Promise<CommandResult> {
    const deadline = Date.now() + waitMs;
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exit: number | null = null;
    let last = -1;
    for (;;) {
      let pageId: string | null = null;
      do {
        const params = new URLSearchParams({ kind__eq: "BashOutput", command_id__eq: commandId, sort_order: "TIMESTAMP", limit: "100" });
        if (last >= 0) params.set("order__gt", String(last));
        if (pageId) params.set("page_id", pageId);
        const response = await this.call(`/api/bash/bash_events/search?${params}`);
        if (response.status === 404) fail(404, `The sandbox knows no command ${commandId}`);
        if (!response.ok) fail(502, `The sandbox didn't give the command's output (${response.status})`);
        const page = (await response.json()) as { items?: { order?: number; stdout?: string | null; stderr?: string | null; exit_code?: number | null }[]; next_page_id?: string | null };
        for (const item of page.items ?? []) {
          if (typeof item.order === "number" && item.order > last) last = item.order;
          if (item.stdout) stdout.push(item.stdout);
          if (item.stderr) stderr.push(item.stderr);
          if (typeof item.exit_code === "number") exit = item.exit_code;
        }
        pageId = page.next_page_id ?? null;
      } while (pageId);
      if (exit !== null || Date.now() >= deadline) break;
      await new Promise((done) => setTimeout(done, 400));
    }
    return { command_id: commandId, exit_code: exit, running: exit === null, stdout: tail(stdout.join(""), OUTPUT_MAX), stderr: tail(stderr.join(""), OUTPUT_MAX / 2) };
  }

  /** Runs a short command and fails unless it exits 0; its stdout. */
  async must(command: string, cwd?: string, waitMs = WAIT_MS): Promise<string> {
    const result = await this.run(command, { cwd, waitMs, timeoutSeconds: Math.ceil(waitMs / 1000) + 5 });
    if (result.running) fail(504, `The sandbox is still busy with: ${command.slice(0, 200)}`);
    if (result.exit_code !== 0) fail(422, `${command.slice(0, 200)} failed (${result.exit_code}): ${tail(result.stderr || result.stdout, 2000)}`);
    return result.stdout;
  }

  async download(path: string): Promise<Uint8Array | null> {
    const response = await this.call(`/api/file/download?${new URLSearchParams({ path })}`);
    if (response.status === 404) return null;
    if (!response.ok) fail(502, `The sandbox didn't give ${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async upload(path: string, content: Uint8Array | string): Promise<void> {
    const body = new FormData();
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    body.append("file", new Blob([bytes as Uint8Array<ArrayBuffer>]), path.split("/").pop() ?? "file");
    const response = await this.call(`/api/file/upload?${new URLSearchParams({ path })}`, { method: "POST", body });
    if (!response.ok) fail(502, `The sandbox didn't save ${path} (${response.status}): ${tail(await response.text(), 500)}`);
  }
}

// ── Who is calling, and their rows ──────────────────────────────────────────────────────────

interface Workspace {
  id: string;
  user_id: string;
  title: string | null;
  agent_id: string | null;
  conversation_id: string | null;
  sandbox_id: string | null;
  status: string;
  root_path: string | null;
  sandbox_port: number | null;
  sandbox_url: string | null;
  sandbox_app_path: string | null;
}

interface Repository {
  id: string;
  user_id: string;
  name: string;
  full_name: string | null;
  clone_url: string;
  default_branch: string | null;
  github_server_id: string | null;
}

interface WorkspaceRepository {
  repository_id: string;
  branch: string | null;
  path: string | null;
  cloned_at: string | null;
  code_repositories: Repository;
}

function userClient(request: Request): SupabaseClient {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) fail(401, "Sign in first");
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: authorization!,
        apikey: ANON_KEY,
        // The open workspace (the host's tenant), passed on like the app router does.
        ...Object.fromEntries([...request.headers].filter(([name]) => /^x-(spacify|gondol)-workspace$/i.test(name))),
      },
    },
  });
}

async function loadWorkspace(db: SupabaseClient, key: unknown): Promise<Workspace> {
  const id = str(key);
  if (!id) fail(422, "Name the workspace (its id)");
  const query = db.from("agent_workspaces").select("id, user_id, title, agent_id, conversation_id, sandbox_id, status, root_path, sandbox_port, sandbox_url, sandbox_app_path");
  const { data, error } = await (UUID.test(id!) ? query.eq("id", id!) : query.or(`identifier.eq.${id},slug.eq.${id}`)).maybeSingle();
  if (error) fail(500, error.message);
  if (!data) fail(404, `There is no workspace ${id}`);
  return data as Workspace;
}

async function workspaceRepositories(db: SupabaseClient, workspace: Workspace): Promise<WorkspaceRepository[]> {
  const { data, error } = await db
    .from("agent_workspace_repositories")
    .select("repository_id, branch, path, cloned_at, code_repositories!inner(id, user_id, name, full_name, clone_url, default_branch, github_server_id)")
    .eq("workspace_id", workspace.id)
    .order("created_at");
  if (error) fail(500, error.message);
  return (data ?? []) as unknown as WorkspaceRepository[];
}

/** The sandbox a workspace works in: its own, else the server's when OPENHANDS_SHARED_SANDBOX allows it. */
async function sandboxFor(db: SupabaseClient, workspace: Workspace): Promise<SandboxBackend> {
  if (workspace.sandbox_id) {
    const { data: row } = await db.from("code_sandboxes").select("id, url, preview_url, preview_ports, enabled").eq("id", workspace.sandbox_id).maybeSingle();
    if (!row) fail(404, "The workspace's sandbox is gone");
    if (row!.enabled === false) fail(409, "The workspace's sandbox is turned off");
    const url = new URL(row!.url as string);
    await assertAllowed(url);
    const { data: key } = await admin!.from("code_sandbox_keys").select("api_key").eq("sandbox_id", row!.id).eq("user_id", workspace.user_id).maybeSingle();
    return new OpenHandsSandbox(url.toString().replace(/\/+$/, ""), str(key?.api_key), str(row!.preview_url), portRange(str(row!.preview_ports)), row!.id as string);
  }
  const shared = env("OPENHANDS_AGENT_SERVER_URL");
  const policy = env("OPENHANDS_SHARED_SANDBOX") ?? "off";
  if (!shared || policy === "off") fail(409, "This workspace has no sandbox: add an OpenHands agent server under Code › Sandboxes and pick it for the workspace");
  if (policy === "admins") {
    const { data: isAdmin } = await db.rpc("is_platform_admin");
    if (isAdmin !== true) fail(403, "The server's sandbox is for admins: add a sandbox of your own under Code › Sandboxes");
  }
  return new OpenHandsSandbox(shared!.replace(/\/+$/, ""), env("OPENHANDS_SESSION_API_KEY") ?? null, env("OPENHANDS_PREVIEW_URL") ?? null, portRange(env("OPENHANDS_PREVIEW_PORTS")), null);
}

function rootOf(workspace: Workspace, base: string | null): string {
  return workspace.root_path ?? `${(base ?? env("OPENHANDS_WORKSPACE_ROOT") ?? "/workspace").replace(/\/+$/, "")}/gondol/${workspace.id}`;
}

/** The user's GitHub token: from the GitHub MCP server they connected (its Authorization header). */
async function githubToken(userId: string, serverId: string | null): Promise<{ token: string; serverId: string } | null> {
  let query = admin!.from("ai_mcp_servers").select("id, url").eq("user_id", userId).eq("enabled", true);
  if (serverId) query = query.eq("id", serverId);
  const { data: servers } = await query.order("position");
  const github = (servers ?? []).find((s) => serverId || /github/i.test(new URL(s.url as string).hostname));
  if (!github) return null;
  const { data: row } = await admin!.from("ai_mcp_server_headers").select("headers").eq("server_id", github.id).eq("user_id", userId).maybeSingle();
  const headers = (row?.headers ?? {}) as Record<string, unknown>;
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === "authorization")?.[1];
  const token = typeof value === "string" ? value.replace(/^(?:bearer|token)\s+/i, "").trim() : "";
  return token ? { token, serverId: github.id as string } : null;
}

const ENV_PREFIX = (root: string) => `export GIT_CONFIG_GLOBAL=${shellQuote(`${root}/.gondol/gitconfig`)} GIT_TERMINAL_PROMPT=0 CI=1 npm_config_update_notifier=false; `;

/** Writes the workspace's git config (and the GitHub credentials, when the user has a connection). */
async function writeGitConfig(sandbox: Sandbox, db: SupabaseClient, workspace: Workspace, root: string, repos: WorkspaceRepository[]) {
  await sandbox.must(`mkdir -p ${shellQuote(`${root}/.gondol`)} && chmod 700 ${shellQuote(`${root}/.gondol`)}`);
  const github = await githubToken(workspace.user_id, repos.find((r) => r.code_repositories.github_server_id)?.code_repositories.github_server_id ?? null);
  let name = "Gondol agent";
  let username = "agent";
  if (workspace.agent_id) {
    const { data: agent } = await db.from("agents").select("name, username").eq("id", workspace.agent_id).maybeSingle();
    if (agent) {
      name = agent.name as string;
      username = agent.username as string;
    }
  }
  const email = (env("CODE_COMMIT_EMAIL") ?? "{username}@agents.noreply.invalid").replaceAll("{username}", username);
  const credentials = `${root}/.gondol/git-credentials`;
  const config = [
    "[user]",
    `\tname = ${name.replace(/[\n"\\]/g, " ")}`,
    `\temail = ${email.replace(/[\n"\\]/g, "")}`,
    "[init]",
    "\tdefaultBranch = main",
    "[safe]",
    "\tdirectory = *",
    ...(github ? ["[credential]", `\thelper = store --file=${credentials}`] : []),
    "",
  ].join("\n");
  await sandbox.upload(`${root}/.gondol/gitconfig`, config);
  if (github) {
    await sandbox.upload(credentials, `https://x-access-token:${github.token}@github.com\n`);
    await sandbox.must(`chmod 600 ${shellQuote(credentials)}`);
  }
  return github;
}

/** Makes the workspace's folder and clones the repositories it doesn't have yet. */
async function setup(db: SupabaseClient, workspace: Workspace) {
  const sandbox = await sandboxFor(db, workspace);
  const { data: sandboxRow } = workspace.sandbox_id ? await db.from("code_sandboxes").select("workspace_root").eq("id", workspace.sandbox_id).maybeSingle() : { data: null };
  const root = rootOf(workspace, str(sandboxRow?.workspace_root));
  const repos = await workspaceRepositories(db, workspace);
  const github = await writeGitConfig(sandbox, db, workspace, root, repos);
  const done: { repository: string; path: string; cloned: boolean; output?: string }[] = [];
  for (const repo of repos) {
    const path = workspacePath(root, repo.path ?? repositoryFolder(repo.code_repositories.name));
    const present = (await sandbox.run(`test -d ${shellQuote(`${path}/.git`)} && echo yes || echo no`, { waitMs: 15_000 })).stdout.trim() === "yes";
    let output: string | undefined;
    if (!present) {
      const branch = repo.branch ?? repo.code_repositories.default_branch;
      const clone = await sandbox.run(
        `${ENV_PREFIX(root)}git clone --depth 100 ${shellQuote(repo.code_repositories.clone_url)} ${shellQuote(path)}${branch ? ` && cd ${shellQuote(path)} && (git fetch --depth 100 origin ${shellQuote(`${branch}:refs/remotes/origin/${branch}`)} 2>/dev/null && git checkout -B ${shellQuote(branch)} ${shellQuote(`origin/${branch}`)} || git checkout -B ${shellQuote(branch)})` : ""}`,
        { timeoutSeconds: 900 },
      );
      output = tail(`${clone.stdout}${clone.stderr}`, 2000);
      if (clone.running) output = `Still cloning (command ${clone.command_id}); read it with code_command_output.\n${output}`;
    }
    const cloned = present || (await sandbox.run(`test -d ${shellQuote(`${path}/.git`)} && echo yes || echo no`, { waitMs: 15_000 })).stdout.trim() === "yes";
    if (cloned && !repo.cloned_at) {
      await db.from("agent_workspace_repositories").update({ cloned_at: new Date().toISOString(), path: path.slice(root.length + 1) }).eq("workspace_id", workspace.id).eq("repository_id", repo.repository_id);
    }
    done.push({ repository: repo.code_repositories.full_name ?? repo.code_repositories.name, path, cloned, ...(output ? { output } : {}) });
  }
  const allCloned = done.every((r) => r.cloned);
  await db
    .from("agent_workspaces")
    .update({ root_path: root, status: allCloned ? "ready" : "setting_up", error: null, last_used_at: new Date().toISOString() })
    .eq("id", workspace.id);
  return { workspace: workspace.id, root, github: github ? "connected" : "not connected (public repositories only; connect the GitHub MCP server in the AI settings)", repositories: done };
}

/** The sandbox and root of a workspace that's set up (setting it up first when it isn't). */
async function ready(db: SupabaseClient, workspace: Workspace): Promise<{ sandbox: Sandbox; root: string }> {
  if (workspace.status !== "ready" || !workspace.root_path) {
    const result = await setup(db, workspace);
    workspace.root_path = result.root;
  } else {
    void db.from("agent_workspaces").update({ last_used_at: new Date().toISOString() }).eq("id", workspace.id);
  }
  return { sandbox: await sandboxFor(db, workspace), root: workspace.root_path! };
}

const decoder = new TextDecoder();

// ── The tools ───────────────────────────────────────────────────────────────────────────────

type Input = Record<string, unknown>;

async function runCommand(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const command = str(input.command) ?? fail(422, "Give the command to run");
  const { sandbox, root } = await ready(db, workspace);
  const cwd = workspacePath(root, str(input.cwd));
  const waitMs = Math.min(WAIT_MS, Math.max(1, Number(input.wait_seconds) || WAIT_MS / 1000) * 1000);
  const result = await sandbox.run(`${ENV_PREFIX(root)}cd ${shellQuote(cwd)} && ${command}`, { cwd, waitMs, timeoutSeconds: Number(input.timeout_seconds) || 900 });
  return { cwd, ...result, ...(result.running ? { note: "Still running: read the rest with code_command_output and this command_id." } : {}) };
}

async function commandOutput(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const id = str(input.command_id) ?? fail(422, "Give the command_id");
  const sandbox = await sandboxFor(db, workspace);
  return await sandbox.output(id!, Math.min(WAIT_MS, Math.max(0, Number(input.wait_seconds ?? 20)) * 1000));
}

async function readFile(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const { sandbox, root } = await ready(db, workspace);
  const path = workspacePath(root, str(input.path) ?? fail(422, "Give the file's path"));
  const bytes = await sandbox.download(path);
  if (!bytes) fail(404, `There is no file ${path}`);
  if (bytes!.length > FILE_MAX * 4) fail(413, `${path} is ${bytes!.length} bytes: read parts of it with code_run_command (sed -n, head, grep)`);
  const lines = decoder.decode(bytes!).split("\n");
  const from = Math.max(1, Math.floor(Number(input.from_line) || 1));
  const to = Math.min(lines.length, Math.floor(Number(input.to_line) || lines.length));
  let text = lines
    .slice(from - 1, to)
    .map((line, i) => `${String(from + i).padStart(5)}\t${line}`)
    .join("\n");
  const cut = text.length > FILE_MAX;
  if (cut) text = text.slice(0, FILE_MAX);
  return { path, lines: lines.length, from_line: from, to_line: to, ...(cut ? { note: "Cut short: ask for a line range." } : {}), content: text };
}

async function writeFile(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const { sandbox, root } = await ready(db, workspace);
  const path = workspacePath(root, str(input.path) ?? fail(422, "Give the file's path"));
  if (path === root) fail(422, "Name a file, not the workspace");
  const content = typeof input.content === "string" ? input.content : fail(422, "Give the file's content");
  await sandbox.must(`mkdir -p ${shellQuote(path.slice(0, path.lastIndexOf("/")))}`);
  await sandbox.upload(path, content as string);
  return { path, bytes: new TextEncoder().encode(content as string).length };
}

async function editFile(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const { sandbox, root } = await ready(db, workspace);
  const path = workspacePath(root, str(input.path) ?? fail(422, "Give the file's path"));
  const oldText = typeof input.old_text === "string" && input.old_text ? input.old_text : fail(422, "Give old_text, copied exactly from the file");
  const newText = typeof input.new_text === "string" ? input.new_text : fail(422, "Give new_text");
  const bytes = await sandbox.download(path);
  if (!bytes) fail(404, `There is no file ${path}`);
  const text = decoder.decode(bytes!);
  const count = text.split(oldText as string).length - 1;
  if (count === 0) fail(422, `old_text isn't in ${path}: read the file and copy the text exactly, whitespace included`);
  if (count > 1 && input.replace_all !== true) fail(422, `old_text is in ${path} ${count} times: give more of the surrounding text, or replace_all`);
  const next = input.replace_all === true ? text.split(oldText as string).join(newText as string) : text.replace(oldText as string, () => newText as string);
  await sandbox.upload(path, next);
  return { path, replaced: input.replace_all === true ? count : 1 };
}

async function listFiles(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const { sandbox, root } = await ready(db, workspace);
  const path = workspacePath(root, str(input.path));
  const depth = Math.min(8, Math.max(1, Math.floor(Number(input.depth) || 3)));
  const result = await sandbox.run(
    `cd ${shellQuote(path)} && find . -maxdepth ${depth} \\( -name node_modules -o -name .git -o -name dist -o -name .gondol \\) -prune -o -print | sed 's|^\\./||' | grep -v '^\\.$' | sort | head -1000`,
    { waitMs: 20_000 },
  );
  if (result.exit_code !== 0) fail(422, tail(result.stderr || result.stdout, 1000));
  return { path, files: result.stdout.split("\n").filter(Boolean) };
}

async function repoPath(db: SupabaseClient, workspace: Workspace, root: string, key: unknown): Promise<string> {
  const repos = await workspaceRepositories(db, workspace);
  const name = str(key);
  const repo = name
    ? repos.find((r) => [r.code_repositories.full_name, r.code_repositories.name, r.repository_id, r.path].some((v) => v && v.toLowerCase() === name.toLowerCase()))
    : repos.length === 1
      ? repos[0]
      : undefined;
  if (repo) return workspacePath(root, repo.path ?? repositoryFolder(repo.code_repositories.name));
  if (name) return workspacePath(root, name);
  fail(422, repos.length ? `Name the repository: ${repos.map((r) => r.code_repositories.full_name ?? r.code_repositories.name).join(", ")}` : "The workspace has no repository");
  return root;
}

async function gitStatus(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const { sandbox, root } = await ready(db, workspace);
  const path = await repoPath(db, workspace, root, input.repository);
  const result = await sandbox.run(`${ENV_PREFIX(root)}cd ${shellQuote(path)} && git status --short --branch && echo '---' && git diff --stat && echo '---' && git diff`, { waitMs: 30_000 });
  return { path, exit_code: result.exit_code, output: tail(result.stdout + result.stderr, OUTPUT_MAX * 2) };
}

async function commitAndPush(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const message = str(input.message) ?? fail(422, "Give a commit message");
  const { sandbox, root } = await ready(db, workspace);
  const path = await repoPath(db, workspace, root, input.repository);
  const branch = str(input.branch);
  if (branch && !/^[A-Za-z0-9._/-]{1,200}$/.test(branch)) fail(422, "That isn't a branch name");
  const steps = [
    `${ENV_PREFIX(root)}cd ${shellQuote(path)}`,
    ...(branch ? [`(git switch ${shellQuote(branch)} 2>/dev/null || git switch -c ${shellQuote(branch)})`] : []),
    "git add -A",
    `(git diff --cached --quiet && echo 'Nothing new to commit' || git commit -q -m ${shellQuote(message!)})`,
    `git push -u origin HEAD 2>&1`,
    "git log --oneline -1",
  ];
  const result = await sandbox.run(steps.join(" && "), { timeoutSeconds: 300 });
  if (!result.running && result.exit_code !== 0) fail(422, `Committing or pushing failed (${result.exit_code}): ${tail(result.stderr || result.stdout, 3000)}`);
  return { path, ...result };
}

async function createRepository(db: SupabaseClient, input: Input) {
  const name = str(input.name) ?? fail(422, "Name the repository");
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name!)) fail(422, "A repository name has letters, digits, '.', '-' and '_' only");
  const workspace = input.workspace ? await loadWorkspace(db, input.workspace) : null;
  // Whose it is: the caller's own rows tell (RLS), never a claim in the input.
  const { data: me } = await db.rpc("agent_code_caller");
  const userId = str(me) ?? fail(401, "Sign in first");
  const github = await githubToken(userId!, str(input.github_server));
  if (!github) fail(409, "Connect GitHub first: add the GitHub MCP server (https://api.githubcopilot.com/mcp/) with a token that may create repositories, under Code › Repositories");
  const owner = str(input.owner);
  const response = await fetch(`https://api.github.com/${owner ? `orgs/${encodeURIComponent(owner)}/repos` : "user/repos"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${github!.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "gondol-agents" },
    body: JSON.stringify({ name, description: str(input.description) ?? undefined, private: input.private !== false, auto_init: true }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) fail(response.status === 422 ? 422 : 502, `GitHub didn't create it (${response.status}): ${str(body.message) ?? ""} ${JSON.stringify(body.errors ?? "")}`);
  const { data: repo, error } = await db
    .from("code_repositories")
    .insert({
      name: body.name,
      full_name: body.full_name,
      provider: "github",
      clone_url: body.clone_url,
      html_url: body.html_url,
      default_branch: body.default_branch ?? "main",
      description: str(input.description),
      private: body.private === true,
      github_server_id: github!.serverId,
    })
    .select("id, full_name, html_url, default_branch")
    .single();
  if (error) fail(500, error.message);
  let setupResult: unknown = null;
  if (workspace) {
    const { error: linkError } = await db.from("agent_workspace_repositories").insert({ workspace_id: workspace.id, repository_id: repo.id, path: repositoryFolder(name!) });
    if (linkError) fail(500, linkError.message);
    setupResult = await setup(db, { ...workspace, status: "setting_up" });
  }
  return { repository: repo, ...(setupResult ? { workspace: setupResult } : {}) };
}

async function scaffoldApp(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const id = appIdFrom(str(input.id) ?? str(input.name) ?? "");
  if (!id) fail(422, "Give the app an id (lower-case letters, digits and -)");
  const { sandbox, root } = await ready(db, workspace);
  const dir = workspacePath(root, str(input.path) ?? `apps/${id}`);
  const exists = (await sandbox.run(`test -e ${shellQuote(`${dir}/package.json`)} && echo yes || echo no`, { waitMs: 15_000 })).stdout.trim() === "yes";
  if (exists && input.overwrite !== true) fail(409, `${dir} already has a package.json: pick another path, or overwrite`);
  const files = gondolAppFiles({ id, name: str(input.name) ?? id, description: str(input.description) ?? undefined, gondol: GONDOL_SPEC });
  await sandbox.must(`mkdir -p ${[...new Set(Object.keys(files).map((f) => `${dir}/${f}`.replace(/\/[^/]+$/, "")))].map(shellQuote).join(" ")}`);
  for (const [file, content] of Object.entries(files)) await sandbox.upload(`${dir}/${file}`, content);
  return {
    path: dir,
    app: id,
    files: Object.keys(files),
    next: "Install and try it with code_start_sandbox (path), edit src/, and build a release with code_prepare_release when it works.",
  };
}

/** A free preview port of the sandbox (one no other running workspace of the same sandbox holds). */
async function freePort(sandbox: Sandbox, workspace: Workspace): Promise<number> {
  if (workspace.sandbox_port && sandbox.ports.includes(workspace.sandbox_port)) return workspace.sandbox_port;
  let query = admin!.from("agent_workspaces").select("sandbox_port").not("sandbox_port", "is", null).neq("id", workspace.id);
  query = sandbox.id ? query.eq("sandbox_id", sandbox.id) : query.is("sandbox_id", null);
  const { data } = await query;
  const taken = new Set((data ?? []).map((r) => r.sandbox_port as number));
  const port = sandbox.ports.find((p) => !taken.has(p));
  if (!port) fail(409, "Every preview port of the sandbox is in use: stop another workspace's sandbox");
  return port!;
}

async function startSandbox(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const { sandbox, root } = await ready(db, workspace);
  const dir = workspacePath(root, str(input.path) ?? workspace.sandbox_app_path ?? fail(422, "Give the app package's path"));
  const port = await freePort(sandbox, workspace);
  const url = previewAddress(sandbox.previewTemplate, port);
  if (!url) fail(409, "The sandbox has no preview address: set one (with {port}) on the sandbox, or OPENHANDS_PREVIEW_URL on the server");
  const log = `${root}/.gondol/sandbox-${port}.log`;
  const pattern = shellQuote(`gondol-apps dev .* --port ${port}`);
  const command = [
    `${ENV_PREFIX(root)}cd ${shellQuote(dir)}`,
    "test -f package.json",
    "(test -d node_modules || npm install --no-audit --no-fund --loglevel=error)",
    `(pkill -f ${pattern} || true)`,
    `(nohup npx gondol-apps dev . --host 0.0.0.0 --port ${port} --public-url ${shellQuote(url!)} > ${shellQuote(log)} 2>&1 &)`,
    "sleep 5",
    `tail -n 30 ${shellQuote(log)}`,
  ].join(" && ");
  await db
    .from("agent_workspaces")
    .update({ sandbox_port: port, sandbox_url: url, sandbox_app_path: dir.slice(root.length + 1) || ".", sandbox_started_at: new Date().toISOString() })
    .eq("id", workspace.id);
  const result = await sandbox.run(command, { timeoutSeconds: 900 });
  if (!result.running && result.exit_code !== 0) {
    await db.from("agent_workspaces").update({ sandbox_port: null, sandbox_url: null, sandbox_started_at: null }).eq("id", workspace.id);
    fail(422, `The sandbox didn't start (${result.exit_code}): ${tail(result.stderr || result.stdout, 3000)}`);
  }
  return {
    url,
    port,
    path: dir,
    log,
    ...result,
    note: result.running
      ? "Still installing: read the rest with code_command_output. The user's app loads the sandbox once they turn on Try live for this workspace."
      : "Running. The user's app loads it (on their device only) once they turn on Try live for this workspace; it reloads as you save files.",
  };
}

async function stopSandbox(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  if (workspace.sandbox_port) {
    const sandbox = await sandboxFor(db, workspace);
    await sandbox.run(`pkill -f ${shellQuote(`gondol-apps dev .* --port ${workspace.sandbox_port}`)} || true`, { waitMs: 15_000 });
  }
  await db.from("agent_workspaces").update({ sandbox_port: null, sandbox_url: null, sandbox_started_at: null }).eq("id", workspace.id);
  return { stopped: true };
}

async function prepareRelease(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const { sandbox, root } = await ready(db, workspace);
  const dir = workspacePath(root, str(input.path) ?? workspace.sandbox_app_path ?? fail(422, "Give the app package's path"));
  const pkgBytes = await sandbox.download(`${dir}/package.json`);
  if (!pkgBytes) fail(404, `${dir} has no package.json`);
  const pkg = JSON.parse(decoder.decode(pkgBytes!)) as { version?: string; gondol?: { manifest?: string; client?: string; styles?: string[] } };
  if (!pkg.gondol) fail(422, `${dir}/package.json has no "gondol" field: it isn't a gondol app package`);
  const manifestPath = workspacePath(dir, pkg.gondol!.manifest ?? "manifest.json");
  const manifestBytes = await sandbox.download(manifestPath);
  if (!manifestBytes) fail(404, `There is no ${manifestPath}`);
  const manifest = JSON.parse(decoder.decode(manifestBytes!)) as Record<string, unknown>;
  const appId = str(manifest.id);
  if (!appId || appIdFrom(appId) !== appId) fail(422, "The manifest's id must be lower-case letters, digits, - and _");
  const functions = manifest.functions && typeof manifest.functions === "object" ? Object.keys(manifest.functions) : [];
  if (functions.length) fail(422, `The registry publishes apps without backend functions for now (this one has ${functions.join(", ")}); serve those with gondol-apps serve and an admin's approval instead`);
  const name = (() => {
    const n = manifest.name;
    if (typeof n === "string") return n;
    if (n && typeof n === "object") return str((n as Record<string, unknown>).en) ?? str(Object.values(n)[0]) ?? appId!;
    return appId!;
  })();
  const version = str(input.version) ?? str(pkg.version) ?? "0.1.0";

  if (input.build !== false) {
    const build = await sandbox.run(`${ENV_PREFIX(root)}cd ${shellQuote(dir)} && (test -d node_modules || npm install --no-audit --no-fund --loglevel=error) && npx gondol-apps build .`, { timeoutSeconds: 900 });
    if (build.running) return { building: true, command_id: build.command_id, note: "Still building: wait for it with code_command_output, then call code_prepare_release again with build: false." };
    if (build.exit_code !== 0) fail(422, `The build failed (${build.exit_code}): ${tail(build.stderr || build.stdout, 4000)}`);
  }
  const listed = await sandbox.must(`cd ${shellQuote(`${dir}/dist`)} && find . -type f ! -name server.mjs ! -name 'server.mjs.map' -printf '%s %P\\n' | head -500`);
  const files = listed
    .split("\n")
    .map((line) => /^(\d+) (.+)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ size: Number(m[1]), path: m[2] }));
  const clientRel = (pkg.gondol!.client ?? "./dist/client.mjs").replace(/^\.\//, "");
  if (!files.some((f) => `dist/${f.path}` === clientRel)) fail(422, `The build has no ${clientRel}`);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > RELEASE_MAX_BYTES) fail(413, `The build is ${Math.round(total / 1024 / 1024)} MB; a release may be at most ${RELEASE_MAX_BYTES / 1024 / 1024} MB`);
  const styles = (pkg.gondol!.styles ?? []).map((s) => s.replace(/^\.\//, "")).filter((s) => files.some((f) => `dist/${f.path}` === s));

  const { data: release, error } = await db
    .from("code_app_releases")
    .insert({ app_id: appId, name, version, manifest, workspace_id: workspace.id, notes: str(input.notes), status: "uploading" })
    .select("id, user_id")
    .single();
  if (error || !release) fail(error?.code === "42501" || error?.code === "23505" ? 409 : 500, error?.message ?? "The release wasn't saved");
  const base = `${release.user_id}/${appId}/${release.id}`;
  const storage = admin!.storage.from(BUCKET);
  const put = async (path: string, body: Uint8Array | string) => {
    const { error: uploadError } = await storage.upload(`${base}/${path}`, typeof body === "string" ? new TextEncoder().encode(body) : body, {
      contentType: publishedContentType(path),
      upsert: true,
      cacheControl: "31536000",
    });
    if (uploadError) fail(502, `Couldn't store ${path}: ${uploadError.message}`);
  };
  try {
    for (const file of files) {
      const bytes = await sandbox.download(`${dir}/dist/${file.path}`);
      if (bytes) await put(`dist/${file.path}`, bytes);
    }
    await put("manifest.json", JSON.stringify(manifest, null, 2));
    await put("gondol-apps.json", JSON.stringify(releaseIndex({ id: appId!, version, name, styles, client: clientRel }), null, 2));
  } catch (caught) {
    await db.from("code_app_releases").delete().eq("id", release.id);
    throw caught;
  }
  const indexUrl = storage.getPublicUrl(`${base}/gondol-apps.json`).data.publicUrl;
  const { error: updateError } = await db
    .from("code_app_releases")
    .update({ status: "ready", index_url: indexUrl, files: files.map((f) => f.path), size_bytes: total })
    .eq("id", release.id);
  if (updateError) fail(500, updateError.message);
  return {
    release: release.id,
    app: appId,
    version,
    files: files.length,
    index: indexUrl,
    note: "Ready to publish. Tell the user: they publish it into the apps registry with Publish on the workspace's page.",
  };
}

async function workspaceInfo(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const repos = await workspaceRepositories(db, workspace);
  return {
    ...workspace,
    repositories: repos.map((r) => ({ repository: r.code_repositories.full_name ?? r.code_repositories.name, path: r.path, branch: r.branch, cloned: !!r.cloned_at })),
  };
}

async function listRepositories(db: SupabaseClient) {
  const { data, error } = await db.from("code_repositories").select("id, name, full_name, html_url, default_branch, description, private").order("updated_at", { ascending: false }).limit(200);
  if (error) fail(500, error.message);
  return { repositories: data ?? [] };
}

async function addRepository(db: SupabaseClient, input: Input) {
  const workspace = await loadWorkspace(db, input.workspace);
  const key = str(input.repository) ?? fail(422, "Name the repository (owner/name or a git URL)");
  let { data: repo } = await db.from("code_repositories").select("id, name").or(UUID.test(key!) ? `id.eq.${key}` : `full_name.ilike.${key!.replace(/[,()]/g, "")},clone_url.eq.${key!.replace(/[,()]/g, "")}`).limit(1).maybeSingle();
  if (!repo) {
    const fullName = githubFullName(key!) ?? (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(key!) ? key! : null);
    if (!fullName) fail(404, `${key} isn't one of the user's repositories, a GitHub owner/name or a GitHub URL`);
    const name = fullName!.split("/")[1];
    const { data: created, error } = await db
      .from("code_repositories")
      .insert({ name, full_name: fullName, provider: "github", clone_url: `https://github.com/${fullName}.git`, html_url: `https://github.com/${fullName}` })
      .select("id, name")
      .single();
    if (error || !created) fail(500, error?.message ?? "The repository wasn't saved");
    repo = created;
  }
  const { error } = await db
    .from("agent_workspace_repositories")
    .upsert({ workspace_id: workspace.id, repository_id: repo!.id, branch: str(input.branch), path: repositoryFolder(repo!.name as string) }, { onConflict: "workspace_id,repository_id" });
  if (error) fail(500, error.message);
  return await setup(db, { ...workspace, status: "setting_up" });
}

const TOOLS: Record<string, (db: SupabaseClient, input: Input) => Promise<unknown>> = {
  code_list_repositories: (db) => listRepositories(db),
  code_workspace_info: workspaceInfo,
  code_setup_workspace: async (db, input) => setup(db, await loadWorkspace(db, input.workspace)),
  code_add_repository: addRepository,
  code_run_command: runCommand,
  code_command_output: commandOutput,
  code_read_file: readFile,
  code_write_file: writeFile,
  code_edit_file: editFile,
  code_list_files: listFiles,
  code_git_status: gitStatus,
  code_commit_and_push: commitAndPush,
  code_create_repository: createRepository,
  code_scaffold_app: scaffoldApp,
  code_start_sandbox: startSandbox,
  code_stop_sandbox: stopSandbox,
  code_prepare_release: prepareRelease,
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ error: "POST a function's input" }, 405);
  if (!admin) return json({ error: "agent-code isn't configured (SUPABASE_SERVICE_ROLE_KEY)" }, 500);
  const name = request.headers.get("x-gondol-function") ?? new URL(request.url).pathname.split("/").pop() ?? "";
  const tool = TOOLS[name];
  if (!tool) return json({ error: `agent-code has no function ${name}` }, 404);
  let input: Input = {};
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) input = body as Input;
  } catch {
    // no body: no input
  }
  try {
    const db = userClient(request);
    return json(await tool(db, input));
  } catch (error) {
    if (error instanceof Problem) return json({ error: error.message }, error.status);
    console.error(`agent-code ${name}:`, error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
