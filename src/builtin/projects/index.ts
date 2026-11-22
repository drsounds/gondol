import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** Projects group an agent's conversations, workspaces, connected accounts and schedules. */
export const projectsApp = defineApp({
  manifest,
  pages: {
    projects: () => import("./features/projects/src/pages/ProjectsPage").then((m) => m.ProjectsPage),
  },
  entitySources: {
    project: { table: "projects", columns: "id, name", label: (row) => str(row.name) },
  },
});

export default projectsApp;
