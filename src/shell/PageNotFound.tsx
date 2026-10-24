import { Button } from "../design-system/bungalow-79d923";
import { useNavigateKeepingSearch } from "../navigation/useEntityModal";
import { useI18n } from "../i18n/i18n";

/**
 * The standard "Page not found": for paths no view matches, and for anything the site served here
 * leaves out (an app, a feature or an entity type), which it never names.
 */
export function PageNotFound() {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  return (
    <div className="empty-state page-not-found">
      <p className="empty-state__title">{t("notFound.title")}</p>
      <p className="empty-state__text">{t("notFound.description")}</p>
      <Button variant="outline" onClick={() => go("/")}>
        {t("notFound.home")}
      </Button>
    </div>
  );
}
