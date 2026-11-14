# The mastodon app

Gondol's built-in `mastodon` app is a Mastodon server and a Mastodon client in one:

- **Servers** (`mastodon_instances`, entity type `mastodon_instance`) run on the host's own domains.
  Each has a name, descriptions, rules, languages, a character limit and how it takes new people:
  `open`, `approval` (moderators approve sign-ups) or `closed` (only admins add people).
- **Profiles** (`mastodon_accounts`, `mastodon_account`) are local (a user's profile on one of the
  servers, `user_id` + `instance_id`) or remote (an account on another server, `domain`, written by
  the federation). A user can have several profiles and picks the one they act as. Local profiles
  have a role on their server (`owner`, `admin`, `moderator`, `user`) and a status (`pending`,
  `active`, `silenced`, `suspended`, `disabled`).
- **Statuses** (`mastodon_statuses`, `mastodon_status`): a local status keeps the text as typed
  (`text`; @mentions, #hashtags and links are found in it by triggers), a remote one its sanitised
  HTML (`content_html`). Visibility is `public`, `unlisted`, `private` (followers) or `direct`.
  Boosts are statuses with `reblog_of_id`. Media (`mastodon_media_attachments`), polls
  (`mastodon_polls`, `mastodon_poll_votes`), mentions and hashtags (`mastodon_tags`) hang off them.
- **Relations**: follows (`pending` until a locked profile accepts), favourites, bookmarks, blocks,
  mutes, lists (`mastodon_lists` + `mastodon_list_accounts`), followed hashtags and notifications.
- **Moderation**: domain blocks (`noop`/`silence`/`suspend`, reject media) per server, and the
  moderators' notes on profiles (`mastodon_account_notes`, read only through
  `mastodon_admin_accounts()`).

Every one of these is an entity type of its own (`mastodon_instance`, `mastodon_account`,
`mastodon_status`, `mastodon_media`, `mastodon_poll`, `mastodon_tag`, `mastodon_follow`,
`mastodon_favourite`, `mastodon_bookmark`, `mastodon_block`, `mastodon_mute`, `mastodon_list`,
`mastodon_notification`, `mastodon_domain_block`), with identifiers and slugs, so they can be
searched, saved, put in playlists, shared, tagged and read by the generic entity tools.

## Pages

- `/mastodon`: the client. Home, local and federated timelines, notifications, bookmarks,
  favourites, lists, search (with "look up `user@domain` or a link on its server"), the user's
  profiles and other servers. `/mastodon/new` composes (text, content warning, visibility, up to
  four images from the media library or by address, a poll); `/mastodon/statuses/<key>` is a thread
  (`/reply`, `/edit`); `/mastodon/accounts/<key or user@domain>` is a profile (`/edit`);
  `/mastodon/accounts/new` sets up a profile (signing up on a server); `/mastodon/tags/<name>`,
  `/mastodon/lists/…` and `/mastodon/follow-requests`.
- `/mastodon/remote`: profiles on other Mastodon servers. Signing in registers the app on that
  server (`POST /api/v1/apps`) and runs its OAuth flow back to `/mastodon/remote/callback`; the
  browser then uses the server's own client API (Mastodon answers it with CORS). The session is kept
  in `mastodon_remote_sessions`, which only its owner reads.
- `/mastodon-instances`: the servers, and for each one its people (approve sign-ups, limit,
  suspend, restore, change roles, a private note, add someone who has an account in the app by
  e-mail) and the servers it blocks. Only a server's owner, admins and moderators see them; only
  the owner makes admins.

## Switching it on

```ts
import { mastodonApp } from "gondol/builtin/mastodon";

configureGondol({ apps: [...myApps, mastodonApp] });
// or: gondolApps({ dir: "apps", builtin: ["mastodon"] })
```

Pass `--builtin mastodon --functions supabase/functions` to `gondol-api` too: it serves the app's
MCP tools on `/mcp` (`mastodon__my_accounts`, `timeline`, `post`, `follow`, `favourite`, `search`,
`notifications`) and writes its server to `supabase/functions/mastodon/index.ts` with the
ActivityPub helpers in `_shared/activitypub.ts`.

## The server

The `mastodon` edge function (deploy it with `verify_jwt = false`: other servers call it with HTTP
signatures and Mastodon apps with OAuth tokens, which it checks itself) answers:

| Path | What |
| --- | --- |
| `/.well-known/webfinger`, `host-meta`, `nodeinfo`, `/nodeinfo/2.0` | discovery |
| `/ap/users/<name>` (and `/@<name>` asking for JSON), its `outbox`, `followers`, `following`, `collections/featured` | actors |
| `/ap/statuses/<id>` | a public or unlisted status as a Note |
| `/ap/actor` | the server's own actor, which signs fetches |
| `/ap/inbox`, `/ap/users/<name>/inbox` | inboxes: Follow, Accept, Reject, Undo, Create (and poll votes), Update, Delete, Like, Announce, Block, with signatures checked |
| `/api/v1/…`, `/api/v2/…` | a subset of the Mastodon client API (apps, instance, accounts, relationships, timelines, statuses, favourites, boosts, bookmarks, polls, notifications, search, lists, follow requests) |
| `/client/resolve`, `/client/refresh` | the app's lookups of remote accounts and posts |
| `/deliver` | delivers what's queued |

Writes made in the app (statuses, follows, favourites, profile changes, …) queue activities in
`mastodon_activities` from triggers; `/deliver` turns them into signed deliveries
(`mastodon_deliveries`, retried with backoff) to every inbox concerned. pg_cron calls
`mastodon_tick()` each minute, which pokes `/deliver` through pg_net with the secret in
`mastodon_function_config`, and the app pokes it after each write.

The host's web server must forward each server's public paths to the function, naming the domain in
`x-mastodon-host`: `/.well-known/webfinger`, `/.well-known/host-meta`, `/.well-known/nodeinfo`,
`/nodeinfo/*`, `/ap/*`, `/api/v1/*`, `/api/v2/*`, and `/@<name>` when the request asks for
ActivityPub JSON (otherwise send people to `/mastodon/accounts/<name>`). Mastodon apps also need
`/oauth/token` and `/oauth/revoke`, which the oauth app's gateway answers (`/app-api/oauth/…`), and
`/oauth/authorize`, the oauth app's consent page.

Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `JWT_SECRET` (or
`SUPABASE_JWT_SECRET`). Optional: `MASTODON_DEFAULT_DOMAIN` (the server when no host is named),
`MASTODON_ALLOW_PRIVATE=true` (fetch from private addresses, for development). Then, once:

```sql
SELECT public.set_mastodon_function_url('https://<project>/functions/v1/mastodon');
```

## Not there yet

- Media uploads through the client API (`/api/v2/media`); the app attaches media-library images
  and links.
- The streaming API, reports, filters, featured tags, announcements and custom emoji.
- Access tokens from the oauth app expire after an hour, which some Mastodon apps don't expect.
