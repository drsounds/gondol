import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button } from "../../../../../../design-system/bungalow-79d923";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { ActionMenu, type MenuAction } from "../../../../../../entities/ActionMenu";
import { entityKey, idForEntityKey } from "../../../../../../entities/slugs";
import { useI18n } from "../../../../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import type { MessageKey } from "../../../../../../register";
import { AskAgentSheet, LiteAppSheet, LitePageSheet, LiteRelationSheet, LiteTypeSheet } from "../../../../components/StudioSheets";
import { appUri, findLiteApp, firstLitePage, litePagePath, studioDb, useDeleteLiteApp, useDeleteLiteRow, useLiteApps, useLiteRecords } from "../../../../models/studio";
import type { LiteAppTree } from "../../../../models/types";

/**
 * The App Studio (`/studio`): the user's apps, each with its pages, entity types and relations.
 * `/studio/new`, `/studio/ask` (ask an agent to build one), `/studio/<app>/edit`, `/studio/<app>/ask`
 * and `/studio/<app>/{pages,types,relations}/{new,<key>/edit}` are the routed sheets;
 * `/studio/records/<key>` (where a lite_record URI points) forwards to the record's sheet on its
 * app's first page. The pages themselves live at `/lite/<app>/<page>` (./LiteAppPage).
 */
export function StudioPage({ splat }: AppFeaturePageProps) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const apps = useLiteApps();
  const parts = (splat ?? "").split("/").filter(Boolean);
  const rows = apps.data ?? [];

  if (parts[0] === "records" && parts[1]) return <RecordForward recordKey={parts[1]} apps={rows} loading={apps.isLoading} />;

  const app = parts[0] && parts[0] !== "new" && parts[0] !== "ask" ? findLiteApp(rows, parts[0]) : undefined;
  if (parts[0] && parts[0] !== "new" && parts[0] !== "ask") {
    if (apps.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
    if (!app) return <EmptyState items={t("studio.items")} description={t("studio.app.notFound")} />;
    return <LiteAppView app={app} rest={parts.slice(1)} />;
  }

  return (
    <div className="stack studio">
      <StudioList apps={rows} loading={apps.isLoading} error={apps.error} />
      {parts[0] === "new" ? <LiteAppSheet onClose={() => go("/studio")} onSaved={(saved) => go(`/studio/${entityKey(saved)}`)} /> : null}
      {parts[0] === "ask" ? <AskAgentSheet onClose={() => go("/studio")} onNavigate={go} /> : null}
    </div>
  );
}

function StudioList({ apps, loading, error }: { apps: LiteAppTree[]; loading: boolean; error: unknown }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const remove = useDeleteLiteApp();
  return (
    <>
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("studio.title")}</h2>
          <p className="muted">{t("studio.intro")}</p>
        </div>
        <div className="row-actions">
          <Button size="sm" variant="outline" onClick={() => go("/studio/ask")}>
            {t("studio.ask.button")}
          </Button>
          <Button size="sm" tone="primary" onClick={() => go("/studio/new")}>
            {t("studio.app.new")}
          </Button>
        </div>
      </div>
      {error ? <Alert tone="danger">{error instanceof Error ? error.message : String((error as { message?: string }).message ?? error)}</Alert> : null}
      {loading ? (
        <p className="muted">{t("app.loading" as MessageKey)}</p>
      ) : apps.length === 0 ? (
        <EmptyState items={t("studio.items")} actionLabel={t("studio.app.new")} onAction={() => go("/studio/new")} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("studio.app.name")}</th>
              <th>{t("studio.app.pages")}</th>
              <th>{t("studio.app.types")}</th>
              <th>{t("studio.app.inMenu")}</th>
              <th className="action-row-cell" aria-label={t("studio.actions")} />
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => {
              const first = firstLitePage(app);
              return (
                <tr key={app.id} className="action-row">
                  <td>
                    <button type="button" className="link-button" onClick={() => go(`/studio/${entityKey(app)}`)}>
                      {app.name}
                    </button>
                    {app.description ? <div className="muted">{app.description}</div> : null}
                  </td>
                  <td>{app.pages.length}</td>
                  <td>{app.types.length}</td>
                  <td>{app.in_menu ? "✓" : ""}</td>
                  <td className="action-row-cell">
                    <ActionMenu
                      name={app.name}
                      uri={appUri(app)}
                      actions={[
                        ...(first ? [{ key: "open", label: t("studio.app.open"), onSelect: () => go(litePagePath(app, first)) }] : []),
                        { key: "studio", label: t("studio.app.build"), onSelect: () => go(`/studio/${entityKey(app)}`) },
                        { key: "ask", label: t("studio.ask.button"), onSelect: () => go(`/studio/${entityKey(app)}/ask`) },
                        { key: "edit", label: t("studio.edit"), onSelect: () => go(`/studio/${entityKey(app)}/edit`) },
                        {
                          key: "delete",
                          label: t("studio.delete"),
                          tone: "danger",
                          onSelect: () => {
                            if (window.confirm(t("studio.app.confirmDelete", { name: app.name }))) remove.mutate(app.id);
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function Section({ title, addLabel, onAdd, items, empty, children }: { title: string; addLabel: string; onAdd: () => void; items: string; empty: boolean; children: ReactNode }) {
  return (
    <section className="stack studio-section">
      <div className="panel-head">
        <h3 className="panel-title">{title}</h3>
        <Button size="sm" tone="primary" onClick={onAdd}>
          {addLabel}
        </Button>
      </div>
      {empty ? <EmptyState items={items} actionLabel={addLabel} onAction={onAdd} /> : children}
    </section>
  );
}

/** One app in the studio: its pages, entity types and relations, and the sheets under it. */
function LiteAppView({ app, rest }: { app: LiteAppTree; rest: string[] }) {
  const { t, intlLocale } = useI18n();
  const go = useNavigateKeepingSearch();
  const base = `/studio/${entityKey(app)}`;
  const close = () => go(base);
  const removePage = useDeleteLiteRow("lite_app_pages");
  const removeType = useDeleteLiteRow("lite_entity_types");
  const removeRelation = useDeleteLiteRow("lite_entity_relations");
  const records = useLiteRecords(app.id);
  const first = firstLitePage(app);
  const typeName = (id: string | null) => app.types.find((type) => type.id === id)?.name ?? "—";
  const count = (typeId: string) => (records.data ?? []).filter((record) => record.type_id === typeId).length;

  const [section, key, action] = rest;
  const editing = action === "edit" && key;
  const sheet =
    section === "edit" ? (
      <LiteAppSheet app={app} onClose={close} onSaved={(saved) => go(`/studio/${entityKey(saved)}`)} />
    ) : section === "ask" ? (
      <AskAgentSheet app={app} onClose={close} onNavigate={go} />
    ) : section === "pages" && (key === "new" || editing) ? (
      <LitePageSheet key={key} app={app} page={editing ? app.pages.find((page) => page.key === key) : undefined} onClose={close} onSaved={close} />
    ) : section === "types" && (key === "new" || editing) ? (
      <LiteTypeSheet key={key} app={app} type={editing ? app.types.find((type) => type.key === key) : undefined} onClose={close} onSaved={close} />
    ) : section === "relations" && (key === "new" || editing) ? (
      <LiteRelationSheet key={key} app={app} relation={editing ? app.relations.find((relation) => relation.key === key) : undefined} onClose={close} onSaved={close} />
    ) : null;

  const rowMenu = (name: string, actions: MenuAction[]) => (
    <td className="action-row-cell">
      <ActionMenu name={name} actions={actions} />
    </td>
  );
  const confirmDelete = (name: string, run: () => void) => {
    if (window.confirm(t("studio.confirmDelete", { name }))) run();
  };

  return (
    <div className="stack studio studio-app">
      <div className="panel-head">
        <div>
          <button type="button" className="link-button muted" onClick={() => go("/studio")}>
            ← {t("studio.title")}
          </button>
          <h2 className="panel-title">{app.name}</h2>
          {app.description ? <p className="muted">{app.description}</p> : null}
        </div>
        <div className="row-actions">
          {first ? (
            <Button size="sm" variant="ghost" onClick={() => go(litePagePath(app, first))}>
              {t("studio.app.open")}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => go(`${base}/edit`)}>
            {t("studio.edit")}
          </Button>
          <Button size="sm" tone="primary" onClick={() => go(`${base}/ask`)}>
            {t("studio.ask.button")}
          </Button>
        </div>
      </div>

      <Section title={t("studio.app.pages")} addLabel={t("studio.page.new")} onAdd={() => go(`${base}/pages/new`)} items={t("studio.page.items")} empty={!app.pages.length}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("studio.page.title")}</th>
              <th>{t("studio.page.format")}</th>
              <th>{t("studio.page.inMenu")}</th>
              <th>{t("studio.updated")}</th>
              <th className="action-row-cell" aria-label={t("studio.actions")} />
            </tr>
          </thead>
          <tbody>
            {app.pages.map((page) => (
              <tr key={page.id} className="action-row">
                <td>
                  <button type="button" className="link-button" onClick={() => go(litePagePath(app, page))}>
                    {page.title}
                  </button>
                  <div className="muted">{litePagePath(app, page)}</div>
                </td>
                <td>{t(`studio.format.${page.format}` as MessageKey)}</td>
                <td>{page.in_menu && app.in_menu ? "✓" : ""}</td>
                <td>{new Date(page.updated_at).toLocaleDateString(intlLocale)}</td>
                {rowMenu(page.title, [
                  { key: "open", label: t("studio.app.open"), onSelect: () => go(litePagePath(app, page)) },
                  { key: "edit", label: t("studio.edit"), onSelect: () => go(`${base}/pages/${page.key}/edit`) },
                  { key: "delete", label: t("studio.delete"), tone: "danger", onSelect: () => confirmDelete(page.title, () => removePage.mutate({ id: page.id, appId: app.id })) },
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t("studio.app.types")} addLabel={t("studio.type.new")} onAdd={() => go(`${base}/types/new`)} items={t("studio.type.items")} empty={!app.types.length}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("studio.type.name")}</th>
              <th>{t("studio.type.fields")}</th>
              <th>{t("studio.type.records")}</th>
              <th className="action-row-cell" aria-label={t("studio.actions")} />
            </tr>
          </thead>
          <tbody>
            {app.types.map((type) => (
              <tr key={type.id} className="action-row">
                <td>
                  <button type="button" className="link-button" onClick={() => go(`${base}/types/${type.key}/edit`)}>
                    {type.name}
                  </button>
                  <div className="muted">{type.key}</div>
                </td>
                <td>{type.fields.map((field) => field.label || field.key).join(", ")}</td>
                <td>{count(type.id)}</td>
                {rowMenu(type.name, [
                  { key: "edit", label: t("studio.edit"), onSelect: () => go(`${base}/types/${type.key}/edit`) },
                  { key: "delete", label: t("studio.delete"), tone: "danger", onSelect: () => confirmDelete(type.name, () => removeType.mutate({ id: type.id, appId: app.id })) },
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t("studio.app.relations")} addLabel={t("studio.relation.new")} onAdd={() => go(`${base}/relations/new`)} items={t("studio.relation.items")} empty={!app.relations.length}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("studio.relation.label")}</th>
              <th>{t("studio.relation.from")}</th>
              <th>{t("studio.relation.to")}</th>
              <th>{t("studio.relation.cardinality")}</th>
              <th className="action-row-cell" aria-label={t("studio.actions")} />
            </tr>
          </thead>
          <tbody>
            {app.relations.map((relation) => (
              <tr key={relation.id} className="action-row">
                <td>
                  <button type="button" className="link-button" onClick={() => go(`${base}/relations/${relation.key}/edit`)}>
                    {relation.label}
                  </button>
                </td>
                <td>{typeName(relation.from_type_id)}</td>
                <td>{relation.to_type_id ? typeName(relation.to_type_id) : t(`entity.${relation.to_entity_type}` as MessageKey)}</td>
                <td>{t(`studio.relation.${relation.kind}` as MessageKey)}</td>
                {rowMenu(relation.label, [
                  { key: "edit", label: t("studio.edit"), onSelect: () => go(`${base}/relations/${relation.key}/edit`) },
                  { key: "delete", label: t("studio.delete"), tone: "danger", onSelect: () => confirmDelete(relation.label, () => removeRelation.mutate({ id: relation.id, appId: app.id })) },
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      {sheet}
    </div>
  );
}

/** `/studio/records/<key>`: finds the record and opens its sheet on its app's first page. */
function RecordForward({ recordKey, apps, loading }: { recordKey: string; apps: LiteAppTree[]; loading: boolean }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const record = useQuery({
    queryKey: ["gondol", "studio", "record", recordKey],
    queryFn: async () => {
      const id = idForEntityKey(null, recordKey);
      const query = studioDb().from("lite_records").select("id, slug, identifier, app_id");
      const { data, error } = await (id ? query.eq("id", id) : query.eq("slug", recordKey)).maybeSingle();
      if (error) throw error;
      return data as { id: string; slug: string; identifier: string; app_id: string } | null;
    },
  });
  const app = record.data ? apps.find((a) => a.id === record.data!.app_id) : undefined;
  const page = app ? firstLitePage(app) : undefined;
  useEffect(() => {
    if (app && page && record.data) go(`${litePagePath(app, page)}/records/${entityKey(record.data)}/edit`);
    else if (app && !page) go(`/studio/${entityKey(app)}`);
  }, [app, page, record.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading || record.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  if (!record.data) return <EmptyState items={t("studio.record.items")} description={t("studio.record.notFound")} />;
  return null;
}
