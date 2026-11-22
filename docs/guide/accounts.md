# The accounts app

The `accounts` app lets a user connect third-party services with OAuth and disconnect them later.
GitHub is the first provider. Its encrypted session is used by `code_copilot_prompt`; the normal
GitHub MCP server remains available for repository cloning, pushing, and MCP tools.

## Switching it on

```ts
import { accountsApp } from "gondol/builtin/accounts";
configureGondol({ apps: [...myApps, accountsApp] });
// or: gondolApps({ dir: "apps", builtin: ["accounts"] })
```

Apply the SQL below in the host's Supabase migrations, deploy the `accounts` edge function with
`verify_jwt = false` (it validates bearer tokens itself), and point GitHub's OAuth App callback
URL at `https://<project>.supabase.co/functions/v1/accounts/callback`.

Set these edge-function secrets:

| Secret | |
| --- | --- |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | The GitHub OAuth App credentials. |
| `GITHUB_OAUTH_REDIRECT_URL` | The callback URL registered with GitHub. |
| `GONDOL_ACCOUNTS_RETURN_URL` | The trusted HTTPS URL of the app's `/accounts` page. |
| `ACCOUNT_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64-encoded. Keep stable; losing it makes saved sessions unreadable. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase connection and server-side access. |

`GONDOL_ACCOUNTS_ORIGIN` can restrict browser CORS to the host origin. No OAuth access token is
returned to the browser; it is encrypted with AES-GCM before being stored. The state value is
random, hashed before storage, expires after ten minutes, and is consumed once. The service-role-only
session table has no user-facing RLS policy.

## Host migration

```sql
create table public.account_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'github'),
  external_user_id text not null,
  login text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.account_sessions (
  account_id uuid primary key references public.account_connections(id) on delete cascade,
  access_token_ciphertext text not null,
  scopes text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.account_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'github'),
  expires_at timestamptz not null
);

alter table public.account_connections enable row level security;
alter table public.account_sessions enable row level security;
alter table public.account_oauth_states enable row level security;

create policy "Users read their connected accounts"
  on public.account_connections for select to authenticated
  using (user_id = auth.uid());

grant select on public.account_connections to authenticated;
```

Do not grant direct browser access to `account_sessions` or `account_oauth_states`. The function uses
the service role only after validating the signed-in user for start/disconnect actions; its callback
consumes the one-time state and stores only an encrypted token.

## Scope and project use

GitHub is requested with `read:user repo`. A user can connect one GitHub account, view its login,
and disconnect it at `/accounts`. The Copilot runner receives the decrypted token only for the
requested prompt; it does not persist it in its own session directory.

Projects can reference `account_connections` to indicate which service session is relevant to that
project. Removing a project association does not disconnect the account.
