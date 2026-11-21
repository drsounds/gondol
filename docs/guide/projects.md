# The projects app

The `projects` app groups agents, agent conversations (sessions), coding workspaces, connected
accounts, and agent schedules (automations) under a shared project. The project resource links are
polymorphic and can also be consumed by host kanban or automation apps; this repository does not
currently include a kanban board app.

## Switching it on

```ts
import { projectsApp } from "gondol/builtin/projects";
configureGondol({ apps: [...myApps, projectsApp] });
// or: gondolApps({ dir: "apps", builtin: ["projects"] })
```

Apply the SQL below in the host's Supabase migrations. The app's RLS policies restrict projects
and resource links to their owner. A trigger also checks that each linked resource belongs to the
same user; browser input cannot associate another user's agent, session, workspace, account, or
schedule with a project.

## Host migration

```sql
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug text not null,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table public.project_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  resource_type text not null check (resource_type in ('agent', 'conversation', 'workspace', 'account', 'automation')),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  unique (project_id, resource_type, resource_id)
);

alter table public.projects enable row level security;
alter table public.project_resources enable row level security;
grant select, insert, update, delete on public.projects, public.project_resources to authenticated;

create policy "Users manage their projects"
  on public.projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage their project resources"
  on public.project_resources for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create function public.check_project_resource_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare resource_owner uuid;
begin
  if not exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.user_id = new.user_id
  ) then
    raise exception 'Project does not belong to this user';
  end if;

  case new.resource_type
    when 'agent' then select user_id into resource_owner from public.agents where id = new.resource_id;
    when 'conversation' then select user_id into resource_owner from public.agent_conversations where id = new.resource_id;
    when 'workspace' then select user_id into resource_owner from public.agent_workspaces where id = new.resource_id;
    when 'account' then select user_id into resource_owner from public.account_connections where id = new.resource_id;
    when 'automation' then select user_id into resource_owner from public.agent_schedules where id = new.resource_id;
  end case;

  if resource_owner is null or resource_owner <> new.user_id then
    raise exception 'Resource does not belong to this user';
  end if;
  return new;
end;
$$;

create trigger project_resource_owner_check
  before insert or update on public.project_resources
  for each row execute function public.check_project_resource_owner();
```

The resource list is a set of references rather than duplicate copies. Removing a link leaves the
resource itself intact; deleting a project deletes its links.
