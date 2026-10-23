import { Fragment } from "react";
import { getLocalizedText } from "../../../apps/types";
import { useI18n } from "../../../i18n/i18n";
import {
  consentCategories,
  getConsentConfig,
  getServices,
  getStorageItems,
  legalBasisOf,
  processesOutsideEea,
  privacyPolicy,
  type PolicyBlock,
  type PolicyLocale,
} from "../models";
import { policyLocale, useInAppLink } from "./links";

/**
 * The privacy policy in the user's language (Swedish or English): a table of contents, then each
 * section. Its tables are `.data-table`s, so on phones they show as list rows. Also rendered by a
 * host outside the shell, for visitors who aren't signed in.
 */
export function PrivacyPolicy({ cookiesPath = "/cookies" }: { cookiesPath?: string }) {
  const { t, locale, intlLocale } = useI18n();
  const lang = policyLocale(locale);
  const sections = privacyPolicy(lang);
  const link = useInAppLink();
  const updated = new Date(`${getConsentConfig().updatedOn}T12:00:00`).toLocaleDateString(intlLocale, { dateStyle: "long" });

  const block = (b: PolicyBlock, key: number) => {
    switch (b.kind) {
      case "p":
        return <p key={key}>{b.text}</p>;
      case "list":
        return (
          <ul key={key}>
            {b.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        );
      case "consent":
        return (
          <p key={key}>
            <a {...link(cookiesPath)}>{t("consent.settingsTitle")}</a>
          </p>
        );
      case "processors":
        return <ServicesTable key={key} lang={lang} />;
      case "storage":
        return <StorageTable key={key} lang={lang} />;
    }
  };

  return (
    <article className="privacy-policy" lang={lang}>
      <header className="privacy-policy__head">
        <h1 className="panel-title">{t("privacy.title")}</h1>
        <p className="muted">{t("privacy.updated", { date: updated })}</p>
      </header>
      <nav className="privacy-policy__toc" aria-label={t("privacy.contents")}>
        <ol>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#privacy-${s.id}`}>{s.heading}</a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((s, index) => (
        <section key={s.id} id={`privacy-${s.id}`} className="privacy-policy__section">
          <h2>
            {index + 1}. {s.heading}
          </h2>
          {s.blocks.map((b, i) => (
            <Fragment key={i}>{block(b, i)}</Fragment>
          ))}
        </section>
      ))}
    </article>
  );
}

/** "Sweden", "USA", "EU" in the user's language. */
function useCountryName() {
  const { t, intlLocale } = useI18n();
  return (code: string) => {
    const key = `privacy.location.${code}` as Parameters<typeof t>[0];
    const label = t(key);
    if (label !== key) return label;
    try {
      return new Intl.DisplayNames([intlLocale], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
}

const BASIS_KEYS = {
  consent: "privacy.basis.consent",
  contract: "privacy.basis.contract",
  legitimateInterest: "privacy.basis.legitimateInterest",
  legalObligation: "privacy.basis.legalObligation",
} as const;

function ServicesTable({ lang }: { lang: PolicyLocale }) {
  const { t } = useI18n();
  const country = useCountryName();
  const text = (value: Parameters<typeof getLocalizedText>[0]) => getLocalizedText(value, lang);
  return (
    <div className="privacy-policy__table">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("privacy.processor.name")}</th>
            <th>{t("privacy.processor.location")}</th>
            <th>{t("privacy.processor.purpose")}</th>
            <th>{t("privacy.processor.data")}</th>
            <th>{t("privacy.processor.basis")}</th>
          </tr>
        </thead>
        <tbody>
          {getServices().map((s) => (
            <tr key={s.id}>
              <td>
                {s.policyUrl ? (
                  <a href={s.policyUrl} target="_blank" rel="noreferrer noopener">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
                {s.provider ? <div className="stat-note">{s.provider}</div> : null}
                {s.appName ? <div className="stat-note">{t("privacy.processor.app", { app: s.appName })}</div> : null}
              </td>
              <td className="data-table__keep wrap">
                {s.countries.map(country).join(", ")}
                {s.domains?.length ? <div className="stat-note privacy-policy__domains">{s.domains.join(", ")}</div> : null}
              </td>
              <td className="wrap">{text(s.purpose)}</td>
              <td className="wrap">{text(s.data)}</td>
              <td className="wrap">
                {t(BASIS_KEYS[legalBasisOf(s)])}
                {processesOutsideEea(s) && s.transfer ? <div className="stat-note">{text(s.transfer)}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StorageTable({ lang }: { lang: PolicyLocale }) {
  const { t, locale } = useI18n();
  const categories = new Map(consentCategories().map((c) => [c.id, getLocalizedText(c.label, locale)]));
  return (
    <div className="privacy-policy__table">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("privacy.storage.name")}</th>
            <th>{t("privacy.storage.category")}</th>
            <th>{t("privacy.storage.purpose")}</th>
            <th>{t("privacy.storage.duration")}</th>
            <th>{t("privacy.storage.provider")}</th>
          </tr>
        </thead>
        <tbody>
          {getStorageItems().map((item) => (
            <tr key={`${item.provider}:${item.name}`}>
              <td>
                <code>{item.name}</code> <span className="stat-note">{item.kind}</span>
              </td>
              <td className="data-table__keep">{categories.get(item.category) ?? item.category}</td>
              <td className="wrap">{getLocalizedText(item.purpose, lang)}</td>
              <td>{getLocalizedText(item.duration, lang)}</td>
              <td>{item.provider}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
