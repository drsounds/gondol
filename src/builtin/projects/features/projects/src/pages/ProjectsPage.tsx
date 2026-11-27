import { useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Badge, Button, Card, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import {
  useAddProjectResource,
  useCreateProject,
  useProjectResourceOptions,
  useProjectResources,
  useProjects,
  useRemoveProjectResource,
} from "../../../../models/projects";
import { PROJECT_RESOURCE_TYPES, type ProjectResourceType } from "../../../../models/types";
import { SkeletonRows } from "../../../../../../shell/Skeleton";

export function ProjectsPage() {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const parts = pathname.split("/").filter(Boolean).slice(1);
  const projectId = parts[0] ?? null;
  const projects = useProjects();
  const [name, setName] = useState("");
  const create = useCreateProject();

  if (projectId) {
    const project = projects.data?.find((row) => row.id === projectId || row.slug === projectId);
    if (projects.isLoading) return <Card><SkeletonRows /></Card>;
    if (!project) return <Card><p className="muted">{t("projects.notFound")}</p><Button onClick={() => go("/projects")}>{t("projects.back")}</Button></Card>;
    return <ProjectDetails projectId={project.id} projectName={project.name} onBack={() => go("/projects")} />;
  }

  return (
    <Card>
      <div className="stack">
        <div>
          <h1 className="panel-title">{t("projects.title")}</h1>
          <p className="muted">{t("projects.intro")}</p>
        </div>
        <form className="panel-head" onSubmit={(event) => {
          event.preventDefault();
          const value = name.trim();
          if (!value) return;
          create.mutate(value, { onSuccess: (project) => { setName(""); go(`/projects/${project.id}`); } });
        }}>
          <Input label={t("projects.name")} value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} />
          <Button type="submit" size="sm" tone="primary" disabled={!name.trim() || create.isPending}>{t("projects.create")}</Button>
        </form>
        {projects.isLoading ? <SkeletonRows /> : null}
        {!projects.isLoading && !projects.data?.length ? <p className="muted">{t("projects.empty")}</p> : null}
        {projects.data?.map((project) => (
          <button key={project.id} type="button" className="panel-head" onClick={() => go(`/projects/${project.id}`)}>
            <strong>{project.name}</strong>
            <Badge>{t("projects.open")}</Badge>
          </button>
        ))}
        {create.error ? <p className="bungalow-help bungalow-help--error">{create.error.message}</p> : null}
        {projects.error ? <p className="bungalow-help bungalow-help--error">{projects.error.message}</p> : null}
      </div>
    </Card>
  );
}

function ProjectDetails({ projectId, projectName, onBack }: { projectId: string; projectName: string; onBack: () => void }) {
  const { t } = useI18n();
  const [type, setType] = useState<ProjectResourceType>("agent");
  const [resourceId, setResourceId] = useState("");
  const agents = useProjectResourceOptions("agent");
  const conversations = useProjectResourceOptions("conversation");
  const workspaces = useProjectResourceOptions("workspace");
  const accounts = useProjectResourceOptions("account");
  const automations = useProjectResourceOptions("automation");
  const resources = useProjectResources(projectId);
  const add = useAddProjectResource(projectId);
  const remove = useRemoveProjectResource(projectId);
  const optionSets: Record<ProjectResourceType, { id: string; label: string }[]> = {
    agent: agents.data ?? [],
    conversation: conversations.data ?? [],
    workspace: workspaces.data ?? [],
    account: accounts.data ?? [],
    automation: automations.data ?? [],
  };
  const resourceOptions = optionSets[type];
  const optionsLoading = agents.isLoading || conversations.isLoading || workspaces.isLoading || accounts.isLoading || automations.isLoading;
  const displayName = (resourceType: ProjectResourceType, id: string) => {
    return optionSets[resourceType].find((option) => option.id === id)?.label ?? id;
  };

  return (
    <Card>
      <div className="stack">
        <div className="panel-head">
          <div>
            <Button size="sm" onClick={onBack}>{t("projects.back")}</Button>
            <h1 className="panel-title">{projectName}</h1>
          </div>
          <Badge>{t("projects.project")}</Badge>
        </div>
        <p className="muted">{t("projects.resourcesIntro")}</p>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          if (!resourceId) return;
          add.mutate({ type, resourceId }, { onSuccess: () => setResourceId("") });
        }}>
          <Select label={t("projects.resourceType")} value={type} onChange={(event) => { setType(event.target.value as ProjectResourceType); setResourceId(""); }}>
            {PROJECT_RESOURCE_TYPES.map((resourceType) => (
              <option key={resourceType} value={resourceType}>{t(`projects.resource.${resourceType}` as MessageKey)}</option>
            ))}
          </Select>
          <Select label={t("projects.resource")} value={resourceId} onChange={(event) => setResourceId(event.target.value)} disabled={optionsLoading}>
            <option value="">{t("projects.chooseResource")}</option>
            {resourceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
          <Button type="submit" size="sm" tone="primary" disabled={!resourceId || add.isPending}>{t("projects.connect")}</Button>
        </form>
        {resources.isLoading ? <SkeletonRows /> : null}
        {!resources.isLoading && !resources.data?.length ? <p className="muted">{t("projects.noResources")}</p> : null}
        {resources.data?.map((resource) => (
          <div className="panel-head" key={resource.id}>
            <div className="stack">
              <strong>{displayName(resource.resource_type, resource.resource_id)}</strong>
              <Badge>{t(`projects.resource.${resource.resource_type}` as MessageKey)}</Badge>
            </div>
            <Button size="sm" tone="danger" disabled={remove.isPending} onClick={() => remove.mutate(resource.id)}>{t("projects.disconnect")}</Button>
          </div>
        ))}
        {[agents.error, conversations.error, workspaces.error, accounts.error, automations.error].filter(Boolean).map((error) => <p className="bungalow-help bungalow-help--error" key={error!.message}>{error!.message}</p>)}
        {resources.error ? <p className="bungalow-help bungalow-help--error">{resources.error.message}</p> : null}
        {add.error ? <p className="bungalow-help bungalow-help--error">{add.error.message}</p> : null}
        {remove.error ? <p className="bungalow-help bungalow-help--error">{remove.error.message}</p> : null}
      </div>
    </Card>
  );
}
