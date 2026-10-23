# The streams app

Gondol's `streams` app records what the user does as **streams**: a subject (the user) doing an
action, the **predicate**, on an **object** entity, in a **context** (a task), for a **motivation**
(any entity), from a **start** to an **end**, with a **quantity**. Each stream has **entries** that
move yin (out) and yang (in) to an object, optionally booked against the host's accounts; a stream
is in equilibrium when they balance, and entries must keep it that way. The
[analytics app](./analytics.md) analyses them.

## Switching it on

```ts
import { streamsApp } from "gondol/builtin/streams";
configureGondol({ apps: [...myApps, streamsApp] });
// or, with the Vite plugin:
gondolApps({ dir: "apps", builtin: ["streams"] });
```

## Pages

| Path | |
| --- | --- |
| `/streams` | Every stream as an expandable card with its entries. Dropping an entity on a stream starts a new entry for it. |
| `/streams/new`, `/streams/<key>/edit` | The stream's sheet: action, task context, object, motivation, start, end, quantity, description, source. |
| `/streams/<key>/entries/new`, `/streams/<key>/entries/<key>/edit` | An entry's sheet: object, yin and yang (and their accounts). |

The app owns the entity type `stream` (public address `/stream/<key>`, edit `/streams/<key>/edit`).

## What the host can add

Answer `streamsHostHook` (`gondol/builtin/streams/models`) in `configureGondol({ resolutions })`:

```ts
import { answer } from "gondol/apps/contributions";
import { streamsHostHook } from "gondol/builtin/streams/models";

answer(streamsHostHook, {
  // The accounts an entry's yin and yang can be booked against; without it there are no account pickers.
  accounts: { queryKey: ["accounts"], queryFn: async () => (await loadAccounts()).map((a) => ({ id: a.id, label: a.name, active: a.active })) },
  // Seconds by context URI (a task's estimate), shown as "position / length"; without it the position shows alone.
  contextDurations: { queryKey: ["tasks", "estimates"], queryFn: loadTaskEstimates },
});
```

## The tables

```sql
CREATE TABLE public.streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,                       -- the predicate
  subject_uri text NOT NULL,                  -- <scheme>:user:<user id>
  context_uri text,                           -- a task
  object_uri text,
  motivation_uri text,                        -- any entity URI
  description text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'automatic')),
  start_date timestamptz NOT NULL DEFAULT now(),
  end_date timestamptz,
  duration_seconds integer,                   -- set from start_date and end_date by a trigger
  position_seconds integer,
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stream_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stream_id uuid NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  object_uri text,
  yin numeric NOT NULL DEFAULT 0 CHECK (yin >= 0),
  yang numeric NOT NULL DEFAULT 0 CHECK (yang >= 0),
  yin_account_id uuid,
  yang_account_id uuid,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Both have the usual `identifier` and `slug` columns, and RLS that lets a user manage their own rows.
The length is never written by the client: a `BEFORE INSERT OR UPDATE` trigger sets
`duration_seconds` to `end_date - start_date` in seconds, and to NULL while the stream is open.

## The API

The app declares an [HTTP API](./api.md) for HTML5 and other apps, called with an
[OAuth](./oauth.md) access token:

| Operation | Scope | Function | |
| --- | --- | --- | --- |
| `POST /streams` | `streams:write` | `api_start_stream` | Starts a stream for the user: `subject_uri` (the user, the default), `predicate_uri` (or `action` in words), `object_uri`, `motivation_uri`, `context_uri`, `started_at` (default now), `ended_at`, `duration_seconds`, `position_seconds`, `quantity` (default 1), `description`. Answers `201` with the stream and its `id`. |
| `PATCH /streams/{id}` | `streams:write` | `api_update_stream` | Reports how it went: `ended_at` (or `ended: true` for now), `position_seconds`, `quantity`, `description` and any URI. Fields left out stay; the duration follows from start and end unless given. |
| `GET /streams/{id}` | `streams:read` | `api_get_stream` | The stream. |

The functions run as the user (RLS) and record the calling app as the actor in the audit trail.
Spacify's migration `20261023110000_oauth_and_app_api.sql` creates them.
