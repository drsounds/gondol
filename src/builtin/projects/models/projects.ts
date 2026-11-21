import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "../../../supabase/client";
import type { Project, ProjectResource, ProjectResourceType, ProjectsDatabase } from "./types";

const db = () => getSupabaseClient<ProjectsDatabase>();
export const projectsKey = ["projects"] as const;
export const projectResourcesKey = (projectId: string | null) => ["projects", projectId, "resources"] as const;

export function projectSlug(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "project";
}

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: async () => {
      const { data, error } = await db().from("projects").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });
}

export function useProjectResources(projectId: string | null) {
  return useQuery({
    queryKey: projectResourcesKey(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db().from("project_resources").select("*").eq("project_id", projectId!).order("created_at");
      if (error) throw error;
      return (data ?? []) as ProjectResource[];
    },
  });
}

export function useProjectResourceOptions(type: ProjectResourceType) {
  return useQuery({
    queryKey: ["projects", "resource-options", type],
    queryFn: async () => {
      const client = db();
      if (type === "agent") {
        const { data, error } = await client.from("agents").select("id, name, username").order("name");
        if (error) throw error;
        return (data ?? []).map((r) => ({ id: r.id, label: `${r.name} (@${r.username})` }));
      }
      if (type === "conversation") {
        const { data, error } = await client.from("agent_conversations").select("id, title, agent_id").order("updated_at", { ascending: false });
        if (error) throw error;
        return (data ?? []).map((r) => ({ id: r.id, label: r.title || r.agent_id }));
      }
      if (type === "workspace") {
        const { data, error } = await client.from("agent_workspaces").select("id, title").order("updated_at", { ascending: false });
        if (error) throw error;
        return (data ?? []).map((r) => ({ id: r.id, label: r.title || r.id }));
      }
      if (type === "account") {
        const { data, error } = await client.from("account_connections").select("id, login, provider").order("created_at", { ascending: false });
        if (error) throw error;
        return (data ?? []).map((r) => ({ id: r.id, label: `${r.provider}: ${r.login}` }));
      }
      const { data, error } = await client.from("agent_schedules").select("id, title").order("title");
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id, label: r.title }));
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await db().from("projects").insert({ name: name.trim(), slug: `${projectSlug(name)}-${crypto.randomUUID().slice(0, 8)}` }).select("*").single();
      if (error) throw error;
      return data as Project;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsKey }),
  });
}

export function useAddProjectResource(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, resourceId }: { type: ProjectResourceType; resourceId: string }) => {
      const { error } = await db().from("project_resources").insert({ project_id: projectId, resource_type: type, resource_id: resourceId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectResourcesKey(projectId) }),
  });
}

export function useRemoveProjectResource(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db().from("project_resources").delete().eq("id", id).eq("project_id", projectId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectResourcesKey(projectId) }),
  });
}
