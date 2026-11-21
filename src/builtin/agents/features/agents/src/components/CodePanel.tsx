import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Badge, Button, Card, Checkbox, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntityPicker, type EntityOption } from "../../../../../../entities/EntityPicker";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { entityKey, findByEntityKey } from "../../../../../../entities/slugs";
import { toEntityUri } from "../../../../../../entities/uri";
import { closeEditBackTo, useEntityModal, useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { PageNotFound } from "../../../../../../shell/PageNotFound";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import { useAiMcpServers } from "../../../../../ai/models/mcpServers";
import { CodeStart } from "./CodeStart";
import { useAgentConversations, useAgentMessages, useAgents, type Agent } from "../../../../models/agents";
import {
  GITHUB_MCP_URL,
  agentWorkspacesKey,
  codeRepositoriesKey,
  codeSandboxesKey,
  deleteCodeRow,
  setTryLive,
  useAgentWorkspaces,
  useCodeFunction,
  useCodeReleases,
  useCodeRepositories,
  useCodeSandboxes,
  useIsPlatformAdmin,
  usePublishRelease,
  useReviewRelease,
  useSaveRepository,
  useSaveSandbox,
  useSaveWorkspace,
  useTryLive,
  useWithdrawRelease,
  useWorkspaceRepositories,
  type AgentWorkspace,
  type CodeAppRelease,
  type CodeRepository,
  type CodeSandbox,
} from "../../../../models/code";
import { ensureAgentWorkspace, mentionedRepos, useKickstartWorkspace } from "../../../../models/ensure";
import { githubFullName } from "../../../../../../../supabase/functions/_shared/codeWorkspace.ts";

const TABS = ["workspaces", "repositories", "sandboxes", "apps"] as const;
type Tab = (typeof TABS)[number];

/**
 * Code (`/code`): what the user's AI agents code with. Tabs: workspaces (`/code/workspaces`, each at
 * `/code/workspaces/$workspace`: an agent conversation connected to repositories in a sandbox, its
 * live sandbox and its app releases with Publish), repositories (`/code/repositories`), sandboxes
 * (`/code/sandboxes`, OpenHands or Copilot runners) and apps (`/code/apps`: every release, and the public
 * ones admins review). Each has routed sheets at `…/new` and `…/$key/edit`.
 */
export function CodePanel() {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const parts = pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
  const tab: Tab = (TABS as readonly string[]).includes(parts[0] ?? "") ? (parts[0] as Tab) : "workspaces";
  const workspaceKey = tab === "workspaces" && parts[1] && parts[1] !== "new" && parts.length === 2 ? parts[1] : null;
  // The start page is /code itself: the vibe-coding window. The tabs' home is /code/workspaces.
  const startKey = !parts.length;

  return (
    <div className="stack">
      <div className="search-chips" role="tablist" aria-label={t("code.title")}>
        <button key="start" type="button" role="tab" aria-selected={startKey} className="search-chip" onClick={() => go("/code")}>
          {t("code.start.tab") as string}
        </button>
        {TABS.map((to) => (
          <button key={to} type="button" role="tab" aria-selected={!startKey && to === tab} className="search-chip" onClick={() => go(to === "workspaces" ? "/code/workspaces" : `/code/${to}`)}>
            {t(`code.tab.${to}` as MessageKey)}
          </button>
        ))}
      </div>
      {startKey ? <CodeStart /> : null}
      {!startKey && tab === "workspaces" ? (workspaceKey ? <WorkspaceView workspaceKey={workspaceKey} /> : <WorkspaceList />) : null}
      {!startKey && tab === "repositories" ? <RepositoryList /> : null}
      {!startKey && tab === "sandboxes" ? <SandboxList /> : null}
      {!startKey && tab === "apps" ? <ReleaseList /> : null}
    </div>
  );
}

function Loading() {
  const { t } = useI18n();
  return <p className="stat-label">{t("app.loading")}</p>;
}

function ErrorText({ error }: { error: Error | null | undefined }) {
  return error ? <p className="bungalow-help bungalow-help--error">{error.message}</p> : null;
}

const statusTone = (status: string) => (status === "ready" || status === "published" || status === "approved" ? "success" : status === "error" || status === "rejected" ? "danger" : "default");

// ── Workspaces ──────────────────────────────────────────────────────────────────────────────

function WorkspaceList() {
  const { t, intlLocale } = useI18n();
  const go = useNavigateKeepingSearch();
  const modal = useEntityModal("/code/workspaces", "/code");
  const workspaces = useAgentWorkspaces();
  const agents = useAgents().data ?? [];
  const rows = workspaces.data ?? [];
  const editing = modal.mode === "edit" ? findByEntityKey(rows, modal.id) : undefined;
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteCodeRow("agent_workspaces", id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: agentWorkspacesKey }),
  });
  return (
    <Card>
      <div className="stack">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{t("code.workspaces.title")}</h2>
            <p className="muted">{t("code.workspaces.intro")}</p>
          </div>
          <Button size="sm" tone="primary" onClick={modal.openNew} data-tour="create-agent-workspace">
            {t("code.workspaces.add")}
          </Button>
        </div>
        {rows.length === 0 ? (
          workspaces.isLoading ? (
            <Loading />
          ) : (
            <EmptyState items={t("code.workspaces.items")} actionLabel={t("code.workspaces.add")} onAction={modal.openNew} />
          )
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("code.workspaces.name")}</th>
                  <th>{t("code.workspaces.agent")}</th>
                  <th>{t("code.status")}</th>
                  <th>{t("code.workspaces.lastUsed")}</th>
                  <th className="action-row-cell" aria-label={t("agents.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((ws) => (
                  <tr key={ws.id} className="action-row clickable-row" onClick={() => go(`/code/workspaces/${entityKey(ws)}`)}>
                    <td className="wrap">{ws.title || t("code.workspaces.untitled")}</td>
                    <td className="wrap">{agents.find((a) => a.id === ws.agent_id)?.name ?? "—"}</td>
                    <td>
                      <Badge tone={statusTone(ws.status)}>{t(`code.workspaceStatus.${ws.status}` as MessageKey)}</Badge>
                      {ws.sandbox_url ? <Badge tone="info">{t("code.live")}</Badge> : null}
                    </td>
                    <td className="wrap">{ws.last_used_at ? new Date(ws.last_used_at).toLocaleString(intlLocale, { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                    <td className="action-row-cell" onClick={(e) => e.stopPropagation()}>
                      <ActionMenu
                        name={ws.title || t("code.workspaces.untitled")}
                        uri={toEntityUri("agent_workspace", ws.id)}
                        actions={[
                          { key: "open", label: t("actions.open"), onSelect: () => go(`/code/workspaces/${entityKey(ws)}`) },
                          { key: "edit", label: t("actions.edit"), onSelect: () => modal.openEdit(entityKey(ws)) },
                          {
                            key: "delete",
                            label: t("actions.delete"),
                            tone: "danger" as const,
                            onSelect: () => window.confirm(t("code.workspaces.confirmDelete")) && remove.mutate(ws.id),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorText error={remove.error} />
      </div>
      {modal.mode === "new" || editing ? (
        <WorkspaceSheet key={editing?.id ?? "new"} workspace={editing} agents={agents} onClose={modal.close} onSaved={(ws) => go(`/code/workspaces/${entityKey(ws)}`)} />
      ) : null}
    </Card>
  );
}

/** The bar over an agent conversation: its workspace, or a button that creates and prepares one. */
export function AgentCodeBar({ agent, conversationId }: { agent: Agent; conversationId: string }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const workspaces = useAgentWorkspaces();
  const workspace = (workspaces.data ?? []).find((w) => w.conversation_id === conversationId);
  const repos = useWorkspaceRepositories(workspace?.id ?? null).data ?? [];
  const ensure = useKickstartWorkspace();
  const messages = useAgentMessages(conversationId);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (workspaces.isLoading) return null;
  if (!workspace) {
    const ask = () =>
      // The conversation's latest messages name what to work on: their owner/name mentions
      // are the repositories, and the workspace is made and prepared with them at once.
      ensure.mutate({
        conversationId,
        agentId: agent.id,
        repositoryUrls: mentionedRepos((messages.data ?? []).slice(-5).map((m) => m.content).join("\n")),
      });
    return (
      <div className="agent-code-bar">
        <Button size="sm" variant="ghost" loading={ensure.isPending} disabled={agent.status === "fired"} onClick={ask} data-tour="connect-workspace">
          {t("code.bar.connect")}
        </Button>
        <ErrorText error={ensure.error} />
      </div>
    );
  }
  return (
    <div className="agent-code-bar">
      <button type="button" className="agent-code-bar__link" onClick={() => go(`/code/workspaces/${entityKey(workspace)}`)}>
        <span className="agent-code-bar__kind">{t("code.bar.workspace")}</span>
        <span>{workspace.title || t("code.workspaces.untitled")}</span>
        <span className="muted"> · {t("code.bar.repositories", { count: repos.length })}</span>
        {workspace.sandbox_url ? <Badge tone="info">{t("code.live")}</Badge> : null}
      </button>
    </div>
  );
}

function WorkspaceSheet({ workspace, agents, onClose, onSaved }: { workspace?: AgentWorkspace; agents: Agent[]; onClose: () => void; onSaved: (ws: AgentWorkspace) => void }) {
  const { t } = useI18n();
  const repos = useCodeRepositories().data ?? [];
  const sandboxes = useCodeSandboxes().data ?? [];
  const links = useWorkspaceRepositories(workspace?.id ?? null);
  const [title, setTitle] = useState(workspace?.title ?? "");
  const [agentId, setAgentId] = useState<string | null>(workspace?.agent_id ?? null);
  const [conversationId, setConversationId] = useState<string | null>(workspace?.conversation_id ?? null);
  const [sandboxId, setSandboxId] = useState<string>(workspace?.sandbox_id ?? "");
  const [repoIds, setRepoIds] = useState<string[] | null>(workspace ? null : []);
  const chosenRepos = repoIds ?? (links.data ?? []).map((l) => l.repository_id);
  const conversations = useAgentConversations(agentId).data ?? [];
  const save = useSaveWorkspace();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteCodeRow("agent_workspaces", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentWorkspacesKey });
      onClose();
    },
  });
  const repoOptions: EntityOption[] = repos.map((r) => ({ type: "code_repository", id: r.id, title: r.full_name ?? r.name, subtitle: r.description }));
  const agentOptions: EntityOption[] = agents.map((a) => ({ type: "agent", id: a.id, title: a.name, subtitle: `@${a.username}` }));
  const agent = agents.find((a) => a.id === agentId);
  const sandbox = sandboxes.find((s) => s.id === sandboxId);
  const conversationLabel = (c: { title: string | null; is_main: boolean; with_kind: string }) => c.title || (c.is_main ? t("code.workspaces.mainConversation") : t(`code.with.${c.with_kind}` as MessageKey));

  return (
    <EntitySheet
      title={workspace ? workspace.title || t("code.workspaces.untitled") : t("code.workspaces.add")}
      subtitle={t("code.workspaces.kind")}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      uri={workspace ? toEntityUri("agent_workspace", workspace.id) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          { id: workspace?.id, values: { title: title.trim() || null, agent_id: agentId, conversation_id: agentId ? conversationId : null, sandbox_id: sandboxId || null }, repositoryIds: chosenRepos },
          { onSuccess: onSaved },
        );
      }}
      footer={
        <FormActions
          onDelete={workspace ? () => window.confirm(t("code.workspaces.confirmDelete")) && remove.mutate(workspace.id) : undefined}
          deleteLabel={t("actions.delete")}
          deleting={remove.isPending}
          onCancel={workspace ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={workspace ? t("form.save") : t("code.workspaces.create")}
          saving={save.isPending}
        />
      }
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{t("code.workspaces.kind")}</div>
          <div className="entity-preview__label">{title.trim() || t("code.workspaces.untitled")}</div>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("code.workspaces.agent")}</dt>
              <dd>{agent?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("code.workspaces.sandbox")}</dt>
              <dd>{sandbox?.name ?? t("code.workspaces.serverSandbox")}</dd>
            </div>
            <div>
              <dt>{t("code.tab.repositories")}</dt>
              <dd>{chosenRepos.map((id) => repos.find((r) => r.id === id)?.full_name ?? repos.find((r) => r.id === id)?.name).filter(Boolean).join(", ") || "—"}</dd>
            </div>
          </dl>
        </div>
      }
    >
      <div className="stack">
        <Input label={t("code.workspaces.name")} maxLength={200} value={title} placeholder={t("code.workspaces.namePlaceholder")} onChange={(e) => setTitle(e.target.value)} autoFocus={!workspace} />
        <EntityPicker
          label={t("code.workspaces.agent")}
          types={["agent"]}
          options={agentOptions}
          value={agentId}
          onChange={(value) => {
            setAgentId(value);
            setConversationId(null);
          }}
        />
        {agentId ? (
          <Select label={t("code.workspaces.conversation")} value={conversationId ?? ""} onChange={(e) => setConversationId(e.target.value || null)} hint={t("code.workspaces.conversationHint")}>
            <option value="">{t("code.workspaces.noConversation")}</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {conversationLabel(c)}
              </option>
            ))}
          </Select>
        ) : null}
        <EntityPicker
          label={t("code.tab.repositories")}
          multiple
          types={["code_repository"]}
          options={repoOptions}
          value={chosenRepos}
          onChange={(value) => setRepoIds(value)}
          hint={t("code.workspaces.repositoriesHint")}
        />
        <Select label={t("code.workspaces.sandbox")} value={sandboxId} onChange={(e) => setSandboxId(e.target.value)} hint={t("code.workspaces.sandboxHint")}>
          <option value="">{t("code.workspaces.serverSandbox")}</option>
          {sandboxes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <ErrorText error={save.error} />
        <ErrorText error={remove.error} />
      </div>
    </EntitySheet>
  );
}

function WorkspaceView({ workspaceKey }: { workspaceKey: string }) {
  const { t, intlLocale } = useI18n();
  const go = useNavigateKeepingSearch();
  const workspaces = useAgentWorkspaces();
  const workspace = findByEntityKey(workspaces.data ?? [], workspaceKey);
  const agents = useAgents().data ?? [];
  const repos = useCodeRepositories().data ?? [];
  const links = useWorkspaceRepositories(workspace?.id ?? null).data ?? [];
  const releases = (useCodeReleases().data ?? []).filter((r) => r.workspace_id === workspace?.id);
  const setup = useCodeFunction<{ repositories: { repository: string; cloned: boolean; output?: string }[] }>("code_setup_workspace");
  const stop = useCodeFunction("code_stop_sandbox");
  const tryLive = useTryLive();
  if (!workspace) return workspaces.isLoading ? <Loading /> : <PageNotFound />;
  const agent = agents.find((a) => a.id === workspace.agent_id);
  const live = tryLive.includes(workspace.id);
  const edit = () => {
    closeEditBackTo(`/code/workspaces/${entityKey(workspace)}/edit`, `/code/workspaces/${entityKey(workspace)}`);
    go(`/code/workspaces/${entityKey(workspace)}/edit`);
  };
  const chat = agent && workspace.conversation_id ? `/agents/${entityKey(agent)}/conversations/${workspace.conversation_id}` : null;
  return (
    <>
      <Card>
        <div className="stack">
          <div className="panel-head">
            <div>
              <div className="entity-preview__kind">{t("code.workspaces.kind")}</div>
              <h2 className="panel-title">{workspace.title || t("code.workspaces.untitled")}</h2>
              <p className="muted">
                {agent ? t("code.workspaces.with", { name: agent.name }) : t("code.workspaces.noAgent")}
                {workspace.root_path ? ` · ${workspace.root_path}` : ""}
              </p>
            </div>
            <div className="row-actions">
              <Button size="sm" variant="outline" onClick={edit}>
                {t("actions.edit")}
              </Button>
              <Button size="sm" variant="outline" disabled={setup.isPending} onClick={() => setup.mutate({ workspace: workspace.id })}>
                {setup.isPending ? t("code.workspaces.settingUp") : t("code.workspaces.setUp")}
              </Button>
              {chat ? (
                <Button size="sm" tone="primary" onClick={() => go(chat)}>
                  {t("code.workspaces.openChat")}
                </Button>
              ) : null}
            </div>
          </div>
          <div>
            <Badge tone={statusTone(workspace.status)}>{t(`code.workspaceStatus.${workspace.status}` as MessageKey)}</Badge>
            {workspace.error ? <span className="bungalow-help bungalow-help--error"> {workspace.error}</span> : null}
          </div>
          <ErrorText error={setup.error} />
          {setup.data ? (
            <ul className="code-setup-result">
              {setup.data.repositories.map((r) => (
                <li key={r.repository}>
                  {r.repository}: {r.cloned ? t("code.workspaces.cloned") : t("code.workspaces.notCloned")}
                  {r.output ? <pre className="code-output">{r.output}</pre> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <h3 className="section-title">{t("code.tab.repositories")}</h3>
          {links.length === 0 ? (
            <EmptyState items={t("code.repositories.items")} actionLabel={t("code.workspaces.connectRepositories")} onAction={edit} />
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("code.repositories.name")}</th>
                    <th>{t("code.repositories.branch")}</th>
                    <th>{t("code.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => {
                    const repo = repos.find((r) => r.id === link.repository_id);
                    return (
                      <tr key={link.repository_id} className="action-row">
                        <td className="wrap">{repo ? (repo.full_name ?? repo.name) : "—"}</td>
                        <td className="wrap">{link.branch ?? repo?.default_branch ?? "—"}</td>
                        <td>{link.cloned_at ? <Badge tone="success">{t("code.workspaces.cloned")}</Badge> : <Badge>{t("code.workspaces.notCloned")}</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="stack">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">{t("code.sandbox.title")}</h3>
              <p className="muted">{workspace.sandbox_url ? t("code.sandbox.running", { url: workspace.sandbox_url, path: workspace.sandbox_app_path ?? "" }) : t("code.sandbox.stopped")}</p>
            </div>
            {workspace.sandbox_url ? (
              <div className="row-actions">
                <Button size="sm" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate({ workspace: workspace.id })}>
                  {t("code.sandbox.stop")}
                </Button>
                <Button size="sm" tone="primary" onClick={() => setTryLive(workspace.id, !live)}>
                  {live ? t("code.sandbox.tryLiveOff") : t("code.sandbox.tryLive")}
                </Button>
              </div>
            ) : null}
          </div>
          {live && workspace.sandbox_url ? <p className="muted">{t("code.sandbox.liveHint")}</p> : null}
          <ErrorText error={stop.error} />
        </div>
      </Card>

      <Card>
        <div className="stack">
          <div>
            <h3 className="panel-title">{t("code.releases.title")}</h3>
            <p className="muted">{t("code.releases.intro")}</p>
          </div>
          <ReleaseTable releases={releases} intlLocale={intlLocale} />
        </div>
      </Card>
    </>
  );
}

// ── Releases and the registry ───────────────────────────────────────────────────────────────

function ReleaseTable({ releases, intlLocale, review }: { releases: CodeAppRelease[]; intlLocale: string; review?: boolean }) {
  const { t } = useI18n();
  const publish = usePublishRelease();
  const withdraw = useWithdrawRelease();
  const reviewIt = useReviewRelease();
  if (!releases.length) return <EmptyState items={t("code.releases.items")} description={t("code.releases.empty")} />;
  return (
    <>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("code.releases.app")}</th>
              <th>{t("code.releases.version")}</th>
              <th>{t("code.status")}</th>
              <th>{t("code.releases.created")}</th>
              <th className="action-row-cell" aria-label={t("agents.actions")} />
            </tr>
          </thead>
          <tbody>
            {releases.map((r) => (
              <tr key={r.id} className="action-row">
                <td className="wrap">
                  {r.name} <span className="muted">({r.app_id})</span>
                </td>
                <td>{r.version}</td>
                <td className="wrap">
                  <Badge tone={statusTone(r.status)}>{t(`code.releaseStatus.${r.status}` as MessageKey)}</Badge>
                  {r.visibility === "public" ? <Badge tone={statusTone(r.review_status)}>{t(`code.review.${r.review_status}` as MessageKey)}</Badge> : null}
                </td>
                <td className="wrap">{new Date(r.created_at).toLocaleString(intlLocale, { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={`${r.name} ${r.version}`}
                    actions={[
                      ...(r.status === "ready" || r.status === "withdrawn"
                        ? [
                            { key: "publish", label: t("code.releases.publish"), aspects: ["share" as const], onSelect: () => publish.mutate({ id: r.id, publicly: false }) },
                            { key: "publish-public", label: t("code.releases.publishPublic"), aspects: ["share" as const], onSelect: () => publish.mutate({ id: r.id, publicly: true }) },
                          ]
                        : []),
                      ...(r.status === "published" ? [{ key: "withdraw", label: t("code.releases.withdraw"), tone: "danger" as const, onSelect: () => withdraw.mutate(r.id) }] : []),
                      ...(review && r.visibility === "public" && r.review_status === "pending"
                        ? [
                            { key: "approve", label: t("code.releases.approve"), aspects: ["configure" as const], onSelect: () => reviewIt.mutate({ id: r.id, approve: true }) },
                            {
                              key: "reject",
                              label: t("code.releases.reject"),
                              tone: "danger" as const,
                              aspects: ["configure" as const],
                              onSelect: () => reviewIt.mutate({ id: r.id, approve: false, note: window.prompt(t("code.releases.rejectWhy")) }),
                            },
                          ]
                        : []),
                    ]}
                  />
                  {r.status === "ready" ? (
                    <Button size="sm" tone="primary" disabled={publish.isPending} onClick={() => publish.mutate({ id: r.id, publicly: false })}>
                      {t("code.releases.publish")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorText error={publish.error ?? withdraw.error ?? reviewIt.error} />
    </>
  );
}

function ReleaseList() {
  const { t, intlLocale } = useI18n();
  const releases = useCodeReleases();
  const admin = useIsPlatformAdmin().data === true;
  const all = releases.data ?? [];
  return (
    <Card>
      <div className="stack">
        <div>
          <h2 className="panel-title">{t("code.releases.registry")}</h2>
          <p className="muted">{t("code.releases.registryIntro")}</p>
        </div>
        {releases.isLoading ? <Loading /> : <ReleaseTable releases={all} intlLocale={intlLocale} review={admin} />}
      </div>
    </Card>
  );
}

// ── Repositories ────────────────────────────────────────────────────────────────────────────

function RepositoryList() {
  const { t } = useI18n();
  const modal = useEntityModal("/code/repositories");
  const repos = useCodeRepositories();
  const rows = repos.data ?? [];
  const editing = modal.mode === "edit" ? findByEntityKey(rows, modal.id) : undefined;
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteCodeRow("code_repositories", id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: codeRepositoriesKey }),
  });
  return (
    <Card>
      <div className="stack">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{t("code.repositories.title")}</h2>
            <p className="muted">{t("code.repositories.intro")}</p>
          </div>
          <Button size="sm" tone="primary" onClick={modal.openNew}>
            {t("code.repositories.add")}
          </Button>
        </div>
        <GitHubConnection />
        {rows.length === 0 ? (
          repos.isLoading ? (
            <Loading />
          ) : (
            <EmptyState items={t("code.repositories.items")} actionLabel={t("code.repositories.add")} onAction={modal.openNew} />
          )
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("code.repositories.name")}</th>
                  <th>{t("code.repositories.branch")}</th>
                  <th>{t("code.repositories.description")}</th>
                  <th className="action-row-cell" aria-label={t("agents.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((repo) => (
                  <tr key={repo.id} className="action-row">
                    <td className="wrap">{repo.full_name ?? repo.name}</td>
                    <td>{repo.default_branch ?? "—"}</td>
                    <td className="wrap">{repo.description ?? ""}</td>
                    <td className="action-row-cell">
                      <ActionMenu
                        name={repo.full_name ?? repo.name}
                        uri={toEntityUri("code_repository", repo.id)}
                        actions={[
                          ...(repo.html_url ? [{ key: "open", label: t("code.repositories.openOnGitHub"), onSelect: () => window.open(repo.html_url!, "_blank", "noopener") }] : []),
                          { key: "edit", label: t("actions.edit"), onSelect: () => modal.openEdit(entityKey(repo)) },
                          { key: "delete", label: t("actions.delete"), tone: "danger" as const, onSelect: () => window.confirm(t("code.repositories.confirmDelete")) && remove.mutate(repo.id) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorText error={remove.error} />
      </div>
      {modal.mode === "new" || editing ? <RepositorySheet key={editing?.id ?? "new"} repository={editing} onClose={modal.close} /> : null}
    </Card>
  );
}

/** Whether the user has the GitHub MCP server (their GitHub connection), with a way to add it. */
function GitHubConnection() {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const servers = useAiMcpServers().data ?? [];
  const github = servers.find((s) => /github/i.test(s.url));
  return (
    <div className="code-github">
      {github ? (
        <p className="muted">{t("code.github.connected", { name: github.name })}</p>
      ) : (
        <>
          <p className="muted">{t("code.github.missing", { url: GITHUB_MCP_URL })}</p>
          <Button size="sm" variant="outline" onClick={() => go("/ai-models/mcp/new")}>
            {t("code.github.connect")}
          </Button>
        </>
      )}
    </div>
  );
}

function RepositorySheet({ repository, onClose }: { repository?: CodeRepository; onClose: () => void }) {
  const { t } = useI18n();
  const servers = (useAiMcpServers().data ?? []).filter((s) => /github/i.test(s.url));
  const [address, setAddress] = useState(repository?.html_url ?? repository?.clone_url ?? "");
  const [branch, setBranch] = useState(repository?.default_branch ?? "main");
  const [description, setDescription] = useState(repository?.description ?? "");
  const [serverId, setServerId] = useState(repository?.github_server_id ?? servers[0]?.id ?? "");
  const save = useSaveRepository();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteCodeRow("code_repositories", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: codeRepositoriesKey });
      onClose();
    },
  });
  const trimmed = address.trim();
  const fullName = githubFullName(trimmed) ?? (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null);
  const isGit = !fullName && /^(https:\/\/|git@)\S+$/.test(trimmed);
  const valid = !!fullName || isGit;
  const name = fullName ? fullName.split("/")[1] : (trimmed.split("/").pop() ?? "").replace(/\.git$/, "");
  return (
    <EntitySheet
      title={repository ? (repository.full_name ?? repository.name) : t("code.repositories.add")}
      subtitle={t("code.repositories.kind")}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      uri={repository ? toEntityUri("code_repository", repository.id) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        save.mutate(
          {
            id: repository?.id,
            values: {
              name,
              full_name: fullName,
              provider: fullName ? "github" : "git",
              clone_url: fullName ? `https://github.com/${fullName}.git` : trimmed,
              html_url: fullName ? `https://github.com/${fullName}` : null,
              default_branch: branch.trim() || null,
              description: description.trim() || null,
              github_server_id: fullName ? serverId || null : null,
            },
          },
          { onSuccess: onClose },
        );
      }}
      footer={
        <FormActions
          onDelete={repository ? () => window.confirm(t("code.repositories.confirmDelete")) && remove.mutate(repository.id) : undefined}
          deleteLabel={t("actions.delete")}
          deleting={remove.isPending}
          onCancel={repository ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={repository ? t("form.save") : t("code.repositories.create")}
          saving={save.isPending}
          submitDisabled={!valid}
        />
      }
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{t("code.repositories.kind")}</div>
          <div className="entity-preview__label">{fullName ?? (name || t("code.repositories.namePlaceholder"))}</div>
          {description.trim() ? <p className="entity-preview__note">{description.trim()}</p> : null}
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("code.repositories.branch")}</dt>
              <dd>{branch.trim() || "—"}</dd>
            </div>
            <div>
              <dt>{t("code.repositories.connection")}</dt>
              <dd>{fullName ? (servers.find((s) => s.id === serverId)?.name ?? t("code.repositories.publicOnly")) : t("code.repositories.plainGit")}</dd>
            </div>
          </dl>
        </div>
      }
    >
      <div className="stack">
        <Input label={t("code.repositories.address")} required autoFocus={!repository} value={address} placeholder="owner/name, https://github.com/owner/name" onChange={(e) => setAddress(e.target.value)} hint={t("code.repositories.addressHint")} />
        <Input label={t("code.repositories.branch")} maxLength={200} value={branch} onChange={(e) => setBranch(e.target.value)} />
        <Input label={t("code.repositories.description")} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        {fullName ? (
          <Select label={t("code.repositories.connection")} value={serverId} onChange={(e) => setServerId(e.target.value)} hint={t("code.repositories.connectionHint")}>
            <option value="">{t("code.repositories.publicOnly")}</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        ) : null}
        <ErrorText error={save.error} />
        <ErrorText error={remove.error} />
      </div>
    </EntitySheet>
  );
}

// ── Sandboxes ───────────────────────────────────────────────────────────────────────────────

function SandboxList() {
  const { t } = useI18n();
  const modal = useEntityModal("/code/sandboxes");
  const sandboxes = useCodeSandboxes();
  const rows = sandboxes.data ?? [];
  const editing = modal.mode === "edit" ? findByEntityKey(rows, modal.id) : undefined;
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteCodeRow("code_sandboxes", id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: codeSandboxesKey }),
  });
  return (
    <Card>
      <div className="stack">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{t("code.sandboxes.title")}</h2>
            <p className="muted">{t("code.sandboxes.intro")}</p>
          </div>
          <Button size="sm" tone="primary" onClick={modal.openNew}>
            {t("code.sandboxes.add")}
          </Button>
        </div>
        {rows.length === 0 ? (
          sandboxes.isLoading ? (
            <Loading />
          ) : (
            <EmptyState items={t("code.sandboxes.items")} actionLabel={t("code.sandboxes.add")} onAction={modal.openNew} />
          )
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("code.sandboxes.name")}</th>
                  <th>{t("code.sandboxes.url")}</th>
                  <th>{t("code.status")}</th>
                  <th className="action-row-cell" aria-label={t("agents.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="action-row">
                    <td className="wrap">{s.name}</td>
                    <td className="wrap">{s.url}<br /><Badge>{t(s.provider === "copilot" ? "code.sandboxes.copilot" : "code.sandboxes.openHands")}</Badge></td>
                    <td>
                      <Badge tone={s.enabled ? "success" : "default"}>{s.enabled ? t("code.sandboxes.on") : t("code.sandboxes.off")}</Badge>
                      {s.has_key ? null : <Badge tone="warning">{t("code.sandboxes.noKey")}</Badge>}
                    </td>
                    <td className="action-row-cell">
                      <ActionMenu
                        name={s.name}
                        uri={toEntityUri("code_sandbox", s.id)}
                        actions={[
                          { key: "edit", label: t("actions.edit"), onSelect: () => modal.openEdit(entityKey(s)) },
                          { key: "delete", label: t("actions.delete"), tone: "danger" as const, onSelect: () => window.confirm(t("code.sandboxes.confirmDelete")) && remove.mutate(s.id) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorText error={remove.error} />
      </div>
      {modal.mode === "new" || editing ? <SandboxSheet key={editing?.id ?? "new"} sandbox={editing} onClose={modal.close} /> : null}
    </Card>
  );
}

function SandboxSheet({ sandbox, onClose }: { sandbox?: CodeSandbox; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(sandbox?.name ?? "OpenHands");
  const [provider, setProvider] = useState<CodeSandbox["provider"]>(sandbox?.provider ?? "openhands");
  const [url, setUrl] = useState(sandbox?.url ?? "");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(sandbox?.preview_url ?? "");
  const [ports, setPorts] = useState(sandbox?.preview_ports ?? "5180-5199");
  const [root, setRoot] = useState(sandbox?.workspace_root ?? "/workspace");
  const [enabled, setEnabled] = useState(sandbox?.enabled ?? true);
  const save = useSaveSandbox();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteCodeRow("code_sandboxes", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: codeSandboxesKey });
      onClose();
    },
  });
  const validUrl = /^https?:\/\/[^\s/?#]+/i.test(url.trim());
  const validPreview = !previewUrl.trim() || (/^https?:\/\/\S+$/i.test(previewUrl.trim()) && previewUrl.includes("{port}"));
  const validPorts = !ports.trim() || /^\d{2,5}(\s*-\s*\d{2,5})?$/.test(ports.trim());
  const docker = provider === "openhands"
    ? `docker run -d --name openhands-sandbox -p 8000:8000 -p ${ports.trim() || "5180-5199"}:${ports.trim() || "5180-5199"} -e OH_SESSION_API_KEYS_0=<key> ghcr.io/openhands/agent-server:latest-python`
    : `docker run -d --name copilot-runner -p 8000:8000 -p ${ports.trim() || "5180-5199"}:${ports.trim() || "5180-5199"} -v gondol-workspaces:/workspace -e COPILOT_RUNNER_TOKEN=<key> -e COPILOT_ALLOW_ALL=true ghcr.io/drsounds/gondol-copilot-runner:latest`;
  return (
    <EntitySheet
      title={sandbox ? sandbox.name : t("code.sandboxes.add")}
      subtitle={t("code.sandboxes.kind")}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      uri={sandbox ? toEntityUri("code_sandbox", sandbox.id) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            id: sandbox?.id,
            values: { name: name.trim(), provider, url: url.trim().replace(/\/+$/, ""), preview_url: previewUrl.trim() || null, preview_ports: ports.trim() || null, workspace_root: root.trim() || null, enabled },
            apiKey: clearKey ? null : key.trim() ? key.trim() : undefined,
          },
          { onSuccess: onClose },
        );
      }}
      footer={
        <FormActions
          onDelete={sandbox ? () => window.confirm(t("code.sandboxes.confirmDelete")) && remove.mutate(sandbox.id) : undefined}
          deleteLabel={t("actions.delete")}
          deleting={remove.isPending}
          onCancel={sandbox ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={sandbox ? t("form.save") : t("code.sandboxes.create")}
          saving={save.isPending}
          submitDisabled={!name.trim() || !validUrl || !validPreview || !validPorts}
        />
      }
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{t("code.sandboxes.kind")}</div>
          <div className="entity-preview__label">{name.trim() || "OpenHands"}</div>
          <p className="entity-preview__note">{t("code.sandboxes.dockerHint")}</p>
          <pre className="code-output">{docker}</pre>
        </div>
      }
    >
      <div className="stack">
        <Input label={t("code.sandboxes.name")} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <Select label={t("code.sandboxes.provider")} value={provider} onChange={(e) => setProvider(e.target.value as CodeSandbox["provider"])}>
          <option value="openhands">{t("code.sandboxes.openHands")}</option>
          <option value="copilot">{t("code.sandboxes.copilot")}</option>
        </Select>
        <Input label={t("code.sandboxes.url")} required value={url} placeholder={provider === "openhands" ? "https://openhands.example.com" : "https://copilot.example.com"} onChange={(e) => setUrl(e.target.value)} hint={t("code.sandboxes.urlHint")} />
        <Input
          label={t(provider === "openhands" ? "code.sandboxes.key" : "code.sandboxes.runnerKey")}
          type="password"
          autoComplete="off"
          value={key}
          placeholder={sandbox?.has_key ? t("code.sandboxes.keySaved") : ""}
          onChange={(e) => setKey(e.target.value)}
          hint={t(provider === "openhands" ? "code.sandboxes.keyHint" : "code.sandboxes.runnerKeyHint")}
        />
        {sandbox?.has_key ? <Checkbox label={t("code.sandboxes.clearKey")} checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> : null}
        <div className="form-grid">
          <Input label={t("code.sandboxes.previewUrl")} value={previewUrl} placeholder="https://{port}.sandbox.example.com" onChange={(e) => setPreviewUrl(e.target.value)} hint={t("code.sandboxes.previewUrlHint")} />
          <Input label={t("code.sandboxes.ports")} value={ports} onChange={(e) => setPorts(e.target.value)} hint={t("code.sandboxes.portsHint")} />
        </div>
        <Input label={t("code.sandboxes.root")} value={root} onChange={(e) => setRoot(e.target.value)} hint={t("code.sandboxes.rootHint")} />
        <Checkbox label={t("code.sandboxes.enabled")} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <ErrorText error={save.error} />
        <ErrorText error={remove.error} />
      </div>
    </EntitySheet>
  );
}

export function CodePage(): ReactNode {
  return <CodePanel />;
}
