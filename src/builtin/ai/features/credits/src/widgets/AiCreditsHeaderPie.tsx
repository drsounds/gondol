import { useI18n } from "../../../../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { formatCredits, useAiCredits } from "../../../../models";
import { CreditPie } from "../components/CreditPie";

/**
 * The credits left as a pie in the global header, left of the account menu (the ai app's
 * `headerWidgets`); opens `/ai-credits`. Nothing shows while AI is unlimited here.
 */
export function AiCreditsHeaderPie() {
  const { t, intlLocale } = useI18n();
  const go = useNavigateKeepingSearch();
  const { data: credits } = useAiCredits();
  if (!credits?.limited) return null;

  const left = formatCredits(credits.remaining, intlLocale);
  const total = formatCredits(credits.total, intlLocale);
  const refill = credits.nextRefillAt
    ? new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(credits.nextRefillAt))
    : null;
  const label = refill ? t("ai.credits.pieLabelRefill", { left, total, refill }) : t("ai.credits.pieLabel", { left, total });

  return (
    <button
      type="button"
      className={`chrome-nav-btn ai-credits-pie-button${credits.allowed ? "" : " ai-credits-pie-button--spent"}`}
      aria-label={label}
      title={label}
      data-tour="ai-credits"
      onClick={() => go("/ai-credits")}
    >
      <CreditPie remaining={credits.remaining} total={credits.total} />
    </button>
  );
}
