import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { useEntityModal } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { getInternalApps } from "../../../../../../apps/registry";
import { useRegisteredBundles } from "../../../../../../apps/hooks";
import {
  AI_CREDIT_INTERVALS,
  AI_CREDIT_ROLES,
  formatCredits,
  getAiProviders,
  useAiCreditRates,
  useAiCreditTiers,
  useDeleteAiCreditRate,
  useDeleteAiCreditTier,
  useSaveAiCreditRate,
  useSaveAiCreditTier,
  type AiCreditInterval,
  type AiCreditRate,
  type AiCreditScope,
  type AiCreditTier,
} from "../../../../models";
import { CreditPie } from "./CreditPie";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

/** An app's name, from the apps on this host; its id when it isn't one of them. */
export function appName(id: string): string {
  return getInternalApps().find((app) => app.id === id)?.name ?? id;
}

const providerName = (id: string) => getAiProviders().find((p) => p.id === id)?.name ?? id;

/** Dates, intervals and a tier's limits as the credits page shows them. */
export function useAiCreditFormat() {
  const { t, intlLocale } = useI18n();
  return useMemo(() => {
    const dateTime = (iso: string) => new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
    const interval = (value: AiCreditInterval) => t(`ai.credits.interval.${value}` as Parameters<typeof t>[0]);
    const limits = (tier: { apps: string[]; providers: string[]; models: string[] }) =>
      [tier.apps.map(appName).join(", "), tier.providers.map(providerName).join(", "), tier.models.join(", ")].filter(Boolean).join(" · ");
    return { dateTime, interval, limits };
  }, [t, intlLocale]);
}

function roleNames(t: ReturnType<typeof useI18n>["t"], roles: string[]): string {
  return roles.map((role) => t(`ai.credits.role.${role}` as Parameters<typeof t>[0])).join(", ");
}

function scopeLabel(t: ReturnType<typeof useI18n>["t"], scopes: AiCreditScope[], scope: string, id: string): string {
  const found = scopes.find((s) => s.scope === scope && s.scope_id === id);
  return t(scope === "site" ? "ai.credits.scopeSite" : "ai.credits.scopeWorkspace", { name: found?.name ?? "—" });
}

const scopeKey = (scope: string, id: string) => `${scope}:${id}`;

function splitList(value: string): string[] {
  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))].slice(0, 100);
}

/** An ISO time as a datetime-local value, in the browser's time zone. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

// --- Tiers ---------------------------------------------------------------------------------------

/** The tiers of the sites and workspaces the user manages, with `/ai-credits/tiers/…` sheets. */
export function AiCreditTiersSection({ scopes }: { scopes: AiCreditScope[] }) {
  const { t, intlLocale } = useI18n();
  const { interval, limits } = useAiCreditFormat();
  const tiers = useAiCreditTiers();
  const rows = tiers.data ?? [];
  const modal = useEntityModal("/ai-credits/tiers", "/ai-credits");
  const editing = modal.mode === "edit" ? rows.find((row) => row.id === modal.id) : undefined;
  const save = useSaveAiCreditTier();
  const remove = useDeleteAiCreditTier();

  function deleteTier(row: AiCreditTier) {
    if (!window.confirm(t("ai.credits.tiers.confirmDelete", { name: row.name }))) return;
    remove.mutate(row.id, { onSuccess: () => (modal.mode === "edit" ? modal.close() : undefined) });
  }

  return (
    <section className="stack ai-credit-tiers">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("ai.credits.tiers.title")}</h2>
          <p className="muted">{t("ai.credits.tiers.intro")}</p>
        </div>
        <Button size="sm" tone="primary" onClick={modal.openNew}>
          {t("ai.credits.tiers.new")}
        </Button>
      </div>

      {tiers.error ? <Alert tone="danger">{errorText(tiers.error)}</Alert> : null}
      {remove.error ? <Alert tone="danger">{errorText(remove.error)}</Alert> : null}

      {tiers.isLoading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState items={t("ai.credits.tiers.items")} actionLabel={t("ai.credits.tiers.new")} onAction={modal.openNew} />
      ) : (
        <table className="data-table ai-credits__table">
          <thead>
            <tr>
              <th>{t("ai.credits.tiers.name")}</th>
              <th>{t("ai.credits.tiers.scope")}</th>
              <th>{t("ai.credits.tiers.credits")}</th>
              <th>{t("ai.credits.limitedTo")}</th>
              <th>{t("ai.credits.tiers.status")}</th>
              <th className="action-row-cell" aria-label={t("ai.credits.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="action-row">
                <td>{row.name}</td>
                <td className="muted">{scopeLabel(t, scopes, row.scope, row.scope_id)}</td>
                <td className="data-table__keep">
                  {t("ai.credits.perInterval", { credits: formatCredits(row.credits, intlLocale), interval: interval(row.interval) })}
                  {row.shared ? <span className="muted"> · {t("ai.credits.sharedShort")}</span> : null}
                </td>
                <td className="muted">{[limits(row), roleNames(t, row.roles)].filter(Boolean).join(" · ") || t("ai.credits.anything")}</td>
                <td className="muted">{row.enabled ? t("ai.credits.on") : t("ai.credits.off")}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={row.name}
                    actions={[
                      { key: "edit", label: t("ai.credits.edit"), onSelect: () => modal.openEdit(row.id) },
                      {
                        key: "toggle",
                        label: row.enabled ? t("ai.credits.turnOff") : t("ai.credits.turnOn"),
                        aspects: ["configure"],
                        onSelect: () => save.mutate({ id: row.id, enabled: !row.enabled }),
                      },
                      { key: "delete", label: t("ai.credits.delete"), tone: "danger", onSelect: () => deleteTier(row) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal.mode === "new" ? <TierSheet scopes={scopes} onClose={modal.close} /> : null}
      {modal.mode === "edit" && editing ? (
        <TierSheet scopes={scopes} tier={editing} onClose={modal.close} onDelete={() => deleteTier(editing)} deleting={remove.isPending} />
      ) : null}
    </section>
  );
}

interface TierValues {
  scope: string;
  name: string;
  description: string;
  credits: string;
  interval: AiCreditInterval;
  startsAt: string;
  endsAt: string;
  shared: boolean;
  apps: string[];
  providers: string[];
  models: string;
  roles: string[];
  priority: string;
  enabled: boolean;
}

function toggle(list: string[], value: string, on: boolean): string[] {
  return on ? [...new Set([...list, value])] : list.filter((item) => item !== value);
}

function TierSheet({
  scopes,
  tier,
  onClose,
  onDelete,
  deleting,
}: {
  scopes: AiCreditScope[];
  tier?: AiCreditTier;
  onClose: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t, intlLocale } = useI18n();
  const { interval: intervalName } = useAiCreditFormat();
  const save = useSaveAiCreditTier();
  const apps = useRegisteredBundles();
  const providers = getAiProviders();
  const initial = (from?: AiCreditTier): TierValues => ({
    scope: from ? scopeKey(from.scope, from.scope_id) : scopes[0] ? scopeKey(scopes[0].scope, scopes[0].scope_id) : "",
    name: from?.name ?? "",
    description: from?.description ?? "",
    credits: from ? String(from.credits) : "1000",
    interval: from?.interval ?? "month",
    startsAt: toLocalInput(from?.starts_at ?? firstOfMonth()),
    endsAt: toLocalInput(from?.ends_at),
    shared: from?.shared ?? false,
    apps: from?.apps ?? [],
    providers: from?.providers ?? [],
    models: (from?.models ?? []).join(", "),
    roles: from?.roles ?? [],
    priority: String(from?.priority ?? 0),
    enabled: from?.enabled ?? true,
  });
  const [values, setValues] = useState<TierValues>(() => initial(tier));
  useEffect(() => {
    if (tier) setValues(initial(tier));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier]);
  const set = <K extends keyof TierValues>(key: K, value: TierValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const [scope, scopeId] = values.scope.split(":");
  const credits = Number(values.credits);
  const isWorkspace = scope === "workspace";
  const roleChoices = AI_CREDIT_ROLES.filter((role) => (isWorkspace ? role !== "visitor" : role === "owner" || role === "member" || role === "visitor"));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save.mutateAsync({
      ...(tier ? { id: tier.id } : {}),
      scope: scope as AiCreditTier["scope"],
      scope_id: scopeId,
      name: values.name.trim(),
      description: values.description.trim() || null,
      credits,
      interval: values.interval,
      starts_at: fromLocalInput(values.startsAt) ?? new Date().toISOString(),
      ends_at: fromLocalInput(values.endsAt),
      shared: values.shared,
      apps: values.apps,
      providers: values.providers,
      models: splitList(values.models),
      roles: values.roles.filter((role) => (roleChoices as readonly string[]).includes(role)),
      priority: Math.round(Number(values.priority) || 0),
      enabled: values.enabled,
    });
    onClose();
  }

  const preview = { apps: values.apps, providers: values.providers, models: splitList(values.models) };
  const { limits } = useAiCreditFormat();

  return (
    <EntitySheet
      title={tier ? t("ai.credits.tiers.editTitle") : t("ai.credits.tiers.newTitle")}
      subtitle={t("ai.credits.tiers.subtitle")}
      onClose={onClose}
      closeLabel={t("ai.credits.close")}
      onSubmit={(e) => void submit(e).catch(() => undefined)}
      preview={
        <div className="entity-preview">
          <span className="entity-preview__kind">{t("ai.credits.tiers.kind")}</span>
          <span className="entity-preview__label">{values.name || t("ai.untitled")}</span>
          <div className="ai-credits__preview-amount">
            <CreditPie remaining={1} total={1} size={40} />
            <span className="entity-preview__amount">
              {t("ai.credits.perInterval", { credits: formatCredits(Number.isFinite(credits) ? credits : 0, intlLocale), interval: intervalName(values.interval) })}
            </span>
          </div>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("ai.credits.tiers.scope")}</dt>
              <dd>{scope ? scopeLabel(t, scopes, scope, scopeId) : "—"}</dd>
            </div>
            <div>
              <dt>{t("ai.credits.tiers.who")}</dt>
              <dd>
                {[values.roles.length ? roleNames(t, values.roles) : t("ai.credits.tiers.everyone"), values.shared ? t("ai.credits.sharedShort") : t("ai.credits.tiers.each")].join(" · ")}
              </dd>
            </div>
            <div>
              <dt>{t("ai.credits.limitedTo")}</dt>
              <dd>{limits(preview) || t("ai.credits.anything")}</dd>
            </div>
            <div>
              <dt>{t("ai.credits.tiers.status")}</dt>
              <dd>{values.enabled ? t("ai.credits.on") : t("ai.credits.off")}</dd>
            </div>
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("ai.credits.cancel")}
          onDelete={onDelete}
          deleteLabel={t("ai.credits.delete")}
          deleting={deleting}
          submitLabel={tier ? t("ai.credits.save") : t("ai.credits.create")}
          saving={save.isPending}
        />
      }
    >
      <div className="stack">
        {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
        <Select label={t("ai.credits.tiers.scope")} hint={t("ai.credits.tiers.scopeHint")} value={values.scope} onChange={(e) => set("scope", e.target.value)} required>
          {scopes.map((s) => (
            <option key={scopeKey(s.scope, s.scope_id)} value={scopeKey(s.scope, s.scope_id)}>
              {scopeLabel(t, scopes, s.scope, s.scope_id)}
            </option>
          ))}
        </Select>
        <Input label={t("ai.credits.tiers.name")} value={values.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} autoFocus />
        <Input label={t("ai.credits.tiers.description")} value={values.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} />
        <div className="ai-credits__row">
          <Input label={t("ai.credits.tiers.credits")} type="number" min={0.01} step="any" value={values.credits} onChange={(e) => set("credits", e.target.value)} required />
          <Select label={t("ai.credits.tiers.interval")} value={values.interval} onChange={(e) => set("interval", e.target.value as AiCreditInterval)}>
            {AI_CREDIT_INTERVALS.map((value) => (
              <option key={value} value={value}>
                {intervalName(value)}
              </option>
            ))}
          </Select>
        </div>
        <div className="ai-credits__row">
          <Input label={t("ai.credits.tiers.startsAt")} hint={t("ai.credits.tiers.startsAtHint")} type="datetime-local" value={values.startsAt} onChange={(e) => set("startsAt", e.target.value)} required />
          <Input label={t("ai.credits.tiers.endsAt")} hint={t("ai.credits.tiers.endsAtHint")} type="datetime-local" value={values.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
        </div>
        <Checkbox label={t("ai.credits.tiers.shared")} checked={values.shared} onChange={(e) => set("shared", e.target.checked)} />
        <fieldset className="ai-credits__choices">
          <legend>{t("ai.credits.tiers.roles")}</legend>
          <p className="muted">{t("ai.credits.tiers.rolesHint")}</p>
          {roleChoices.map((role) => (
            <Checkbox key={role} label={t(`ai.credits.role.${role}` as Parameters<typeof t>[0])} checked={values.roles.includes(role)} onChange={(e) => set("roles", toggle(values.roles, role, e.target.checked))} />
          ))}
        </fieldset>
        <fieldset className="ai-credits__choices">
          <legend>{t("ai.credits.tiers.apps")}</legend>
          <p className="muted">{t("ai.credits.tiers.appsHint")}</p>
          {apps.map((app) => (
            <Checkbox key={app.id} label={app.name} checked={values.apps.includes(app.id)} onChange={(e) => set("apps", toggle(values.apps, app.id, e.target.checked))} />
          ))}
        </fieldset>
        <fieldset className="ai-credits__choices">
          <legend>{t("ai.credits.tiers.providers")}</legend>
          <p className="muted">{t("ai.credits.tiers.providersHint")}</p>
          {providers.map((provider) => (
            <Checkbox
              key={provider.id}
              label={provider.name}
              checked={values.providers.includes(provider.id)}
              onChange={(e) => set("providers", toggle(values.providers, provider.id, e.target.checked))}
            />
          ))}
        </fieldset>
        <Input label={t("ai.credits.tiers.models")} hint={t("ai.credits.tiers.modelsHint")} value={values.models} onChange={(e) => set("models", e.target.value)} placeholder="gpt-4o*, llama3.2" maxLength={4000} />
        <Input label={t("ai.credits.tiers.priority")} hint={t("ai.credits.tiers.priorityHint")} type="number" step={1} min={-1000} max={1000} value={values.priority} onChange={(e) => set("priority", e.target.value)} />
        <Checkbox label={t("ai.credits.tiers.enabled")} checked={values.enabled} onChange={(e) => set("enabled", e.target.checked)} />
      </div>
    </EntitySheet>
  );
}

// --- Rates ---------------------------------------------------------------------------------------

/** What tokens cost in the sites and workspaces the user manages, with `/ai-credits/rates/…` sheets. */
export function AiCreditRatesSection({ scopes }: { scopes: AiCreditScope[] }) {
  const { t, intlLocale } = useI18n();
  const rates = useAiCreditRates();
  const rows = rates.data ?? [];
  const modal = useEntityModal("/ai-credits/rates", "/ai-credits");
  const editing = modal.mode === "edit" ? rows.find((row) => row.id === modal.id) : undefined;
  const remove = useDeleteAiCreditRate();

  function deleteRate(row: AiCreditRate) {
    if (!window.confirm(t("ai.credits.rates.confirmDelete"))) return;
    remove.mutate(row.id, { onSuccess: () => (modal.mode === "edit" ? modal.close() : undefined) });
  }

  return (
    <section className="stack ai-credit-rates">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("ai.credits.rates.title")}</h2>
          <p className="muted">{t("ai.credits.rates.intro")}</p>
        </div>
        <Button size="sm" tone="primary" onClick={modal.openNew}>
          {t("ai.credits.rates.new")}
        </Button>
      </div>

      {rates.error ? <Alert tone="danger">{errorText(rates.error)}</Alert> : null}
      {remove.error ? <Alert tone="danger">{errorText(remove.error)}</Alert> : null}

      {rates.isLoading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState items={t("ai.credits.rates.items")} description={t("ai.credits.rates.empty")} actionLabel={t("ai.credits.rates.new")} onAction={modal.openNew} />
      ) : (
        <table className="data-table ai-credits__table">
          <thead>
            <tr>
              <th>{t("ai.credits.rates.match")}</th>
              <th>{t("ai.credits.tiers.scope")}</th>
              <th>{t("ai.credits.rates.input")}</th>
              <th>{t("ai.credits.rates.output")}</th>
              <th className="action-row-cell" aria-label={t("ai.credits.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const match = [row.app_id ? appName(row.app_id) : null, row.provider ? providerName(row.provider) : null, row.model].filter(Boolean).join(" · ") || t("ai.credits.rates.everything");
              return (
                <tr key={row.id} className="action-row">
                  <td>{match}</td>
                  <td className="muted">{scopeLabel(t, scopes, row.scope, row.scope_id)}</td>
                  <td className="data-table__keep">{formatCredits(row.input_per_1k, intlLocale)}</td>
                  <td>{formatCredits(row.output_per_1k, intlLocale)}</td>
                  <td className="action-row-cell">
                    <ActionMenu
                      name={match}
                      actions={[
                        { key: "edit", label: t("ai.credits.edit"), onSelect: () => modal.openEdit(row.id) },
                        { key: "delete", label: t("ai.credits.delete"), tone: "danger", onSelect: () => deleteRate(row) },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {modal.mode === "new" ? <RateSheet scopes={scopes} onClose={modal.close} /> : null}
      {modal.mode === "edit" && editing ? (
        <RateSheet scopes={scopes} rate={editing} onClose={modal.close} onDelete={() => deleteRate(editing)} deleting={remove.isPending} />
      ) : null}
    </section>
  );
}

interface RateValues {
  scope: string;
  app: string;
  provider: string;
  model: string;
  input: string;
  output: string;
}

function RateSheet({
  scopes,
  rate,
  onClose,
  onDelete,
  deleting,
}: {
  scopes: AiCreditScope[];
  rate?: AiCreditRate;
  onClose: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t, intlLocale } = useI18n();
  const save = useSaveAiCreditRate();
  const apps = useRegisteredBundles();
  const providers = getAiProviders();
  const initial = (from?: AiCreditRate): RateValues => ({
    scope: from ? scopeKey(from.scope, from.scope_id) : scopes[0] ? scopeKey(scopes[0].scope, scopes[0].scope_id) : "",
    app: from?.app_id ?? "",
    provider: from?.provider ?? "",
    model: from?.model ?? "",
    input: String(from?.input_per_1k ?? 1),
    output: String(from?.output_per_1k ?? 1),
  });
  const [values, setValues] = useState<RateValues>(() => initial(rate));
  useEffect(() => {
    if (rate) setValues(initial(rate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);
  const set = <K extends keyof RateValues>(key: K, value: RateValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const [scope, scopeId] = values.scope.split(":");
  const input = Number(values.input);
  const output = Number(values.output);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save.mutateAsync({
      ...(rate ? { id: rate.id } : {}),
      scope: scope as AiCreditRate["scope"],
      scope_id: scopeId,
      app_id: values.app || null,
      provider: values.provider || null,
      model: values.model.trim() || null,
      input_per_1k: Number.isFinite(input) ? input : 1,
      output_per_1k: Number.isFinite(output) ? output : 1,
    });
    onClose();
  }

  const match = [values.app ? appName(values.app) : null, values.provider ? providerName(values.provider) : null, values.model.trim() || null].filter(Boolean).join(" · ") || t("ai.credits.rates.everything");

  return (
    <EntitySheet
      title={rate ? t("ai.credits.rates.editTitle") : t("ai.credits.rates.newTitle")}
      subtitle={t("ai.credits.rates.subtitle")}
      onClose={onClose}
      closeLabel={t("ai.credits.close")}
      onSubmit={(e) => void submit(e).catch(() => undefined)}
      preview={
        <div className="entity-preview">
          <span className="entity-preview__kind">{t("ai.credits.rates.kind")}</span>
          <span className="entity-preview__label">{match}</span>
          <span className="entity-preview__amount">
            {t("ai.credits.rates.example", {
              credits: formatCredits((Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0), intlLocale),
            })}
          </span>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("ai.credits.tiers.scope")}</dt>
              <dd>{scope ? scopeLabel(t, scopes, scope, scopeId) : "—"}</dd>
            </div>
            <div>
              <dt>{t("ai.credits.rates.input")}</dt>
              <dd>{formatCredits(Number.isFinite(input) ? input : 0, intlLocale)}</dd>
            </div>
            <div>
              <dt>{t("ai.credits.rates.output")}</dt>
              <dd>{formatCredits(Number.isFinite(output) ? output : 0, intlLocale)}</dd>
            </div>
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("ai.credits.cancel")}
          onDelete={onDelete}
          deleteLabel={t("ai.credits.delete")}
          deleting={deleting}
          submitLabel={rate ? t("ai.credits.save") : t("ai.credits.create")}
          saving={save.isPending}
        />
      }
    >
      <div className="stack">
        {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
        <Select label={t("ai.credits.tiers.scope")} value={values.scope} onChange={(e) => set("scope", e.target.value)} required>
          {scopes.map((s) => (
            <option key={scopeKey(s.scope, s.scope_id)} value={scopeKey(s.scope, s.scope_id)}>
              {scopeLabel(t, scopes, s.scope, s.scope_id)}
            </option>
          ))}
        </Select>
        <Select label={t("ai.credits.app")} value={values.app} onChange={(e) => set("app", e.target.value)}>
          <option value="">{t("ai.credits.rates.anyApp")}</option>
          {apps.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name}
            </option>
          ))}
        </Select>
        <Select label={t("ai.credits.rates.provider")} value={values.provider} onChange={(e) => set("provider", e.target.value)}>
          <option value="">{t("ai.credits.rates.anyProvider")}</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </Select>
        <Input label={t("ai.credits.model")} hint={t("ai.credits.rates.modelHint")} value={values.model} onChange={(e) => set("model", e.target.value)} placeholder="gpt-4o*" maxLength={200} />
        <div className="ai-credits__row">
          <Input label={t("ai.credits.rates.input")} type="number" min={0} step="any" value={values.input} onChange={(e) => set("input", e.target.value)} required />
          <Input label={t("ai.credits.rates.output")} type="number" min={0} step="any" value={values.output} onChange={(e) => set("output", e.target.value)} required />
        </div>
      </div>
    </EntitySheet>
  );
}
