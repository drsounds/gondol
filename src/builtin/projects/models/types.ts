export interface Project {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export const PROJECT_RESOURCE_TYPES = ["agent", "conversation", "workspace", "account", "automation"] as const;
export type ProjectResourceType = (typeof PROJECT_RESOURCE_TYPES)[number];

export interface ProjectResource {
  id: string;
  user_id: string;
  project_id: string;
  resource_type: ProjectResourceType;
  resource_id: string;
  created_at: string;
}

type Plain<T> = { [K in keyof T]: T[K] };
type Table<Row> = { Row: Plain<Row>; Insert: Partial<Plain<Row>>; Update: Partial<Plain<Row>>; Relationships: [] };

export type ProjectsDatabase = {
  public: {
    Tables: {
      projects: Table<Project>;
      project_resources: Table<ProjectResource>;
      agents: Table<{ id: string; name: string; username: string; user_id: string }>;
      agent_conversations: Table<{ id: string; title: string | null; agent_id: string; user_id: string; updated_at: string }>;
      agent_workspaces: Table<{ id: string; title: string | null; user_id: string; updated_at: string }>;
      agent_schedules: Table<{ id: string; title: string; user_id: string }>;
      account_connections: Table<{ id: string; login: string; provider: string; user_id: string; created_at: string }>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
