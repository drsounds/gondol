import { Alert, Card } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { formatCredits, useAiCreditScopes, useAiCreditUsage, useAiCredits, type AiCreditTierState } from "../../../../models";
import { CreditPie } from "../components/CreditPie";
import { AiCreditRatesSection, AiCreditTiersSection, appName, useAiCreditFormat } from "../components/AiCreditAdmin";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

/**
 * AI credits (`/ai-credits`): what the account has left here (this site, the open workspace), each
 * tier that gives it credits with when they come back, and its latest charges. Owners of sites and
 * owners and admins of workspaces also manage their tiers and per-token rates below, with
 * `/ai-credits/tiers/{new,<id>/edit}` and `/ai-credits/rates/{new,<id>/edit}` as the routed sheets.
 */
export function AiCreditsPage(_props: AppFeaturePageProps) {
  const { t, intlLocale } = useI18n();
  const credits = useAiCredits();
  const usage = useAiCreditUsage();
  const scopes = useAiCreditScopes();
  const { dateTime } = useAiCreditFormat();
  const state = credits.data;

  return (
    <div className="stack ai-credits">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("ai.credits.title")}</h2>
          <p className="muted">{t("ai.credits.intro")}</p>
        </div>
      </div>

      {credits.error ? <Alert tone="danger">{errorText(credits.error)}</Alert> : null}

      <Card>
        {credits.isLoading ? (
          <p className="muted">{t("app.loading")}</p>
        ) : !state?.limited ? (
          <div className="ai-credits__balance">
            <CreditPie remaining={1} total={1} size={88} />
            <div className="stack">
              <div className="ai-credits__amount">{t("ai.credits.unlimited")}</div>
              <p className="muted">{t("ai.credits.unlimitedIntro")}</p>
            </div>
          </div>
        ) : (
          <div className="ai-credits__balance">
            <CreditPie remaining={state.remaining} total={state.total} size={88} label={t("ai.credits.pieLabel", { left: formatCredits(state.remaining, intlLocale), total: formatCredits(state.total, intlLocale) })} />
            <div className="stack">
              <div className="ai-credits__amount">
                {t("ai.credits.left", { left: formatCredits(state.remaining, intlLocale), total: formatCredits(state.total, intlLocale) })}
              </div>
              {!state.allowed ? <Alert tone="warning">{t("ai.credits.spent")}</Alert> : null}
              <p className="muted">
                {state.nextRefillAt ? t("ai.credits.nextRefill", { when: dateTime(state.nextRefillAt) }) : t("ai.credits.noRefill")}
              </p>
            </div>
          </div>
        )}
      </Card>

      {state?.limited ? (
        <section className="stack">
          <h3 className="panel-title">{t("ai.credits.yourTiers")}</h3>
          <table className="data-table ai-credits__table">
            <thead>
              <tr>
                <th>{t("ai.credits.tier")}</th>
                <th>{t("ai.credits.from")}</th>
                <th>{t("ai.credits.leftColumn")}</th>
                <th>{t("ai.credits.refills")}</th>
                <th>{t("ai.credits.limitedTo")}</th>
              </tr>
            </thead>
            <tbody>
              {state.tiers.map((tier) => (
                <TierRow key={tier.id} tier={tier} />
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="stack">
        <h3 className="panel-title">{t("ai.credits.usage")}</h3>
        {usage.error ? <Alert tone="danger">{errorText(usage.error)}</Alert> : null}
        {usage.isLoading ? (
          <p className="muted">{t("app.loading")}</p>
        ) : !usage.data?.length ? (
          <EmptyState items={t("ai.credits.usageItems")} description={t("ai.credits.usageEmpty")} />
        ) : (
          <table className="data-table ai-credits__table">
            <thead>
              <tr>
                <th>{t("ai.credits.when")}</th>
                <th>{t("ai.credits.app")}</th>
                <th>{t("ai.credits.model")}</th>
                <th>{t("ai.credits.tokens")}</th>
                <th>{t("ai.credits.credits")}</th>
              </tr>
            </thead>
            <tbody>
              {usage.data.map((row) => (
                <tr key={row.id}>
                  <td className="data-table__title">{dateTime(row.created_at)}</td>
                  <td>{appName(row.app_id)}</td>
                  <td className="muted">{[row.provider, row.model].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="muted">{t("ai.credits.tokensInOut", { input: row.input_tokens.toLocaleString(intlLocale), output: row.output_tokens.toLocaleString(intlLocale) })}</td>
                  <td className="data-table__keep">{formatCredits(Number(row.credits), intlLocale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {scopes.data?.length ? (
        <>
          <AiCreditTiersSection scopes={scopes.data} />
          <AiCreditRatesSection scopes={scopes.data} />
        </>
      ) : null}
    </div>
  );
}

function TierRow({ tier }: { tier: AiCreditTierState }) {
  const { t, intlLocale } = useI18n();
  const { dateTime, limits } = useAiCreditFormat();
  return (
    <tr>
      <td className="data-table__title">
        <span className="ai-credits__tier-name">
          <CreditPie remaining={tier.remaining} total={tier.credits} size={18} />
          {tier.name}
        </span>
      </td>
      <td className="muted">{t(tier.scope === "site" ? "ai.credits.scopeSite" : "ai.credits.scopeWorkspace", { name: tier.scopeName })}</td>
      <td className="data-table__keep">
        {t("ai.credits.left", { left: formatCredits(tier.remaining, intlLocale), total: formatCredits(tier.credits, intlLocale) })}
        {tier.shared ? <span className="muted"> · {t("ai.credits.sharedShort")}</span> : null}
      </td>
      <td className="muted">{tier.periodEnd ? dateTime(tier.periodEnd) : t("ai.credits.once")}</td>
      <td className="muted">{limits(tier) || t("ai.credits.anything")}</td>
    </tr>
  );
}
