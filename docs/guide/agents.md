# The agents app

Gondol's `agents` app hires AI agents that work through the apps' MCP tools (the `app-router`'s
`/mcp`, see [App functions](./functions.md)). It depends on the [ai app](./ai.md).

## Switching it on

```ts
import { agentsApp } from "gondol/builtin/agents";
configureGondol({ apps: [...myApps, agentsApp] });
// or: gondolApps({ dir: "apps", builtin: ["agents"] });
```

`gondol-api --builtin …,agents` also copies the `ai-agents` edge function (and
`_shared/agentPrompt.ts`) into the host's `supabase/functions/`. Deploy it with `verify_jwt = false`
and point pg_cron at it with `set_agent_runner_url()`; without it, runs are made by the browser
while the app is open (`useAgentRunner()`).

A tick answers pg_net at once (202) and works on in the background (`EdgeRuntime.waitUntil`), and
all of its work has to fit in the worker's wall clock (the self-hosted main router's
`workerTimeoutMs`, 60 s by default): `AGENT_WORKER_WALL_MS` (default 50 s) is how long it may take.
A model that doesn't answer in time fails the run with a message saying so; for slow models raise
both. Runs that still say "running" after ten minutes (a cut-off worker, a closed tab) are failed by
`fail_stale_agent_runs()`, which `queue_due_agent_runs()` and `claim_agent_runs()` call.

## What an agent is

An `agents` row has a name, an `@username`, an avatar, a job title, a bio, standing instructions,
the model it runs on (`provider`, optional `service_id`, `model`, `temperature`), `tool_access`
(`none`, `read`, `all`), a time zone and working hours. `agent_schedules` give it instructions on a
cron; every piece of work is an `agent_runs` row, and direct threads are `agent_conversations` with
`agent_messages` (threads to any depth through `parent_id`).

## Pages

| Path | |
| --- | --- |
| `/agents` | The user's agents. |
| `/agents/<key>` | The main chat with an agent; more conversations at `/agents/<key>/conversations/<id>`. |
| `/agents/<key>/settings` | Its profile, with tabs for conversations (`…/conversations`), schedules (`…/schedules`) and runs (`…/runs`). |
| `/agents/<key>/runs/<id>` | One run opened as a conversation to go on from (`open_agent_run_conversation()`). |
| `/agents/<key>/messages/…` | A messenger thread with the account, an alter ego or another agent. |
| `/agents/new`, `/agents/<key>/edit`, `…/settings/schedules/{new,<key>/edit}` | The sheets. |

The intercom (an `overlayWidgets` entry) lists agents behind a launcher and keeps open
conversations as chat bubbles.

## What the host can add

Alter egos and channels are the host's. Answer `agentsHostHook` (`gondol/builtin/agents/models`) to
let agents talk with egos and post in channels; without it they work in direct threads with the
account and each other:

```ts
import { answer } from "gondol/apps/contributions";
import { agentsHostHook } from "gondol/builtin/agents/models";

answer(agentsHostHook, {
  useEgos,                                  // { data?: { id, name, username }[], isLoading }
  channels: {
    useChannels,                            // channels a schedule can post to
    context: async ({ channelId, parentId, speakerUsername }) => ({ channel, lines }),
    post: async ({ channelId, parentId, agentId, userId, body }) => { /* insert the message */ },
    queryKeys: [["channel-feed"]],          // refetched after an agent posts
  },
});
```

The `ai-agents` function reads the host's `egos`, `channels`, `channel_messages` and
`channel_thread()` when they exist. An agent's avatar picker is the media host's `MediaPicker`
(see [playlists](./playlists.md#images)).

## Coding

Agents can code: on the user's existing repositories or new ones, and on new gondol apps they try
in a live sandbox and the user publishes into the apps registry. Nothing new talks to a model for
this: an agent keeps running on its own model in the agents' runners, and coding is a set of the
agents app's own [functions](./functions.md) and MCP tools (`agents__code_*` on `/mcp`), answered by
the `agent-code` edge function (`gondol-api --builtin …,agents` copies it, and
`_shared/codeWorkspace.ts`, into the host; deploy it with `verify_jwt = false`). An agent with
`tool_access` `read` gets only the tools that read; `all` gets every one.

```
agent run (its own model, browser or ai-agents runner)
  └─ tools/call agents__code_run_command { workspace, command }   ← app router /mcp, as the owner
       └─ agent-code ── POST /api/bash/start_bash_command ──▶ OpenHands agent server (a docker container)
                     ── GET  /api/bash/bash_events/search      (only its shell and files are used,
                     ── GET/POST /api/file/download|upload       never its own LLM conversations)
```

**The sandbox** is an [OpenHands](https://github.com/OpenHands/software-agent-sdk) agent server, the
`ghcr.io/openhands/agent-server` image, used as a sandbox through its bash and file endpoints
(`X-Session-API-Key`). Users add their own under Code › Sandboxes (`code_sandboxes`: its address, a
preview address with `{port}` and the preview ports it publishes, the folder workspaces go in; the
session key is write-only, `set_code_sandbox_key()` into `code_sandbox_keys`). The server's own
(`OPENHANDS_AGENT_SERVER_URL`, `OPENHANDS_SESSION_API_KEY`, `OPENHANDS_PREVIEW_URL`,
`OPENHANDS_PREVIEW_PORTS`) serves the users `OPENHANDS_SHARED_SANDBOX` names: `everyone`, `admins`
(the host's `is_platform_admin()`) or `off` (the default). Workspaces in one container can read each
other's files, so share one only between people who may.

```sh
docker run -d --name openhands-sandbox -p 8000:8000 -p 5180-5199:5180-5199 \
  -e OH_SESSION_API_KEYS_0=<a long random key> ghcr.io/openhands/agent-server:latest-python
```

Put HTTPS in front of port 8000 (the agent server) and of each preview port
(`https://{port}.sandbox.example.com` → `localhost:{port}`, WebSockets included, for live reload).

**Repositories** (`code_repositories`, type `code_repository`) are GitHub repositories (or any https
git address) the user connects under Code › Repositories. **GitHub** is the GitHub MCP server
(`https://api.githubcopilot.com/mcp/`, an `ai_mcp_servers` row whose Authorization header carries a
personal access token): its tools give agents issues and pull requests, and `agent-code` reads the
same token (service role) to clone, push and create repositories.

**Workspaces** (`agent_workspaces`, type `agent_workspace`, at most one per agent conversation) are
`<workspace root>/gondol/<id>` in a sandbox, with the repositories connected to them
(`agent_workspace_repositories`) cloned inside and `.gondol/` holding a git config whose credential
helper reads the token, so every command runs with `GIT_CONFIG_GLOBAL` and no token on a command
line. A run in a conversation with a workspace is told about it (`codeWorkspacePrompt()`) and gets
`CODING_TOOL_ROUNDS` (40) tool rounds instead of 8; the server runner still has to finish inside
`AGENT_WORKER_WALL_MS`, so long coding sessions are best run with the app open (the browser runner).
A command still running after `CODE_WAIT_MS` (40 s) comes back with its `command_id`.

| Tool | |
| --- | --- |
| `code_list_repositories`, `code_workspace_info` | What there is (read-only). |
| `code_setup_workspace`, `code_add_repository` | Make the folder, write the git config, clone. |
| `code_run_command`, `code_command_output` | A shell command in the sandbox, and the rest of a long one. |
| `code_list_files`, `code_read_file`, `code_write_file`, `code_edit_file` | Files (an edit replaces one exact match). |
| `code_git_status`, `code_commit_and_push` | Status and diff; commit everything and push, to a branch or a new one. |
| `code_create_repository` | A new GitHub repository (private by default), connected and cloned. |
| `code_scaffold_app` | A new [remote app](./remote-apps.md) package: manifest, package.json, a page. |
| `code_start_sandbox`, `code_stop_sandbox` | `gondol-apps dev --public-url <preview>` on a free preview port. |
| `code_prepare_release` | `gondol-apps build`, then `dist/`, the manifest and a one-app index into storage. |

**The live sandbox** is the user's own app: "Try live" on the workspace's page adds the running
dev runtime as a dev source in that browser only, so the app shows in the menu and reloads as the
agent saves (`useAgentAppSources()`, below).

**Kicking development off** (`ensureAgentWorkspace()` in `gondol/builtin/agents/models`, the
`/code` start page and the conversation bar over any agent chat): describe the idea to an agent and
it all happens at once — a fresh conversation opens (every idea its own), its workspace is created
in a sandbox (the user's first enabled one, else the server's where its operator allows it), the
repositories the prompt mentions (`owner/name`; saved rows when they are, else
`code_add_repository` finds them on GitHub) are connected, a prompt that names none gets a new
private GitHub repository of the idea's own (`code_create_repository()`, named
`guessProjectName(idea)`), the whole thing is prepared by `code_setup_workspace()` and the agent's
first run is queued with the idea as its instructions. `mentionedRepos()` picks the repository
mentions out of a prompt; `findWorkspaceByMention()` finds the workspace a prompt's repositories
already live in.

**Releases and the apps registry**: `code_prepare_release` stores a build in the public storage
bucket `gondol-apps` (`<user>/<app>/<release>/`, `CODE_APPS_BUCKET`) as a `code_app_releases` row,
`ready`. The user presses **Publish** (`publish_code_app_release()`): live for them at once; "Publish
for everyone" waits for a platform admin (`review_code_app_release()`). The first to publish an app
id owns it. `code_app_registry()` lists the latest published release of each app the caller may
load; the host adds them to its remote app sources:

```tsx
import { useAgentAppSources } from "gondol/builtin/agents/models/code";
<RemoteAppsRegistrar sources={[...ownSources, ...useAgentAppSources()]} />
```

Published apps are client-only for now: an app with backend functions is refused (serve those from
a gondol apps runtime with an admin's approval).

| Path | |
| --- | --- |
| `/code` | The start page (CodeStart): one big window to prompt an idea, kickstarting development, with the agent picked beside it. |
| `/code/workspaces` | Workspaces; `/code/workspaces/<key>` one (repositories, live sandbox, releases with Publish). |
| `/code/repositories`, `/code/sandboxes`, `/code/apps` | Repositories, sandboxes, and the registry (admins approve public apps there). |
| `…/new`, `…/<key>/edit` | The sheets. "Connect repositories" over a conversation makes its workspace. |

Other `agent-code` settings: `OPENHANDS_WORKSPACE_ROOT` (default `/workspace`),
`OPENHANDS_ALLOWED_HOSTS` / `OPENHANDS_ALLOW_PRIVATE` (users' sandboxes on private addresses),
`GONDOL_PACKAGE_SPEC` (what new apps build against, default `git+https://github.com/drsounds/gondol.git`)
and `CODE_COMMIT_EMAIL` (`{username}` is the agent's).
