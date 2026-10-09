# Supabase

Gondol talks to Supabase through one shared browser client, offers a service-role client and auth
middleware for server functions, and expects a small base schema in your project.

## Clients

### The browser client

```ts
import { getSupabaseClient, supabase } from "gondol/supabase/client";
import type { Database } from "@/integrations/supabase/types"; // your generated schema

export const db = getSupabaseClient<Database>();
```

`getSupabaseClient<Database>()` returns the one client gondol uses, typed with your app's schema, so
your app and gondol share one auth session. It is created on first use from `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`, falling back to `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` during
SSR. `supabase` is the same client typed with gondol's base schema.

To build the client yourself (different auth options, a custom fetch), hand it to gondol before
anything queries:

```ts
import { setSupabaseClient } from "gondol/supabase/client";
setSupabaseClient(createClient<Database>(url, key, { /* … */ }));
```

### The admin client

`getSupabaseAdmin<Database>()` (`gondol/supabase/client.server`) uses `SUPABASE_SERVICE_ROLE_KEY` and
bypasses row-level security. Only use it in server functions and server routes, and load it inside
the handler, since route files ship to the browser:

```ts
const { getSupabaseAdmin } = await import("gondol/supabase/client.server");
```

### Sessions

| Export | Use |
| --- | --- |
| `useSession()` (`gondol/supabase/useSession`) | `{ session, loading }`, kept in sync with auth changes. Remembers the last session so remounts don't flash a loading state. |
| `hasKnownSession()` | Whether a session is already known, outside React (route loaders). |
| `sessionUserId()` (`gondol/supabase/session`) | The signed-in user's id, or throws. Use it in query functions. |

## Server functions with the user's rights

Two middlewares let a TanStack Start server function act as the signed-in user:

1. `attachSupabaseAuth` (`gondol/supabase/auth-attacher`) sends the browser's access token with every
   server function call. Register it as a global function middleware:

   ```ts
   // src/start.ts
   import { createStart } from "@tanstack/react-start";
   import { attachSupabaseAuth } from "gondol/supabase/auth-attacher";

   export const startInstance = createStart(() => ({
     functionMiddleware: [attachSupabaseAuth],
   }));
   ```

2. `requireSupabaseAuth` (`gondol/supabase/auth-middleware`) verifies the token and gives the
   function a client acting as that user (RLS applies), with `userId` and `claims`:

   ```ts
   import { createServerFn } from "@tanstack/react-start";
   import { requireSupabaseAuth } from "gondol/supabase/auth-middleware";

   export const archiveNotes = createServerFn({ method: "POST" })
     .middleware([requireSupabaseAuth])
     .handler(async ({ context }) => {
       const { supabase, userId } = context;
       await supabase.from("notes").update({ archived: true }).eq("user_id", userId);
     });
   ```

`gondol/supabase/fetch` has the helpers the clients are built from: `createSupabaseFetch(key)`,
`requireEnv(vars)` and `lazy(create)`.

## The base schema

Gondol's own queries expect these in your project (typed in `GondolDatabase`, `src/supabase/types.ts`).
The migrations that create them live in the app; Spacify's `supabase/migrations/` has them all.

### Tables

| Table | Columns | Used by |
| --- | --- | --- |
| `public_entities` | `id`, `user_id`, `entity_type`, `entity_id`, `created_at`; unique `(user_id, entity_type, entity_id)` | "Make public" (`usePublicEntities`, `useSetEntityPublic`). |
| `user_themes` | `id`, `user_id`, `mode`, `accent_color`, `engine`, `theme` (jsonb), `saved_themes` (jsonb), `slug`, `identifier`, timestamps | Cross-device appearance sync. |

### Functions

| Function | Returns | Used by |
| --- | --- | --- |
| `search_entities(p_query, p_types?, p_limit?)` | Every readable entity matching the query (see [Search](./search-and-filters.md#making-a-type-searchable)). | Search page, pickers, mentions. |
| `global_filter_excluded(p_types?, p_conditions?, p_match?, p_from?, p_to?)` | `(entity_type, entity_id)` pairs that fail the filter. | The global filter. |
| `entity_slugs(p_keys)` | `(key, entity_table, id, slug)` for each uuid or identifier the caller can read. | Slug redirects, "Copy URI". |
| `entity_lifecycle_states()` | `(entity_type, entity_id, entity_slug, entity_identifier, soft_deleted_at, future_start)`. | Lifecycle dimming and hiding. |
| `set_entity_soft_deleted_at(p_entity_type, p_entity_key, p_at)` | Schedules, cancels or restores soft deletion. | `ActionMenu`, `useEntityLifecycle`. |
| `site_for_domain(p_domain)` | The site served on a domain, also before sign-in. | `SiteProvider`. |

Grant them to `authenticated` (and `site_for_domain` to `anon` as well, so the sign-in page can
wear a site's theme).

## Entity tables

Every table behind an entity type should have:

- `id uuid primary key default gen_random_uuid()`,
- `user_id uuid` referencing `auth.users` (the owner), with RLS policies on it,
- `created_at` and `updated_at` timestamps,
- `slug` and `identifier`, with the triggers that keep them in sync. In Spacify,
  `SELECT public.add_entity_slug('public.notes');` adds both (pass `true` as a second argument for
  a slug unique across the whole table, for entities other users open too).

`entity_slugs()` finds every table that has the slug trigger, so a new table is picked up
automatically. Then add the type to `search_entities()` and `global_filter_excluded()`, and register
it in the app (see [Adding an entity type](./entities.md#adding-an-entity-type)).

```sql
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  notebook_id uuid references public.notebooks (id) on delete set null,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "Owners manage their notes" on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

select public.add_entity_slug('public.notes');
```
