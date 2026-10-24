import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Alert, Button } from "../../../design-system/bungalow-79d923";
import { useResolutions } from "../../../apps/contributions";
import { callAppTool } from "../../../api/client";
import { ActionMenu } from "../../../entities/ActionMenu";
import { EmptyState } from "../../../shell/EmptyState";
import { showToast } from "../../../shell/clipboard";
import { useI18n } from "../../../i18n/i18n";
import { GenerativeUi } from "../../../genui/GenerativeUi";
import { resolveText, type A2uiUserAction } from "../../../genui/a2ui";
import type { A2uiCatalog, A2uiComponentProps } from "../../../genui/A2uiSurface";
import type { UiAction } from "../../../genui/mcpUi";
import {
  coerceRecordValues,
  fieldLabel,
  litePagePath,
  missingFields,
  pageDataModel,
  recordUri,
  useDeleteLiteRecord,
  useSaveLiteRecord,
} from "../models/studio";
import { userActionPrompt } from "../models/prompts";
import { studioAgentsHook } from "../hooks";
import type { LiteAppTree, LiteEntityType, LitePage, LiteRecord } from "../models/types";
import { RecordFields } from "./RecordFields";

/**
 * A page of a built app, rendered from its document (A2UI, Open-JSON-UI or MCP-UI) with the app's
 * data in its data model (`/app`, `/page`, `/types`, `/records/<type>`), the studio's own
 * components (`RecordList`, `RecordForm`) and the actions the app runs itself: create_record,
 * update_record, delete_record, new_record, edit_record, navigate and open_uri. Any other action
 * goes to the agent that built the app (its `builder_uri`), through the host's agents.
 */

type LitePageContextValue = {
  app: LiteAppTree;
  records: readonly LiteRecord[];
  typeByKey: (key: unknown) => LiteEntityType | undefined;
  openNew: (type: LiteEntityType) => void;
  openEdit: (record: LiteRecord) => void;
  interactive: boolean;
};

const LitePageContext = createContext<LitePageContextValue | null>(null);

function RecordList({ props, scope, data }: A2uiComponentProps) {
  const { t } = useI18n();
  const context = useContext(LitePageContext);
  const remove = useDeleteLiteRecord();
  if (!context) return null;
  const type = context.typeByKey(resolveText(props.type ?? props.entityType, data, scope));
  if (!type) return <div className="genui-unknown">{t("studio.page.noType", { type: resolveText(props.type, data, scope) })}</div>;
  const rows = context.records.filter((record) => record.type_id === type.id);
  const title = resolveText(props.title, data, scope) || type.plural_name || type.name;
  const columns = type.fields.slice(0, 4);
  const cell = (value: unknown) => (value === null || value === undefined ? "" : Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? (value ? "✓" : "") : String(value));
  const add = () => context.openNew(type);
  return (
    <section className="studio-records">
      <div className="panel-head">
        <h3 className="panel-title">{title}</h3>
        {context.interactive ? (
          <Button size="sm" tone="primary" onClick={add}>
            {t("studio.record.new", { type: type.name })}
          </Button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState items={(type.plural_name ?? type.name).toLowerCase()} actionLabel={context.interactive ? t("studio.record.new", { type: type.name }) : undefined} onAction={context.interactive ? add : undefined} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((field) => (
                <th key={field.key}>{fieldLabel(field)}</th>
              ))}
              <th className="action-row-cell" aria-label={t("studio.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((record) => (
              <tr key={record.id} className="action-row">
                {columns.map((field, index) => (
                  <td key={field.key}>{index === 0 && !cell(record.data[field.key]) ? record.title : cell(record.data[field.key])}</td>
                ))}
                <td className="action-row-cell">
                  <ActionMenu
                    name={record.title}
                    uri={context.interactive ? recordUri(record) : undefined}
                    actions={
                      context.interactive
                        ? [
                            { key: "edit", label: t("studio.edit"), onSelect: () => context.openEdit(record) },
                            {
                              key: "delete",
                              label: t("studio.delete"),
                              tone: "danger",
                              onSelect: () => {
                                if (window.confirm(t("studio.record.confirmDelete", { name: record.title }))) remove.mutate({ id: record.id, appId: context.app.id });
                              },
                            },
                          ]
                        : []
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function RecordForm({ props, scope, data }: A2uiComponentProps) {
  const { t } = useI18n();
  const context = useContext(LitePageContext);
  const save = useSaveLiteRecord();
  const [values, setValues] = useState<Record<string, unknown>>({});
  if (!context) return null;
  const type = context.typeByKey(resolveText(props.type ?? props.entityType, data, scope));
  if (!type) return <div className="genui-unknown">{t("studio.page.noType", { type: resolveText(props.type, data, scope) })}</div>;
  const coerced = coerceRecordValues(type, values);
  const missing = missingFields(type, coerced);
  return (
    <form
      className="studio-record-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!context.interactive || missing.length) return;
        save.mutate({ app_id: context.app.id, type_id: type.id, data: coerced }, { onSuccess: () => (setValues({}), showToast(t("studio.record.saved", { type: type.name }))) });
      }}
    >
      {save.error ? <Alert tone="danger">{save.error instanceof Error ? save.error.message : String((save.error as { message?: string }).message)}</Alert> : null}
      <RecordFields app={context.app} type={type} records={context.records} values={values} onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))} />
      <div className="row-actions">
        <Button type="submit" size="sm" tone="primary" disabled={!context.interactive || missing.length > 0} loading={save.isPending}>
          {resolveText(props.submitLabel, data, scope) || t("studio.record.add", { type: type.name })}
        </Button>
      </div>
    </form>
  );
}

/** The studio's own components, next to A2UI's standard catalogue. */
export const STUDIO_CATALOG: A2uiCatalog = { RecordList, RecordForm, EntityList: RecordList };

/** The local actions a page runs itself, also callable by MCP-UI views as tools of these names. */
const LOCAL_ACTIONS = new Set(["create_record", "update_record", "delete_record", "new_record", "edit_record", "navigate", "open_uri"]);

export function LitePageView({
  app,
  page,
  records,
  interactive = true,
  onNavigate,
  onOpenUri,
  onOpenNew,
  onOpenEdit,
}: {
  app: LiteAppTree;
  page: LitePage;
  records: readonly LiteRecord[];
  /** False in a preview: nothing is saved or sent. */
  interactive?: boolean;
  onNavigate: (path: string) => void;
  onOpenUri?: (uri: string) => void;
  onOpenNew: (type: LiteEntityType) => void;
  onOpenEdit: (record: LiteRecord) => void;
}) {
  const { t } = useI18n();
  const save = useSaveLiteRecord();
  const remove = useDeleteLiteRecord();
  const [bridge] = useResolutions(studioAgentsHook);
  const agents = bridge?.value.useAgents().agents ?? [];
  const builder = app.builder_uri ? agents.find((agent) => agent.uri === app.builder_uri) : undefined;
  const data = useMemo(() => pageDataModel(app, page, records), [app, page, records]);
  const typeByKey = useCallback((key: unknown) => app.types.find((type) => type.key === key || type.id === key || type.name === key), [app.types]);

  const toAgent = useCallback(
    async (action: unknown) => {
      if (!bridge || !builder) {
        showToast(t("studio.action.noAgent"));
        return null;
      }
      const path = await bridge.value.ask({ agent: builder, prompt: userActionPrompt(app, page, action), title: `${app.name}: ${page.title}` });
      showToast(t("studio.action.sent", { agent: builder.name }));
      return path;
    },
    [bridge, builder, app, page, t],
  );

  /** Runs a local action; false when it isn't one. */
  const runLocal = useCallback(
    async (name: string, context: Record<string, unknown>): Promise<unknown> => {
      const { type: typeKey, id, page: pageKey, path, uri, ...fields } = context as Record<string, unknown> & { type?: unknown; id?: unknown; page?: unknown; path?: unknown; uri?: unknown };
      const record = typeof id === "string" ? records.find((r) => r.id === id || r.slug === id || r.identifier === id) : undefined;
      switch (name) {
        case "create_record": {
          const type = typeByKey(typeKey);
          if (!type) throw new Error(t("studio.page.noType", { type: String(typeKey ?? "") }));
          const values = coerceRecordValues(type, fields);
          const missing = missingFields(type, values);
          if (missing.length) throw new Error(t("studio.record.missing", { fields: missing.map(fieldLabel).join(", ") }));
          const saved = await save.mutateAsync({ app_id: app.id, type_id: type.id, data: values });
          return { id: saved.id, uri: recordUri(saved), title: saved.title };
        }
        case "update_record": {
          if (!record) throw new Error(t("studio.record.notFound"));
          const type = app.types.find((ty) => ty.id === record.type_id);
          const values = type ? coerceRecordValues(type, fields) : fields;
          const saved = await save.mutateAsync({ id: record.id, app_id: app.id, type_id: record.type_id, data: { ...record.data, ...values } });
          return { id: saved.id, uri: recordUri(saved), title: saved.title };
        }
        case "delete_record":
          if (!record) throw new Error(t("studio.record.notFound"));
          await remove.mutateAsync({ id: record.id, appId: app.id });
          return { deleted: record.id };
        case "new_record": {
          const type = typeByKey(typeKey);
          if (type) onOpenNew(type);
          return null;
        }
        case "edit_record":
          if (record) onOpenEdit(record);
          return null;
        case "navigate": {
          const target = typeof pageKey === "string" ? app.pages.find((p) => p.key === pageKey) : undefined;
          if (target) onNavigate(litePagePath(app, target));
          else if (typeof path === "string" && path.startsWith("/")) onNavigate(path);
          return null;
        }
        case "open_uri":
          if (typeof uri === "string") {
            if (/^https?:\/\//i.test(uri)) window.open(uri, "_blank", "noopener,noreferrer");
            else onOpenUri?.(uri);
          }
          return null;
      }
      return undefined;
    },
    [records, typeByKey, save, remove, app, onOpenNew, onOpenEdit, onNavigate, onOpenUri, t],
  );

  const onAction = useCallback(
    async (action: A2uiUserAction) => {
      if (!interactive) return;
      try {
        if (LOCAL_ACTIONS.has(action.name)) await runLocal(action.name, action.context);
        else await toAgent({ userAction: action });
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error));
      }
    },
    [interactive, runLocal, toAgent],
  );

  const onUiAction = useCallback(
    async (action: UiAction): Promise<unknown> => {
      if (!interactive) return undefined;
      switch (action.type) {
        case "tool":
          if (LOCAL_ACTIONS.has(action.payload.toolName)) return runLocal(action.payload.toolName, action.payload.params ?? {});
          return callAppTool(action.payload.toolName, action.payload.params ?? {});
        case "link":
          if (action.payload.url.startsWith("/")) onNavigate(action.payload.url);
          else if (/^https?:\/\//i.test(action.payload.url)) window.open(action.payload.url, "_blank", "noopener,noreferrer");
          else onOpenUri?.(action.payload.url);
          return undefined;
        case "notify":
          showToast(action.payload.message);
          return undefined;
        case "prompt":
        case "intent":
          await toAgent(action);
          return undefined;
      }
    },
    [interactive, runLocal, toAgent, onNavigate, onOpenUri],
  );

  const contextValue = useMemo<LitePageContextValue>(
    () => ({ app, records, typeByKey, openNew: onOpenNew, openEdit: onOpenEdit, interactive }),
    [app, records, typeByKey, onOpenNew, onOpenEdit, interactive],
  );

  return (
    <LitePageContext.Provider value={contextValue}>
      <div className="studio-page" data-format={page.format}>
        <GenerativeUi
          format={page.format}
          document={page.document}
          data={data}
          catalog={STUDIO_CATALOG}
          onAction={onAction}
          onUiAction={onUiAction}
          renderData={page.format === "mcp_ui" ? data : null}
          title={page.title}
        />
      </div>
    </LitePageContext.Provider>
  );
}

/** A frame for pages shown in a sheet's preview. */
export function LitePagePreview({ children }: { children: ReactNode }) {
  return <div className="studio-preview">{children}</div>;
}
