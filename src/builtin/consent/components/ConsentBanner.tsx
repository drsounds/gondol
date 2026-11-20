import { useEffect, useId, useState } from "react";
import { Button } from "../../../design-system/bungalow-79d923";
import { useI18n } from "../../../i18n/i18n";
import { useConsent } from "../models";
import { ConsentChoices } from "./ConsentChoices";
import { useInAppLink } from "./links";

/**
 * The cookie notice: shown at the bottom until the user answers for the current policy. "Reject
 * all" and "Accept all" are equally prominent, and "Choose" lets them pick per category. The app
 * renders it in the shell (an overlay widget); a host renders it on screens outside the shell too
 * (sign-in, a public site), so the notice is there from the very first visit.
 */
export function ConsentBanner({ policyPath = "/privacy" }: { policyPath?: string }) {
  const { t } = useI18n();
  const consent = useConsent();
  const link = useInAppLink();
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState<Record<string, boolean>>({});

  // The choice lives in localStorage: render nothing on the server and on the first client pass.
  useEffect(() => setMounted(true), []);
  if (!mounted || consent.decided) return null;

  return (
    <section className="consent-banner" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className="consent-banner__body">
        <h2 id={titleId} className="consent-banner__title">
          {t("consent.title")}
        </h2>
        <p className="consent-banner__text">
          {t("consent.body")}{" "}
          <a className="consent-banner__link" {...link(policyPath)}>
            {t("consent.readPolicy")}
          </a>
        </p>
        {choosing ? <ConsentChoices value={choice} onChange={setChoice} /> : null}
      </div>
      <div className="consent-banner__actions">
        {choosing ? (
          <Button type="button" variant="outline" size="sm" onClick={() => consent.set(choice)}>
            {t("consent.save")}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setChoosing(true)}>
            {t("consent.choose")}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={consent.rejectAll}>
          {t("consent.rejectAll")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={consent.acceptAll}>
          {t("consent.acceptAll")}
        </Button>
      </div>
    </section>
  );
}
