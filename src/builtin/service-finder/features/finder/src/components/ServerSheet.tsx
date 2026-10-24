import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, Checkbox, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { useSaveAiMcpServer, type AiMcpServer } from "../../../../../ai/models";
import {
  compareVersions,
  installFields,
  installableRemote,
  missingFields,
  resolveInstall,
  serverIcon,
  serverReach,
  serverRepository,
  serverTitle,
  useRegistryServer,
  type McpRegistry,
} from "../../../../models";
import { ServerArt } from "./ServerArt";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

/**
 * A server from a registry (`/service-finder/servers/<registry name>`): what it is and how it runs,
 * and, when it has a Streamable HTTP remote, the sheet that installs it into the user's MCP servers
 * (`ai_mcp_servers`, the list the AI chat and the agents use), asking for its URL variables and
 * headers. A server installed before is updated in place: its saved headers stay unless replaced.
 */
export function ServerSheet({
  name,
  registries,
  installed,
  position,
  onClose,
  onInstalled,
}: {
  name: string;
  /** Where to look for it, the one being browsed first. */
  registries: McpRegistry[];
  installed: AiMcpServer[];
  position: number;
  onClose: () => void;
  onInstalled: (server: AiMcpServer) => void;
}) {
  const { t } = useI18n();
  const found = useRegistryServer(registries, name);
  const save = useSaveAiMcpServer();
  const server = found.data?.entry.server;
  const registry = found.data?.registry;
  const remote = server ? installableRemote(server) : null;
  const fields = useMemo(() => (remote ? installFields(remote) : []), [remote]);
  const existing = installed.find((row) => row.registry_server === name && (!registry || !row.registry_id || row.registry_id === registry.id));
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setValues(Object.fromEntries(fields.map((field) => [field.key, field.defaultValue])));
  }, [fields]);
  const existingName = existing?.name;
  const existingEnabled = existing?.enabled;
  useEffect(() => {
    if (server) setLabel(existingName ?? serverTitle(server));
    if (existingEnabled != null) setEnabled(existingEnabled);
  }, [server, existingName, existingEnabled]);

  const reach = server ? serverReach(server) : null;
  const resolved = remote ? resolveInstall(remote, values) : null;
  const newer = existing?.registry_version && server?.version ? compareVersions(server.version, existing.registry_version) > 0 : false;
  // A header already saved on the installed server needn't be given again.
  const savedHeaders = new Set((existing?.header_names ?? []).map((h) => h.toLowerCase()));
  const stillMissing = missingFields(fields, values).filter((field) => !(field.header && savedHeaders.has(field.header.toLowerCase())));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!server || !remote || !registry || !resolved) return;
    setProblem(null);
    if (stillMissing.length) {
      setProblem(t("serviceFinder.missing", { names: stillMissing.map((f) => f.label).join(", ") }));
      return;
    }
    if (/\{[A-Za-z_][\w.-]*\}/.test(resolved.url)) {
      setProblem(t("serviceFinder.badUrl"));
      return;
    }
    const saved = await save.mutateAsync({
      ...(existing ? { id: existing.id } : { position }),
      name: label.trim() || serverTitle(server),
      url: resolved.url,
      description: server.description?.slice(0, 2000) || null,
      enabled,
      registry_id: registry.id,
      registry_server: server.name,
      registry_version: server.version ?? null,
      website_url: server.websiteUrl && /^https?:\/\//i.test(server.websiteUrl) ? server.websiteUrl : null,
      repository_url: serverRepository(server),
      icon_url: serverIcon(server),
      headers: resolved.headers,
    });
    onInstalled(saved);
  }

  const title = server ? serverTitle(server) : name;
  const submitLabel = existing ? (newer ? t("serviceFinder.update") : t("serviceFinder.save")) : t("serviceFinder.install");

  return (
    <EntitySheet
      title={title}
      subtitle={server ? name : undefined}
      onClose={onClose}
      closeLabel={t("serviceFinder.close")}
      onSubmit={(e) => void submit(e).catch(() => undefined)}
      actions={[
        ...(server?.websiteUrl && /^https?:\/\//i.test(server.websiteUrl)
          ? [{ key: "website", label: t("serviceFinder.website"), onSelect: () => void window.open(server.websiteUrl!, "_blank", "noopener") }]
          : []),
        ...(server && serverRepository(server)
          ? [{ key: "repository", label: t("serviceFinder.repository"), onSelect: () => void window.open(serverRepository(server)!, "_blank", "noopener") }]
          : []),
      ]}
      preview={
        <div className="entity-preview service-finder__preview">
          {server ? <ServerArt server={server} size="lg" /> : null}
          <span className="entity-preview__kind">{t("serviceFinder.kind")}</span>
          <span className="entity-preview__label">{label || title}</span>
          {server?.description ? <p className="service-finder__preview-text">{server.description}</p> : null}
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("serviceFinder.registryName")}</dt>
              <dd>{name}</dd>
            </div>
            {server?.version ? (
              <div>
                <dt>{t("serviceFinder.version")}</dt>
                <dd>{existing?.registry_version && newer ? `${existing.registry_version} → ${server.version}` : server.version}</dd>
              </div>
            ) : null}
            {registry ? (
              <div>
                <dt>{t("serviceFinder.registry")}</dt>
                <dd>{registry.name}</dd>
              </div>
            ) : null}
            {reach ? (
              <div>
                <dt>{t("serviceFinder.runs")}</dt>
                <dd>{t(`serviceFinder.reach.${reach}`)}</dd>
              </div>
            ) : null}
            {resolved ? (
              <div>
                <dt>{t("serviceFinder.address")}</dt>
                <dd className="service-finder__address">{resolved.url}</dd>
              </div>
            ) : null}
            {resolved && Object.keys(resolved.headers).length ? (
              <div>
                <dt>{t("serviceFinder.headers")}</dt>
                <dd>{Object.keys(resolved.headers).join(", ")}</dd>
              </div>
            ) : null}
            {existing ? (
              <div>
                <dt>{t("serviceFinder.status")}</dt>
                <dd>{existing.enabled ? t("serviceFinder.installedOn") : t("serviceFinder.installedOff")}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("serviceFinder.cancel")}
          submitLabel={submitLabel}
          saving={save.isPending}
          submitDisabled={!remote || !registry}
        />
      }
    >
      <div className="stack">
        {found.isLoading ? <p className="muted">{t("app.loading")}</p> : null}
        {found.error ? <Alert tone="danger">{errorText(found.error)}</Alert> : null}
        {found.isSuccess && !found.data ? <Alert tone="warning">{t("serviceFinder.notFound", { name })}</Alert> : null}
        {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        {server ? (
          <>
            {server.description ? <p>{server.description}</p> : null}
            {existing ? <Alert tone="info">{newer ? t("serviceFinder.updateAvailable", { version: server.version ?? "" }) : t("serviceFinder.alreadyInstalled")}</Alert> : null}
            {reach === "remote" ? (
              <>
                <Input label={t("serviceFinder.name")} value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={200} />
                {fields.length ? <p className="muted">{t("serviceFinder.fieldsIntro")}</p> : <p className="muted">{t("serviceFinder.noFields")}</p>}
                {fields.map((field) => {
                  const saved = !!field.header && savedHeaders.has(field.header.toLowerCase());
                  const common = {
                    label: field.label,
                    hint: [field.description, saved ? t("serviceFinder.savedHeader") : ""].filter(Boolean).join(" "),
                    value: values[field.key] ?? "",
                    required: field.required && !saved,
                  };
                  return field.choices?.length ? (
                    <Select key={field.key} {...common} onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}>
                      {field.required ? null : <option value="">—</option>}
                      {field.choices.map((choice) => (
                        <option key={choice} value={choice}>
                          {choice}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      key={field.key}
                      {...common}
                      type={field.secret ? "password" : "text"}
                      autoComplete="off"
                      placeholder={saved ? "••••••••" : undefined}
                      maxLength={4000}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    />
                  );
                })}
                <Checkbox label={t("serviceFinder.enabled")} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <p className="muted">{t("serviceFinder.usedBy")}</p>
              </>
            ) : (
              <Alert tone="warning">{t(`serviceFinder.cannot.${reach ?? "none"}`)}</Alert>
            )}
            {server.packages?.length ? (
              <div className="stack">
                <h3 className="service-finder__subhead">{t("serviceFinder.packages")}</h3>
                <ul className="service-finder__packages">
                  {server.packages.map((pkg, index) => (
                    <li key={index}>
                      <code>{[pkg.registryType, pkg.identifier].filter(Boolean).join(" ")}</code>
                      {pkg.transport?.type ? <span className="muted"> · {pkg.transport.type}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </EntitySheet>
  );
}
