import { Button } from "../../../design-system/bungalow-79d923";
import type { AppFeaturePageProps } from "../../../apps/types";
import { entityKey, findByEntityKey } from "../../../entities/slugs";
import { useI18n } from "../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../navigation/useEntityModal";
import { EmptyState } from "../../../shell/EmptyState";
import type { MessageKey } from "../../../register";
import { litePagePath, useLiteApps, useLiteRecords } from "../models/studio";
import { LitePageView } from "./LitePageView";
import { RecordSheet } from "./RecordSheet";

/** A built app's bundle id: `lite.<app id>` (../widgets/LiteAppsProvider). */
export const liteBundleId = (appId: string) => `lite.${appId}`;

/**
 * A page of an app built in the studio, at `/lite/<app>/<page>` (each app is a bundle of its own,
 * each page a feature of it). `…/records/new/<type>` and `…/records/<key>/edit` are the routed
 * record sheets.
 */
export function LiteAppPage({ appId, featureId, splat, onOpenUri }: AppFeaturePageProps) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const apps = useLiteApps();
  const app = (apps.data ?? []).find((a) => liteBundleId(a.id) === appId);
  const page = app?.pages.find((p) => p.key === featureId);
  const records = useLiteRecords(app?.id ?? null);

  if (apps.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  if (!app || !page) return <EmptyState items={t("studio.page.items")} description={t("studio.page.notFound")} />;

  const base = litePagePath(app, page);
  const rows = records.data ?? [];
  const parts = (splat ?? "").split("/").filter(Boolean);
  const close = () => go(base);
  let sheet = null;
  if (parts[0] === "records" && parts[1] === "new" && parts[2]) {
    const type = app.types.find((ty) => ty.key === parts[2]);
    if (type) sheet = <RecordSheet key={`new-${type.id}`} app={app} type={type} records={rows} onClose={close} />;
  } else if (parts[0] === "records" && parts[1] && parts[2] === "edit") {
    const record = findByEntityKey(rows, parts[1]);
    const type = record ? app.types.find((ty) => ty.id === record.type_id) : undefined;
    if (record && type) sheet = <RecordSheet key={record.id} app={app} type={type} record={record} records={rows} onClose={close} />;
  }

  return (
    <div className="stack studio-lite">
      <div className="studio-lite__bar">
        <Button size="sm" variant="ghost" onClick={() => go(`/studio/${entityKey(app)}/pages/${page.key}/edit`)}>
          {t("studio.page.editThis")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => go(`/studio/${entityKey(app)}/ask`)}>
          {t("studio.ask.button")}
        </Button>
      </div>
      <LitePageView
        app={app}
        page={page}
        records={rows}
        onNavigate={go}
        onOpenUri={onOpenUri}
        onOpenNew={(type) => go(`${base}/records/new/${type.key}`)}
        onOpenEdit={(record) => go(`${base}/records/${entityKey(record)}/edit`)}
      />
      {sheet}
    </div>
  );
}

export default LiteAppPage;
