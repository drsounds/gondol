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
| `/agents/<key>/settings` | Its profile, schedules and work log. |
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
