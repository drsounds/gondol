import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { useEntityModal } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import {
  AI_SERVICE_PRESETS,
  getAiProvider,
  serviceProviders,
  useAiServices,
  useDeleteAiService,
  useSaveAiService,
  type AiService,
} from "../../../../models";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

/** A service's address as shown: its own, or what its provider uses without one. */
function addressOf(service: Pick<AiService, "provider" | "base_url" | "options">, serverDefault: string): string {
  if (service.base_url) return service.base_url;
  const backend = service.provider === "deepagents" ? (service.options?.backend ?? "ollama") : service.provider;
  return backend === "ollama" ? serverDefault : (getAiProvider(backend)?.defaultBaseUrl ?? "");
}

/**
 * The user's AI services (`ai_services`), listed on `/ai-models`: each with its provider, address,
 * whether a key is saved and whether the chat uses it. `/ai-models/services/new` and
 * `/ai-models/services/<id>/edit` are the routed sheets; they close back to `/ai-models`.
 */
export function AiServicesSection() {
  const { t } = useI18n();
  const services = useAiServices();
  const rows = services.data ?? [];
  const modal = useEntityModal("/ai-models/services", "/ai-models");
  const editing = modal.mode === "edit" ? rows.find((row) => row.id === modal.id) : undefined;
  const save = useSaveAiService();
  const remove = useDeleteAiService();

  function deleteService(row: AiService) {
    if (!window.confirm(t("ai.services.confirmDelete", { name: row.name }))) return;
    remove.mutate(row.id, { onSuccess: () => (modal.mode === "edit" ? modal.close() : undefined) });
  }

  return (
    <section className="stack ai-services">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("ai.services.title")}</h2>
          <p className="muted">{t("ai.services.intro")}</p>
        </div>
        <Button size="sm" tone="primary" onClick={modal.openNew}>
          {t("ai.services.new")}
        </Button>
      </div>

      {services.error ? <Alert tone="danger">{errorText(services.error)}</Alert> : null}
      {remove.error ? <Alert tone="danger">{errorText(remove.error)}</Alert> : null}

      {services.isLoading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState items={t("ai.services.items")} actionLabel={t("ai.services.new")} onAction={modal.openNew} />
      ) : (
        <table className="data-table ai-services__table">
          <thead>
            <tr>
              <th>{t("ai.services.name")}</th>
              <th>{t("ai.services.provider")}</th>
              <th>{t("ai.services.address")}</th>
              <th>{t("ai.services.key")}</th>
              <th>{t("ai.services.status")}</th>
              <th className="action-row-cell" aria-label={t("ai.services.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="action-row">
                <td>{row.name}</td>
                <td className="muted">{getAiProvider(row.provider)?.name ?? row.provider}</td>
                <td className="muted ai-services__address">{addressOf(row, t("ai.serverDefault"))}</td>
                <td className="muted">{row.has_api_key ? t("ai.services.keySaved") : "—"}</td>
                <td className="muted">{row.enabled ? t("ai.services.on") : t("ai.services.off")}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={row.name}
                    actions={[
                      { key: "edit", label: t("ai.services.edit"), onSelect: () => modal.openEdit(row.id) },
                      {
                        key: "toggle",
                        label: row.enabled ? t("ai.services.turnOff") : t("ai.services.turnOn"),
                        aspects: ["configure"],
                        onSelect: () => save.mutate({ id: row.id, enabled: !row.enabled }),
                      },
                      { key: "delete", label: t("ai.services.delete"), tone: "danger", onSelect: () => deleteService(row) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal.mode === "new" ? <ServiceSheet position={rows.length} onClose={modal.close} /> : null}
      {modal.mode === "edit" && editing ? (
        <ServiceSheet service={editing} onClose={modal.close} onDelete={() => deleteService(editing)} deleting={remove.isPending} />
      ) : null}
    </section>
  );
}

interface ServiceValues {
  preset: string;
  name: string;
  provider: string;
  base_url: string;
  /** For a Deep Agent: the API its model runs on. */
  backend: "ollama" | "openai";
  enabled: boolean;
  /** A new key; "" keeps the saved one. */
  apiKey: string;
  removeKey: boolean;
}

function ServiceSheet({
  service,
  position = 0,
  onClose,
  onDelete,
  deleting,
}: {
  service?: AiService;
  position?: number;
  onClose: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t } = useI18n();
  const save = useSaveAiService();
  const providers = serviceProviders();
  const initial = (from?: AiService): ServiceValues => ({
    preset: from ? "custom" : AI_SERVICE_PRESETS[0].id,
    name: from?.name ?? AI_SERVICE_PRESETS[0].name,
    provider: from?.provider ?? AI_SERVICE_PRESETS[0].provider,
    base_url: from?.base_url ?? AI_SERVICE_PRESETS[0].baseUrl,
    backend: from?.options?.backend ?? AI_SERVICE_PRESETS[0].options?.backend ?? "ollama",
    enabled: from?.enabled ?? true,
    apiKey: "",
    removeKey: false,
  });
  const [values, setValues] = useState<ServiceValues>(() => initial(service));
  useEffect(() => {
    if (service) setValues(initial(service));
  }, [service]);
  const set = <K extends keyof ServiceValues>(key: K, value: ServiceValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const preset = AI_SERVICE_PRESETS.find((p) => p.id === values.preset);
  const provider = getAiProvider(values.provider);

  function pickPreset(id: string) {
    const next = AI_SERVICE_PRESETS.find((p) => p.id === id);
    if (!next) return;
    setValues((v) => ({ ...v, preset: id, provider: next.provider, base_url: next.baseUrl, backend: next.options?.backend ?? v.backend, name: next.name || v.name }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiKey = values.removeKey ? null : values.apiKey.trim() ? values.apiKey.trim() : undefined;
    await save.mutateAsync({
      ...(service ? { id: service.id } : { position }),
      name: values.name.trim(),
      provider: values.provider,
      base_url: values.base_url.trim().replace(/\/+$/, "") || null,
      options: values.provider === "deepagents" ? { ...service?.options, backend: values.backend } : (service?.options ?? {}),
      enabled: values.enabled,
      ...(apiKey !== undefined ? { apiKey } : {}),
    });
    onClose();
  }

  const keyState = values.removeKey
    ? t("ai.services.keyRemoved")
    : values.apiKey.trim()
      ? t("ai.services.keyNew")
      : service?.has_api_key
        ? t("ai.services.keySaved")
        : t("ai.services.keyNone");

  return (
    <EntitySheet
      title={service ? t("ai.services.editTitle") : t("ai.services.newTitle")}
      subtitle={t("ai.services.subtitle")}
      onClose={onClose}
      closeLabel={t("ai.services.close")}
      onSubmit={(e) => void submit(e).catch(() => undefined)}
      preview={
        <div className="entity-preview">
          <span className="entity-preview__kind">{t("ai.services.kind")}</span>
          <span className="entity-preview__label">{values.name || t("ai.untitled")}</span>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("ai.services.provider")}</dt>
              <dd>{provider?.name ?? values.provider}</dd>
            </div>
            {values.provider === "deepagents" ? (
              <div>
                <dt>{t("ai.services.backend")}</dt>
                <dd>{getAiProvider(values.backend)?.name ?? values.backend}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("ai.services.address")}</dt>
              <dd>{addressOf({ provider: values.provider, base_url: values.base_url.trim() || null, options: { backend: values.backend } }, t("ai.serverDefault")) || "—"}</dd>
            </div>
            <div>
              <dt>{t("ai.services.key")}</dt>
              <dd>{keyState}</dd>
            </div>
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
          submitLabel={service ? t("ai.services.save") : t("ai.services.create")}
          saving={save.isPending}
        />
      }
    >
      <div className="stack">
        {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
        {!service ? (
          <Select label={t("ai.services.preset")} value={values.preset} onChange={(e) => pickPreset(e.target.value)}>
            {AI_SERVICE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === "custom" ? t("ai.services.presetCustom") : p.id === "ollama" ? t("ai.services.presetOllama") : p.id === "deepagents" ? t("ai.services.presetDeepAgents") : p.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Input label={t("ai.services.name")} value={values.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} autoFocus />
        <Select label={t("ai.services.provider")} hint={t("ai.services.providerHint")} value={values.provider} onChange={(e) => set("provider", e.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {values.provider === "deepagents" ? (
          <Select
            label={t("ai.services.backend")}
            hint={t("ai.services.backendHint")}
            value={values.backend}
            onChange={(e) => set("backend", e.target.value === "openai" ? "openai" : "ollama")}
          >
            <option value="ollama">{getAiProvider("ollama")?.name ?? "Ollama"}</option>
            <option value="openai">{getAiProvider("openai")?.name ?? "OpenAI-compatible API"}</option>
          </Select>
        ) : null}
        <Input
          label={t("ai.services.address")}
          hint={t(
            values.provider === "ollama" || (values.provider === "deepagents" && values.backend === "ollama")
              ? "ai.services.addressHintOllama"
              : "ai.services.addressHint",
          )}
          type="url"
          value={values.base_url}
          onChange={(e) => set("base_url", e.target.value)}
          placeholder={values.provider === "deepagents" ? getAiProvider(values.backend)?.defaultBaseUrl : provider?.defaultBaseUrl}
          maxLength={500}
        />
        <Input
          label={t("ai.services.key")}
          hint={t(service?.has_api_key ? "ai.services.keyHintSaved" : preset?.needsKey ? "ai.services.keyHintNeeded" : "ai.services.keyHint")}
          type="password"
          autoComplete="off"
          value={values.apiKey}
          disabled={values.removeKey}
          onChange={(e) => set("apiKey", e.target.value)}
          placeholder={service?.has_api_key ? "••••••••" : ""}
          maxLength={1000}
        />
        {service?.has_api_key ? (
          <Checkbox label={t("ai.services.removeKey")} checked={values.removeKey} onChange={(e) => set("removeKey", e.target.checked)} />
        ) : null}
        <Checkbox label={t("ai.services.enabled")} checked={values.enabled} onChange={(e) => set("enabled", e.target.checked)} />
      </div>
    </EntitySheet>
  );
}
