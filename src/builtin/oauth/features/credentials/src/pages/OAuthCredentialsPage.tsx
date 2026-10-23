import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Input } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { getInternalApps } from "../../../../../../apps/registry";
import { getLocalizedText } from "../../../../../../apps/types";
import { apiScopes } from "../../../../../../api/openapi";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntityPicker } from "../../../../../../entities/EntityPicker";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { labelFor, useEntityLabels } from "../../../../../../entities/lookup";
import { registeredEntityTypes } from "../../../../../../entities/uri";
import { useEntityModal } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { copyText } from "../../../../../../shell/clipboard";
import type { EntityType } from "../../../../../../register";
import {
  useCreateOAuthClient,
  useDeleteOAuthClient,
  useOAuthClients,
  useOAuthGrants,
  useRegenerateOAuthSecret,
  useRevokeOAuthGrant,
  useUpdateOAuthClient,
  type OAuthClientValues,
} from "../../../../models/oauth";
import type { OAuthClient, OAuthSecret } from "../../../../models/types";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

/** The scopes every app's API declares, in the user's language. */
function useScopeOptions() {
  const { locale } = useI18n();
  return useMemo(
    () =>
      apiScopes(getInternalApps().map((app) => ({ id: app.id, api: app.manifest.api }))).map((scope) => ({
        name: scope.name,
        text: getLocalizedText(scope.description, locale),
      })),
    [locale],
  );
}

/**
 * The user's OAuth credentials (`/oauth`): one row per credential with its client id, the app it
 * belongs to and its redirect URI; `/oauth/new` and `/oauth/<client id>/edit` are the routed sheets.
 * A new credential's secret, and a regenerated one, is shown once in a sheet of its own and can't be
 * read back. Under them, the apps the user has allowed, to disconnect.
 */
export function OAuthCredentialsPage(_props: AppFeaturePageProps) {
  const { t, intlLocale } = useI18n();
  const clients = useOAuthClients();
  const rows = clients.data ?? [];
  const modal = useEntityModal("/oauth");
  const editing = modal.mode === "edit" ? rows.find((row) => row.client_id === modal.id) : undefined;
  const [secret, setSecret] = useState<OAuthSecret | null>(null);
  const regenerate = useRegenerateOAuthSecret();
  const remove = useDeleteOAuthClient();
  const labels = useEntityLabels(rows.map((row) => row.app_uri).filter((uri): uri is string => !!uri));
  const date = (value: string | null) => (value ? new Date(value).toLocaleString(intlLocale, { dateStyle: "medium", timeStyle: "short" }) : t("oauth.never"));

  async function regenerateSecret(row: OAuthClient) {
    if (!window.confirm(t("oauth.confirmRegenerate", { name: row.name }))) return;
    setSecret(await regenerate.mutateAsync(row.id));
  }

  function deleteClient(row: OAuthClient) {
    if (!window.confirm(t("oauth.confirmDelete", { name: row.name }))) return;
    remove.mutate(row.id, { onSuccess: () => (modal.mode === "edit" ? modal.close() : undefined) });
  }

  return (
    <div className="stack oauth-credentials">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("oauth.title")}</h2>
          <p className="muted">{t("oauth.intro")}</p>
        </div>
        <Button size="sm" tone="primary" onClick={modal.openNew}>
          {t("oauth.new")}
        </Button>
      </div>

      {regenerate.error ? <Alert tone="danger">{errorText(regenerate.error)}</Alert> : null}
      {clients.error ? <Alert tone="danger">{errorText(clients.error)}</Alert> : null}

      {clients.isLoading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState items={t("oauth.items")} actionLabel={t("oauth.new")} onAction={modal.openNew} />
      ) : (
        <table className="data-table oauth-credentials__table">
          <thead>
            <tr>
              <th>{t("oauth.name")}</th>
              <th>{t("oauth.app")}</th>
              <th>{t("oauth.clientId")}</th>
              <th>{t("oauth.redirectUri")}</th>
              <th>{t("oauth.lastUsed")}</th>
              <th className="action-row-cell" aria-label={t("oauth.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="action-row">
                <td>{row.name}</td>
                <td className="muted">{row.app_uri ? (labelFor(labels.data, row.app_uri) ?? row.app_uri) : "—"}</td>
                <td>
                  <code>{row.client_id}</code>
                </td>
                <td className="muted oauth-credentials__uri">{row.redirect_uri}</td>
                <td className="muted">{date(row.last_used_at)}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={row.name}
                    actions={[
                      { key: "edit", label: t("oauth.edit"), onSelect: () => modal.openEdit(row.client_id) },
                      { key: "copy-client-id", label: t("oauth.copyClientId"), onSelect: () => copyText(row.client_id, t("oauth.copied"), t("oauth.copyFailed")) },
                      { key: "regenerate", label: t("oauth.regenerate"), aspects: ["configure"], onSelect: () => void regenerateSecret(row) },
                      { key: "delete", label: t("oauth.delete"), tone: "danger", onSelect: () => deleteClient(row) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConnectedApps />

      {modal.mode === "new" ? <CredentialSheet onClose={modal.close} onCreated={(created) => (modal.close(), setSecret(created))} /> : null}
      {modal.mode === "edit" && editing ? (
        <CredentialSheet
          client={editing}
          onClose={modal.close}
          onRegenerate={() => void regenerateSecret(editing)}
          onDelete={() => deleteClient(editing)}
          deleting={remove.isPending}
        />
      ) : null}
      {secret ? <SecretSheet secret={secret} onClose={() => setSecret(null)} /> : null}
    </div>
  );
}

function CredentialSheet({
  client,
  onClose,
  onCreated,
  onRegenerate,
  onDelete,
  deleting,
}: {
  client?: OAuthClient;
  onClose: () => void;
  onCreated?: (secret: OAuthSecret) => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t } = useI18n();
  const scopeOptions = useScopeOptions();
  const create = useCreateOAuthClient();
  const update = useUpdateOAuthClient();
  const [values, setValues] = useState<OAuthClientValues>(() => ({
    name: client?.name ?? "",
    app_uri: client?.app_uri ?? null,
    redirect_uri: client?.redirect_uri ?? "",
    callback_url: client?.callback_url ?? null,
    scopes: client?.scopes ?? [],
  }));
  useEffect(() => {
    if (client) setValues({ name: client.name, app_uri: client.app_uri, redirect_uri: client.redirect_uri, callback_url: client.callback_url, scopes: client.scopes });
  }, [client]);
  const set = <K extends keyof OAuthClientValues>(key: K, value: OAuthClientValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const appTypes = registeredEntityTypes().includes("app" as EntityType) ? (["app"] as EntityType[]) : undefined;
  const error = create.error ?? update.error;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = { ...values, name: values.name.trim(), redirect_uri: values.redirect_uri.trim(), callback_url: values.callback_url?.trim() || null };
    if (client) {
      await update.mutateAsync({ id: client.id, ...clean });
      onClose();
    } else {
      onCreated?.(await create.mutateAsync(clean));
    }
  }

  let redirectHost = "";
  try {
    redirectHost = values.redirect_uri ? new URL(values.redirect_uri).host : "";
  } catch {
    redirectHost = "";
  }

  return (
    <EntitySheet
      title={client ? t("oauth.editTitle") : t("oauth.newTitle")}
      subtitle={client ? <code>{client.client_id}</code> : t("oauth.newSubtitle")}
      onClose={onClose}
      closeLabel={t("oauth.close")}
      onSubmit={(e) => void submit(e).catch(() => undefined)}
      actions={client && onRegenerate ? [{ key: "regenerate", label: t("oauth.regenerate"), aspects: ["configure"], onSelect: onRegenerate }] : []}
      preview={
        <div className="entity-preview">
          <span className="entity-preview__kind">{t("oauth.kind")}</span>
          <span className="entity-preview__label">{values.name || t("oauth.untitled")}</span>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("oauth.clientId")}</dt>
              <dd>{client?.client_id ?? t("oauth.clientIdLater")}</dd>
            </div>
            <div>
              <dt>{t("oauth.secret")}</dt>
              <dd>{client ? `••••${client.secret_hint}` : t("oauth.secretLater")}</dd>
            </div>
            <div>
              <dt>{t("oauth.redirectsTo")}</dt>
              <dd>{redirectHost || "—"}</dd>
            </div>
            <div>
              <dt>{t("oauth.scopes")}</dt>
              <dd>{values.scopes.length ? values.scopes.join(", ") : t("oauth.anyScope")}</dd>
            </div>
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("oauth.cancel")}
          onDelete={onDelete}
          deleteLabel={t("oauth.delete")}
          deleting={deleting}
          submitLabel={client ? t("oauth.save") : t("oauth.create")}
          saving={create.isPending || update.isPending}
        />
      }
    >
      <div className="stack">
        {error ? <Alert tone="danger">{errorText(error)}</Alert> : null}
        <Input label={t("oauth.name")} value={values.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} autoFocus />
        <EntityPicker label={t("oauth.app")} hint={t("oauth.appHint")} types={appTypes} valueKind="uri" value={values.app_uri} onChange={(uri) => set("app_uri", uri)} />
        <Input
          label={t("oauth.redirectUri")}
          hint={t("oauth.redirectUriHint")}
          type="url"
          value={values.redirect_uri}
          onChange={(e) => set("redirect_uri", e.target.value)}
          required
          placeholder="https://myapp.example.com/callback"
        />
        <Input
          label={t("oauth.callbackUrl")}
          hint={t("oauth.callbackUrlHint")}
          type="url"
          value={values.callback_url ?? ""}
          onChange={(e) => set("callback_url", e.target.value || null)}
          placeholder="https://myapp.example.com/webhooks/spacify"
        />
        <fieldset className="oauth-credentials__scopes">
          <legend className="bungalow-label">{t("oauth.scopes")}</legend>
          <p className="muted">{t("oauth.scopesHint")}</p>
          {scopeOptions.map((scope) => (
            <Checkbox
              key={scope.name}
              label={`${scope.text} (${scope.name})`}
              checked={values.scopes.includes(scope.name)}
              onChange={(e) => set("scopes", e.target.checked ? [...values.scopes, scope.name] : values.scopes.filter((s) => s !== scope.name))}
            />
          ))}
        </fieldset>
        {client ? (
          <div className="oauth-credentials__secret-row">
            <span className="muted">{t("oauth.secretCreated", { hint: client.secret_hint, date: new Date(client.secret_created_at).toLocaleDateString() })}</span>
            {onRegenerate ? (
              <Button type="button" size="sm" variant="outline" onClick={onRegenerate}>
                {t("oauth.regenerate")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </EntitySheet>
  );
}

/** The secret, this once: with the client id, copy buttons and a warning that it won't show again. */
function SecretSheet({ secret, onClose }: { secret: OAuthSecret; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <EntitySheet
      title={t("oauth.secretTitle")}
      subtitle={t("oauth.secretSubtitle")}
      onClose={onClose}
      closeLabel={t("oauth.close")}
      onSubmit={(e) => (e.preventDefault(), onClose())}
      footer={<FormActions submitLabel={copied ? t("oauth.done") : t("oauth.doneUncopied")} />}
    >
      <div className="stack">
        <Alert tone="warning">{t("oauth.secretOnce")}</Alert>
        <div className="oauth-secret">
          <span className="bungalow-label">{t("oauth.clientId")}</span>
          <code className="oauth-secret__value">{secret.client_id}</code>
          <Button type="button" size="sm" variant="outline" onClick={() => copyText(secret.client_id, t("oauth.copied"), t("oauth.copyFailed"))}>
            {t("oauth.copy")}
          </Button>
        </div>
        <div className="oauth-secret">
          <span className="bungalow-label">{t("oauth.secret")}</span>
          <code className="oauth-secret__value">{secret.client_secret}</code>
          <Button
            type="button"
            size="sm"
            tone="primary"
            onClick={() => {
              copyText(secret.client_secret, t("oauth.copied"), t("oauth.copyFailed"));
              setCopied(true);
            }}
          >
            {t("oauth.copy")}
          </Button>
        </div>
      </div>
    </EntitySheet>
  );
}

/** The apps the user has allowed, each with the scopes it got and a way to disconnect it. */
function ConnectedApps() {
  const { t, intlLocale } = useI18n();
  const grants = useOAuthGrants();
  const revoke = useRevokeOAuthGrant();
  const rows = grants.data ?? [];
  if (grants.isLoading || grants.error) return null;
  return (
    <section className="stack oauth-grants">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{t("oauth.grants.title")}</h3>
          <p className="muted">{t("oauth.grants.intro")}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState items={t("oauth.grants.items")} description={t("oauth.grants.none")} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("oauth.grants.app")}</th>
              <th>{t("oauth.scopes")}</th>
              <th>{t("oauth.grants.since")}</th>
              <th>{t("oauth.lastUsed")}</th>
              <th className="action-row-cell" aria-label={t("oauth.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((grant) => (
              <tr key={grant.client_id} className="action-row">
                <td>{grant.name}</td>
                <td className="muted">{grant.scopes.join(", ") || "—"}</td>
                <td className="muted">{new Date(grant.created_at).toLocaleDateString(intlLocale)}</td>
                <td className="muted">{grant.last_used_at ? new Date(grant.last_used_at).toLocaleString(intlLocale, { dateStyle: "medium", timeStyle: "short" }) : t("oauth.never")}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={grant.name}
                    actions={[
                      {
                        key: "disconnect",
                        label: t("oauth.grants.disconnect"),
                        tone: "danger",
                        aspects: ["configure"],
                        onSelect: () => {
                          if (window.confirm(t("oauth.grants.confirmDisconnect", { name: grant.name }))) revoke.mutate(grant.client_id);
                        },
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
