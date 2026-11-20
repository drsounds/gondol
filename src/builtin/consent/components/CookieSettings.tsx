import { useEffect, useState } from "react";
import { Button } from "../../../design-system/bungalow-79d923";
import { useI18n } from "../../../i18n/i18n";
import { useConsent } from "../models";
import { ConsentChoices } from "./ConsentChoices";
import { useInAppLink } from "./links";

/** The user's cookie choice on this device, to change or take back at any time. */
export function CookieSettings({ policyPath = "/privacy" }: { policyPath?: string }) {
  const { t, intlLocale } = useI18n();
  const consent = useConsent();
  const link = useInAppLink();
  const [choice, setChoice] = useState<Record<string, boolean>>(consent.state?.categories ?? {});
  const [saved, setSaved] = useState(false);

  // Follow a choice made elsewhere (the banner, another tab).
  useEffect(() => setChoice(consent.state?.categories ?? {}), [consent.state]);

  const save = (next: Record<string, boolean>) => {
    consent.set(next);
    setSaved(true);
  };

  return (
    <div className="stack cookie-settings">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("consent.settingsTitle")}</h2>
          <p className="muted">
            {t("consent.settingsIntro")}{" "}
            <a {...link(policyPath)}>{t("consent.readPolicy")}</a>
          </p>
        </div>
      </div>
      <p className="stat-note">
        {consent.state
          ? t("consent.decidedAt", { date: new Date(consent.state.decidedAt).toLocaleString(intlLocale, { dateStyle: "long", timeStyle: "short" }) })
          : t("consent.undecided")}
      </p>
      <ConsentChoices
        value={choice}
        onChange={(next) => {
          setChoice(next);
          setSaved(false);
        }}
      />
      <div className="row-actions cookie-settings__actions">
        <Button type="button" variant="outline" size="sm" onClick={() => save({})}>
          {t("consent.rejectAll")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            consent.acceptAll();
            setSaved(true);
          }}
        >
          {t("consent.acceptAll")}
        </Button>
        <Button type="button" size="sm" tone="primary" onClick={() => save(choice)}>
          {t("consent.save")}
        </Button>
      </div>
      {saved ? <p className="muted" role="status">{t("consent.saved")}</p> : null}
    </div>
  );
}
