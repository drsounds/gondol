import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Button, Card, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { ActionMenu, type MenuAction } from "../../../../../../entities/ActionMenu";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { entityKey, findByEntityKey } from "../../../../../../entities/slugs";
import { toEntityUri } from "../../../../../../entities/uri";
import { useI18n } from "../../../../../../i18n/i18n";
import { useEntityModal, useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { authAspect, catalogueAspect, mediaAspect, musicAspect, type AuthAspect } from "../../../../../../playback/types";
import { useServicesList } from "../../../../../../services/ConceptsHost";
import { hasAspect, serviceManager, type Service } from "../../../../../../services/service";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { showToast } from "../../../../../../shell/clipboard";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { accountsCache, deleteAccount, saveSignIn, saveSignOut, type ExternalServiceAccount } from "../../../../../models/accounts";

/**
 * Music services (`/music-services`): every service the apps that are on contribute (YouTube from
 * the yt-music-service app, …), what each can do, and the accounts they're signed in with
 * (`external_service_accounts`, private to their owner). `/music-services/accounts/new`,
 * `/music-services/accounts/<key>/edit` and `/music-services/<service>/sign-in` are the routed sheets.
 */
export function MusicServicesPage(_props: AppFeaturePageProps) {
  const { t, intlLocale } = useI18n();
  const go = useNavigateKeepingSearch();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const modal = useEntityModal("/music-services/accounts", "/music-services");
  const services = useServicesList();
  useSyncExternalStore(accountsCache.subscribe, accountsCache.getVersion, () => 0);
  const accounts = accountsCache.rows;
  useEffect(() => {
    void accountsCache.load();
  }, []);

  const signInFor = /^\/music-services\/([^/]+)\/sign-in\/?$/.exec(pathname)?.[1] ?? null;
  const editing = modal.mode === "edit" ? findByEntityKey(accounts, modal.id) : undefined;
  const sheetOpen = modal.mode === "new" || !!editing || !!signInFor;
  const dates = useMemo(() => new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }), [intlLocale]);
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? id;
  const closeSheet = () => (signInFor ? go("/music-services") : modal.close());

  async function signOut(account: ExternalServiceAccount) {
    try {
      await saveSignOut(account.service_id, account.id);
      serviceManager.notify();
      showToast(t("playback.signedOut", { service: serviceName(account.service_id) }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function remove(account: ExternalServiceAccount) {
    if (!window.confirm(t("playback.confirmDeleteAccount", { name: account.name }))) return;
    await deleteAccount(account.id).catch((error) => showToast(error instanceof Error ? error.message : String(error)));
    serviceManager.notify();
  }

  return (
    <Card>
      <div className="stack">
        <div className="panel-head">
          <div>
            <div className="panel-title">{t("playback.servicesTitle")}</div>
            <p className="muted">{t("playback.servicesIntro")}</p>
          </div>
          <Button size="sm" tone="primary" onClick={modal.openNew}>
            {t("playback.addAccount")}
          </Button>
        </div>

        <section className="stack" aria-labelledby="music-services-list">
          <h3 id="music-services-list" className="section-title">
            {t("playback.services")}
          </h3>
          {services.filter((s) => hasAspect(s, mediaAspect) || hasAspect(s, musicAspect)).length === 0 ? (
            <p className="muted">{t("playback.noServices")}</p>
          ) : (
            <ul className="music-services">
              {services
                .filter((s) => hasAspect(s, mediaAspect) || hasAspect(s, musicAspect) || hasAspect(s, authAspect))
                .map((service) => (
                  <ServiceRow key={service.id} service={service} />
                ))}
            </ul>
          )}
        </section>

        <section className="stack" aria-labelledby="music-services-accounts">
          <h3 id="music-services-accounts" className="section-title">
            {t("playback.accounts")}
          </h3>
          {!accountsCache.loaded ? (
            <p className="muted">{t("app.loading")}</p>
          ) : accounts.length === 0 ? (
            <EmptyState items={t("playback.accountItems")} actionLabel={t("playback.addAccount")} onAction={modal.openNew} />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("playback.accountName")}</th>
                  <th>{t("playback.service")}</th>
                  <th>{t("playback.status")}</th>
                  <th>{t("playback.signedInAt")}</th>
                  <th className="action-row-cell" aria-label={t("actions.more", { name: "" })} />
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const actions: MenuAction[] = [
                    { key: "edit", label: t("actions.edit"), onSelect: () => modal.openEdit(entityKey(account)) },
                    account.status === "signed_in"
                      ? { key: "sign-out", label: t("playback.signOut"), onSelect: () => void signOut(account) }
                      : { key: "sign-in", label: t("playback.signIn"), onSelect: () => modal.openEdit(entityKey(account)) },
                    { key: "delete", label: t("actions.delete"), tone: "danger", onSelect: () => void remove(account) },
                  ];
                  return (
                    <tr key={account.id} className="action-row" onClick={() => modal.openEdit(entityKey(account))}>
                      <td className="wrap">{account.name}</td>
                      <td>{serviceName(account.service_id)}</td>
                      <td>
                        <span className={account.status === "signed_in" ? "status-pill status-pill--ok" : "status-pill"}>
                          {account.status === "signed_in" ? t("playback.signedIn") : t("playback.signedOutStatus")}
                        </span>
                      </td>
                      <td>{account.signed_in_at ? dates.format(new Date(account.signed_in_at)) : "—"}</td>
                      <td className="action-row-cell">
                        <ActionMenu name={account.name} uri={toEntityUri("external_service_account", account.id)} actions={actions} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {sheetOpen ? <AccountSheet key={editing?.id ?? signInFor ?? "new"} account={editing} serviceId={signInFor} onClose={closeSheet} /> : null}
    </Card>
  );
}

/** A service: what it can do, and signing it in or out. */
function ServiceRow({ service }: { service: Service }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const auth = hasAspect(service, authAspect) ? (service as AuthAspect) : null;
  const account = auth?.getAccount() ?? null;
  const can = [
    hasAspect(service, mediaAspect) ? t("playback.canPlay") : null,
    hasAspect(service, musicAspect) ? t("playback.canResolve") : null,
    hasAspect(service, catalogueAspect) ? t("playback.canSearch") : null,
    auth ? t("playback.canSignIn") : null,
  ].filter(Boolean);
  return (
    <li className="music-service">
      <div className="music-service__text">
        <span className="music-service__name">{service.name}</span>
        <span className="muted">{can.join(" · ")}</span>
      </div>
      {auth ? (
        <div className="row-actions">
          {account ? <span className="muted">{t("playback.signedInAs", { name: account.name })}</span> : null}
          {account ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void Promise.resolve(auth.logout()).then(() => {
                  serviceManager.notify();
                  showToast(t("playback.signedOut", { service: service.name }));
                })
              }
            >
              {t("playback.signOut")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void auth.login({ navigate: go })}>
              {t("playback.signIn")}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * An account's sheet: which service, its name (and the external account id), and a key or token,
 * which is only ever written (it shows as "saved" once there is one). Signing in from a service
 * (`/music-services/<service>/sign-in`) opens it for that service.
 */
function AccountSheet({ account, serviceId, onClose }: { account?: ExternalServiceAccount; serviceId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const services = useServicesList().filter((s) => hasAspect(s, authAspect));
  const [service, setService] = useState(account?.service_id ?? serviceId ?? services[0]?.id ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [externalId, setExternalId] = useState(account?.external_id ?? "");
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = services.find((s) => s.id === service)?.name ?? service;
  const isYouTube = service === "youtube";

  return (
    <EntitySheet
      title={account ? account.name : serviceId ? t("playback.signInTo", { service: label }) : t("playback.addAccount")}
      subtitle={t("playback.accountSubtitle")}
      uri={account ? toEntityUri("external_service_account", account.id) : undefined}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!service || !name.trim()) return;
        setSaving(true);
        setError(null);
        try {
          const secretValue = clearSecret ? null : secret.trim() ? { apiKey: secret.trim() } : undefined;
          // Saving signs the account in (a signed-out one again); it stays the service's one session.
          await saveSignIn(service, { id: account?.id, name, externalId: externalId.trim() || undefined }, secretValue);
          showToast(t("playback.signedInTo", { service: label }));
          serviceManager.notify();
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
        } finally {
          setSaving(false);
        }
      }}
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("form.cancel")}
          onDelete={
            account
              ? () => {
                  if (!window.confirm(t("playback.confirmDeleteAccount", { name: account.name }))) return;
                  void deleteAccount(account.id).then(() => {
                    serviceManager.notify();
                    onClose();
                  });
                }
              : undefined
          }
          deleteLabel={t("actions.delete")}
          submitLabel={account && account.status === "signed_in" ? t("form.save") : t("playback.signIn")}
          saving={saving}
          submitDisabled={!service || !name.trim()}
        />
      }
      preview={
        <div className="entity-preview">
          <div>
            <div className="entity-preview__kind">{label || t("playback.service")}</div>
            <div className="entity-preview__label">{name.trim() || t("playback.accountName")}</div>
          </div>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("playback.status")}</dt>
              <dd>{account?.status === "signed_in" ? t("playback.signedIn") : account ? t("playback.signedOutStatus") : t("playback.notYet")}</dd>
            </div>
            <div>
              <dt>{t("playback.secret")}</dt>
              <dd>{clearSecret ? t("playback.secretRemoved") : secret ? t("playback.secretNew") : account?.has_secret ? t("playback.secretSaved") : t("playback.secretNone")}</dd>
            </div>
          </dl>
          <p className="entity-preview__note">{t("playback.privateNote")}</p>
        </div>
      }
    >
      <div className="stack">
        <Select label={t("playback.service")} value={service} disabled={!!account} onChange={(e) => setService(e.target.value)} required>
          {services.length === 0 ? <option value="">{t("playback.noServices")}</option> : null}
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {account && !services.some((s) => s.id === account.service_id) ? <option value={account.service_id}>{account.service_id}</option> : null}
        </Select>
        <Input label={t("playback.accountName")} hint={t("playback.accountNameHint")} required value={name} onChange={(e) => setName(e.target.value)} />
        <Input label={t("playback.externalId")} hint={t("playback.externalIdHint")} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
        <Input
          label={isYouTube ? t("playback.youtubeKey") : t("playback.secret")}
          hint={isYouTube ? t("playback.youtubeKeyHint") : t("playback.secretHint")}
          type="password"
          autoComplete="off"
          placeholder={account?.has_secret ? t("playback.secretSaved") : undefined}
          value={secret}
          onChange={(e) => {
            setSecret(e.target.value);
            setClearSecret(false);
          }}
        />
        {account?.has_secret ? (
          <label className="bungalow-check">
            <input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} />
            <span>{t("playback.removeSecret")}</span>
          </label>
        ) : null}
        {error ? <p className="bungalow-help bungalow-help--error">{error}</p> : null}
      </div>
    </EntitySheet>
  );
}
