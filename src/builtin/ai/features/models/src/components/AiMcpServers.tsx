import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Input } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { useEntityModal, useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { useRegisteredBundles } from "../../../../../../apps/hooks";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { HEADER_NAME, mcpServerAppId, useAiMcpServers, useDeleteAiMcpServer, useSaveAiMcpServer, type AiMcpServer } from "../../../../models";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

/**
 * The user's own MCP servers (`ai_mcp_servers`), listed on `/ai-models` under the services: their
 * tools join the apps' in the chat and the agents'. `/ai-models/mcp/new` and
 * `/ai-models/mcp/<id>/edit` are the routed sheets; they close back to `/ai-models`. The Service
 * Finder's "Installed" page shows the same list under its own paths (`listPath`, `closePath`), and
 * when that app is on, "Find servers" opens it.
 */
export function AiMcpServersSection({
  listPath = "/ai-models/mcp",
  closePath = "/ai-models",
  title,
  intro,
}: {
  listPath?: string;
  closePath?: string;
  title?: string;
  intro?: string;
} = {}) {
  const { t } = useI18n();
  const servers = useAiMcpServers();
  const rows = servers.data ?? [];
  const modal = useEntityModal(listPath, closePath);
  const go = useNavigateKeepingSearch();
  const finderOn = useRegisteredBundles().some((app) => app.id === "service-finder" && app.isActive);
  const editing = modal.mode === "edit" ? rows.find((row) => row.id === modal.id) : undefined;
  const save = useSaveAiMcpServer();
  const remove = useDeleteAiMcpServer();

  function deleteServer(row: AiMcpServer) {
    if (!window.confirm(t("ai.mcp.confirmDelete", { name: row.name }))) return;
    remove.mutate(row.id, { onSuccess: () => (modal.mode === "edit" ? modal.close() : undefined) });
  }

  return (
    <section className="stack ai-mcp">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{title ?? t("ai.mcp.title")}</h2>
          <p className="muted">{intro ?? t("ai.mcp.intro")}</p>
        </div>
        <div className="row-actions">
          {finderOn ? (
            <Button size="sm" variant="outline" onClick={() => go("/service-finder")}>
              {t("ai.mcp.find")}
            </Button>
          ) : null}
          <Button size="sm" tone="primary" onClick={modal.openNew}>
            {t("ai.mcp.new")}
          </Button>
        </div>
      </div>

      {servers.error ? <Alert tone="danger">{errorText(servers.error)}</Alert> : null}
      {remove.error ? <Alert tone="danger">{errorText(remove.error)}</Alert> : null}

      {servers.isLoading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          items={t("ai.mcp.items")}
          actionLabel={finderOn ? t("ai.mcp.find") : t("ai.mcp.new")}
          onAction={finderOn ? () => go("/service-finder") : modal.openNew}
        />
      ) : (
        <table className="data-table ai-mcp__table">
          <thead>
            <tr>
              <th>{t("ai.mcp.name")}</th>
              <th>{t("ai.mcp.url")}</th>
              <th>{t("ai.mcp.from")}</th>
              <th>{t("ai.mcp.headers")}</th>
              <th>{t("ai.services.status")}</th>
              <th className="action-row-cell" aria-label={t("ai.services.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="action-row">
                <td>
                  <span className="ai-mcp__name">
                    {row.icon_url ? <img className="ai-mcp__icon" src={row.icon_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                    {row.name}
                  </span>
                </td>
                <td className="muted ai-services__address">{row.url}</td>
                <td className="muted">
                  {row.registry_server ? [row.registry_server, row.registry_version ? `v${row.registry_version}` : ""].filter(Boolean).join(" · ") : t("ai.mcp.byHand")}
                </td>
                <td className="muted">{row.header_names.length ? row.header_names.join(", ") : "—"}</td>
                <td className="muted">{row.enabled ? t("ai.services.on") : t("ai.services.off")}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={row.name}
                    actions={[
                      { key: "edit", label: t("ai.services.edit"), onSelect: () => modal.openEdit(row.id) },
                      ...(row.registry_server && finderOn
                        ? [{ key: "open", label: t("ai.mcp.inFinder"), onSelect: () => go(finderServerPath(row.registry_server!)) }]
                        : []),
                      ...(row.website_url ? [{ key: "website", label: t("ai.mcp.website"), onSelect: () => void window.open(row.website_url!, "_blank", "noopener") }] : []),
                      {
                        key: "toggle",
                        label: row.enabled ? t("ai.services.turnOff") : t("ai.services.turnOn"),
                        aspects: ["configure"],
                        onSelect: () => save.mutate({ id: row.id, enabled: !row.enabled }),
                      },
                      { key: "delete", label: t("ai.services.delete"), tone: "danger", onSelect: () => deleteServer(row) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal.mode === "new" ? <McpServerSheet position={rows.length} onClose={modal.close} /> : null}
      {modal.mode === "edit" && editing ? (
        <McpServerSheet server={editing} onClose={modal.close} onDelete={() => deleteServer(editing)} deleting={remove.isPending} />
      ) : null}
    </section>
  );
}

/** The Service Finder's page for a server (as its serverPath()), without importing that app. */
const finderServerPath = (name: string) => `/service-finder/servers/${name.split("/").map(encodeURIComponent).join("/")}`;

/** A header row in the sheet: a saved one (value hidden; a new value replaces it) or a new one. */
type HeaderRow = { key: number; name: string; value: string; saved: boolean; remove: boolean };

interface ServerValues {
  name: string;
  url: string;
  description: string;
  enabled: boolean;
  headers: HeaderRow[];
}

let nextKey = 1;

function McpServerSheet({
  server,
  position = 0,
  onClose,
  onDelete,
  deleting,
}: {
  server?: AiMcpServer;
  position?: number;
  onClose: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t } = useI18n();
  const save = useSaveAiMcpServer();
  const initial = (from?: AiMcpServer): ServerValues => ({
    name: from?.name ?? "",
    url: from?.url ?? "",
    description: from?.description ?? "",
    enabled: from?.enabled ?? true,
    headers: from?.header_names.length
      ? from.header_names.map((name) => ({ key: nextKey++, name, value: "", saved: true, remove: false }))
      : [{ key: nextKey++, name: "Authorization", value: "", saved: false, remove: false }],
  });
  const [values, setValues] = useState<ServerValues>(() => initial(server));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (server) setValues(initial(server));
  }, [server]);
  const set = <K extends keyof ServerValues>(key: K, value: ServerValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const setHeader = (key: number, change: Partial<HeaderRow>) =>
    setValues((v) => ({ ...v, headers: v.headers.map((h) => (h.key === key ? { ...h, ...change } : h)) }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    const headers: Record<string, string> = {};
    const removeHeaders: string[] = [];
    for (const row of values.headers) {
      const name = row.name.trim();
      if (row.saved && row.remove) {
        removeHeaders.push(name);
        continue;
      }
      if (!name && !row.value.trim()) continue;
      if (!HEADER_NAME.test(name)) {
        setProblem(t("ai.mcp.badHeader", { name: name || "…" }));
        return;
      }
      if (row.value.trim()) headers[name] = row.value.trim();
    }
    await save.mutateAsync({
      ...(server ? { id: server.id } : { position }),
      name: values.name.trim(),
      url: values.url.trim(),
      description: values.description.trim() || null,
      enabled: values.enabled,
      headers,
      removeHeaders,
    });
    onClose();
  }

  const shownHeaders = values.headers.filter((h) => h.name.trim() && !h.remove && (h.saved || h.value.trim()));

  return (
    <EntitySheet
      title={server ? t("ai.mcp.editTitle") : t("ai.mcp.newTitle")}
      subtitle={t("ai.mcp.subtitle")}
      onClose={onClose}
      closeLabel={t("ai.services.close")}
      onSubmit={(e) => void submit(e).catch(() => undefined)}
      preview={
        <div className="entity-preview">
          <span className="entity-preview__kind">{t("ai.mcp.kind")}</span>
          <span className="entity-preview__label">{values.name || t("ai.untitled")}</span>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("ai.mcp.url")}</dt>
              <dd>{values.url || "—"}</dd>
            </div>
            <div>
              <dt>{t("ai.mcp.headers")}</dt>
              <dd>{shownHeaders.length ? shownHeaders.map((h) => h.name.trim()).join(", ") : "—"}</dd>
            </div>
            {server?.registry_server ? (
              <div>
                <dt>{t("ai.mcp.from")}</dt>
                <dd>{[server.registry_server, server.registry_version ? `v${server.registry_version}` : ""].filter(Boolean).join(" · ")}</dd>
              </div>
            ) : null}
            {server ? (
              <div>
                <dt>{t("ai.mcp.toolNames")}</dt>
                <dd>{`${mcpServerAppId(server.id)}__…`}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("ai.services.status")}</dt>
              <dd>{values.enabled ? t("ai.services.on") : t("ai.services.off")}</dd>
            </div>
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("ai.services.cancel")}
          onDelete={onDelete}
          deleteLabel={t("ai.services.delete")}
          deleting={deleting}
          submitLabel={server ? t("ai.services.save") : t("ai.services.create")}
          saving={save.isPending}
        />
      }
    >
      <div className="stack">
        {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        <Input label={t("ai.mcp.name")} value={values.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} autoFocus />
        <Input
          label={t("ai.mcp.url")}
          hint={t("ai.mcp.urlHint")}
          type="url"
          value={values.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder="https://mcp.example.com/mcp"
          required
          maxLength={500}
        />
        <Input
          label={t("ai.mcp.description")}
          hint={t("ai.mcp.descriptionHint")}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          maxLength={2000}
        />
        <fieldset className="ai-mcp__headers">
          <legend>{t("ai.mcp.headers")}</legend>
          <p className="muted">{t("ai.mcp.headersHint")}</p>
          {values.headers.map((row) => (
            <div key={row.key} className="ai-mcp__header">
              <Input
                label={t("ai.mcp.headerName")}
                value={row.name}
                disabled={row.saved}
                onChange={(e) => setHeader(row.key, { name: e.target.value })}
                placeholder="Authorization"
                maxLength={100}
              />
              <Input
                label={t("ai.mcp.headerValue")}
                type="password"
                autoComplete="off"
                value={row.value}
                disabled={row.remove}
                onChange={(e) => setHeader(row.key, { value: e.target.value })}
                placeholder={row.saved ? "••••••••" : "Bearer …"}
                maxLength={4000}
              />
              {row.saved ? (
                <Checkbox label={t("ai.mcp.removeHeader")} checked={row.remove} onChange={(e) => setHeader(row.key, { remove: e.target.checked })} />
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setValues((v) => ({ ...v, headers: v.headers.filter((h) => h.key !== row.key) }))}
                >
                  {t("ai.mcp.removeHeader")}
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setValues((v) => ({ ...v, headers: [...v.headers, { key: nextKey++, name: "", value: "", saved: false, remove: false }] }))}
          >
            {t("ai.mcp.addHeader")}
          </Button>
        </fieldset>
        <Checkbox label={t("ai.services.enabled")} checked={values.enabled} onChange={(e) => set("enabled", e.target.checked)} />
      </div>
    </EntitySheet>
  );
}
