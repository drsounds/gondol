import { useState } from "react";
import { Alert } from "../../../design-system/bungalow-79d923";
import { EntitySheet } from "../../../entities/EntitySheet";
import { FormActions } from "../../../entities/FormActions";
import { useI18n } from "../../../i18n/i18n";
import { coerceRecordValues, fieldLabel, missingFields, recordUri, useDeleteLiteRecord, useSaveLiteRecord } from "../models/studio";
import type { LiteAppTree, LiteEntityType, LiteRecord } from "../models/types";
import { RecordFields } from "./RecordFields";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

const shown = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? (value ? "✓" : "—") : String(value);

/** Creating or editing a record of an app's entity type (routed: see the page and studio views). */
export function RecordSheet({
  app,
  type,
  record,
  records,
  onClose,
  onSaved,
}: {
  app: LiteAppTree;
  type: LiteEntityType;
  record?: LiteRecord;
  records: readonly LiteRecord[];
  onClose: () => void;
  onSaved?: (record: LiteRecord) => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...(record?.data ?? {}) }));
  const save = useSaveLiteRecord();
  const remove = useDeleteLiteRecord();
  const data = coerceRecordValues(type, values);
  const missing = missingFields(type, data);
  const titleField = type.fields.find((f) => f.key === type.title_field) ?? type.fields.find((f) => f.type === "text") ?? type.fields[0];
  const title = titleField ? shown(data[titleField.key]) : (record?.title ?? type.name);

  return (
    <EntitySheet
      title={record ? t("studio.record.editTitle", { type: type.name }) : t("studio.record.newTitle", { type: type.name })}
      subtitle={app.name}
      onClose={onClose}
      closeLabel={t("studio.close")}
      uri={record ? recordUri(record) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (missing.length) return;
        save.mutate({ id: record?.id, app_id: app.id, type_id: type.id, data }, { onSuccess: (saved) => (onSaved ? onSaved(saved) : onClose()) });
      }}
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{type.name}</div>
          <div className="entity-preview__label">{title === "—" ? type.name : title}</div>
          <dl className="entity-preview__meta">
            {type.fields
              .filter((field) => field !== titleField)
              .map((field) => (
                <div key={field.key}>
                  <dt>{fieldLabel(field)}</dt>
                  <dd>{shown(data[field.key])}</dd>
                </div>
              ))}
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("studio.cancel")}
          onDelete={
            record
              ? () => {
                  if (window.confirm(t("studio.record.confirmDelete", { name: record.title }))) remove.mutate({ id: record.id, appId: app.id }, { onSuccess: onClose });
                }
              : undefined
          }
          deleteLabel={t("studio.delete")}
          deleting={remove.isPending}
          submitLabel={t("studio.save")}
          saving={save.isPending}
          submitDisabled={missing.length > 0}
        />
      }
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      {type.fields.length === 0 ? <p className="muted">{t("studio.record.noFields")}</p> : null}
      <RecordFields app={app} type={type} records={records} values={values} exclude={record?.id} onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))} />
    </EntitySheet>
  );
}
