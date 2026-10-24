import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Input } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { useEntityModal, useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { listRegistryServers, registryApiBase, useDeleteMcpRegistry, useMcpRegistries, useSaveMcpRegistry, type McpRegistry } from "../../../../models";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

/**
 * The MCP registries the Service Finder browses (`/mcp-registries`): the built-in ones
 * (the official MCP registry; read-only) and the user's own, which speak the same v0 API.
 * `/mcp-registries/new` and `/mcp-registries/<id>/edit` are the routed sheets.
 */
export function McpRegistriesPage(_props: AppFeaturePageProps) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const registries = useMcpRegistries();
  const rows = registries.data ?? [];
  const own = rows.filter((r) => r.user_id);
  const modal = useEntityModal("/mcp-registries");
  const editing = modal.mode === "edit" ? own.find((row) => row.id === modal.id) : undefined;
  const save = useSaveMcpRegistry();
  const remove = useDeleteMcpRegistry();

  function deleteRegistry(row: McpRegistry) {
    if (!window.confirm(t("serviceFinder.registryConfirmDelete", { name: row.name }))) return;
    remove.mutate(row.id, { onSuccess: () => (modal.mode === "edit" ? modal.close() : undefined) });
  }

  return (
    <div className="stack service-finder">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("serviceFinder.registries")}</h2>
          <p className="muted">{t("serviceFinder.registriesIntro")}</p>
        </div>
        <Button size="sm" tone="primary" onClick={modal.openNew}>
          {t("serviceFinder.addRegistry")}
        </Button>
      </div>

      {registries.error ? <Alert tone="danger">{errorText(registries.error)}</Alert> : null}
      {remove.error ? <Alert tone="danger">{errorText(remove.error)}</Alert> : null}

      {registries.isLoading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState items={t("serviceFinder.registryItems")} actionLabel={t("serviceFinder.addRegistry")} onAction={modal.openNew} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("serviceFinder.registryNameLabel")}</th>
              <th>{t("serviceFinder.address")}</th>
              <th>{t("serviceFinder.registrySource")}</th>
              <th>{t("serviceFinder.status")}</th>
              <th className="action-row-cell" aria-label={t("serviceFinder.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="action-row">
                <td>{row.name}</td>
                <td className="muted service-finder__address">{row.url}</td>
                <td className="muted">{row.user_id ? t("serviceFinder.registryOwn") : t("serviceFinder.registryBuiltIn")}</td>
                <td className="muted">{row.enabled ? t("serviceFinder.on") : t("serviceFinder.off")}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={row.name}
                    actions={[
                      { key: "open", label: t("serviceFinder.browse"), onSelect: () => go("/service-finder") },
                      ...(row.user_id
                        ? [
                            { key: "edit", label: t("serviceFinder.edit"), onSelect: () => modal.openEdit(row.id) },
                            {
                              key: "toggle",
                              label: row.enabled ? t("serviceFinder.turnOff") : t("serviceFinder.turnOn"),
                              aspects: ["configure" as const],
                              onSelect: () => save.mutate({ id: row.id, enabled: !row.enabled }),
                            },
                            { key: "delete", label: t("serviceFinder.delete"), tone: "danger" as const, onSelect: () => deleteRegistry(row) },
                          ]
                        : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal.mode === "new" ? <RegistrySheet position={own.length} onClose={modal.close} /> : null}
      {modal.mode === "edit" && editing ? (
        <RegistrySheet registry={editing} onClose={modal.close} onDelete={() => deleteRegistry(editing)} deleting={remove.isPending} />
      ) : null}
    </div>
  );
}

type Probe = { state: "idle" } | { state: "checking" } | { state: "ok"; count: number } | { state: "failed"; error: string };

function RegistrySheet({
  registry,
  position = 0,
  onClose,
  onDelete,
  deleting,
}: {
  registry?: McpRegistry;
  position?: number;
  onClose: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t } = useI18n();
  const save = useSaveMcpRegistry();
  const [name, setName] = useState(registry?.name ?? "");
  const [url, setUrl] = useState(registry?.url ?? "");
  const [description, setDescription] = useState(registry?.description ?? "");
  const [enabled, setEnabled] = useState(registry?.enabled ?? true);
  const [probe, setProbe] = useState<Probe>({ state: "idle" });

  useEffect(() => {
    if (!registry) return;
    setName(registry.name);
    setUrl(registry.url);
    setDescription(registry.description ?? "");
    setEnabled(registry.enabled);
  }, [registry]);

  // Tries the address (one server) so a wrong one shows before it's saved.
  useEffect(() => {
    const address = url.trim();
    if (!/^https?:\/\/[^/?#\s]+/i.test(address)) {
      setProbe({ state: "idle" });
      return;
    }
    const controller = new AbortController();
    const id = window.setTimeout(() => {
      setProbe({ state: "checking" });
      listRegistryServers({ url: address }, { limit: 1, signal: controller.signal })
        .then((page) => setProbe({ state: "ok", count: page.servers.length }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setProbe({ state: "failed", error: errorText(error) });
        });
    }, 500);
    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [url]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save.mutateAsync({
      ...(registry ? { id: registry.id } : { position }),
      name: name.trim(),
      url: url.trim().replace(/\/+$/, ""),
      description: description.trim() || null,
      kind: "mcp-v0",
      enabled,
    });
    onClose();
  }

  return (
    <EntitySheet
      title={registry ? t("serviceFinder.editRegistry") : t("serviceFinder.newRegistry")}
      subtitle={t("serviceFinder.registrySubtitle")}
      onClose={onClose}
      closeLabel={t("serviceFinder.close")}
      onSubmit={(e) => void submit(e).catch(() => undefined)}
      preview={
        <div className="entity-preview">
          <span className="entity-preview__kind">{t("serviceFinder.registryKind")}</span>
          <span className="entity-preview__label">{name || t("serviceFinder.untitled")}</span>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("serviceFinder.api")}</dt>
              <dd className="service-finder__address">{url.trim() ? `${registryApiBase(url)}/servers` : "—"}</dd>
            </div>
            <div>
              <dt>{t("serviceFinder.status")}</dt>
              <dd>{enabled ? t("serviceFinder.on") : t("serviceFinder.off")}</dd>
            </div>
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("serviceFinder.cancel")}
          onDelete={onDelete}
          deleteLabel={t("serviceFinder.delete")}
          deleting={deleting}
          submitLabel={registry ? t("serviceFinder.save") : t("serviceFinder.addRegistry")}
          saving={save.isPending}
        />
      }
    >
      <div className="stack">
        {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
        <Input label={t("serviceFinder.registryNameLabel")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoFocus />
        <Input
          label={t("serviceFinder.address")}
          hint={t("serviceFinder.registryUrlHint")}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://registry.example.com"
          required
          maxLength={500}
        />
        {probe.state === "checking" ? <p className="muted">{t("serviceFinder.probing")}</p> : null}
        {probe.state === "ok" ? <Alert tone="success">{t("serviceFinder.probeOk")}</Alert> : null}
        {probe.state === "failed" ? <Alert tone="warning">{t("serviceFinder.probeFailed", { error: probe.error })}</Alert> : null}
        <Input
          label={t("serviceFinder.registryDescription")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
        <Checkbox label={t("serviceFinder.registryEnabled")} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </div>
    </EntitySheet>
  );
}
