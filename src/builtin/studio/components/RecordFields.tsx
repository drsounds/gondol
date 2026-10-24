import { Checkbox, Input, Select } from "../../../design-system/bungalow-79d923";
import { EntityPicker, type EntityOption } from "../../../entities/EntityPicker";
import type { EntityType } from "../../../register";
import { fieldLabel } from "../models/studio";
import type { LiteAppTree, LiteEntityType, LiteField, LiteRecord, LiteRelation } from "../models/types";

/**
 * The inputs for a record of an entity type: one per field, as its type says, then one picker per
 * relation from the type (the app's own records, or any entity of the host's type).
 */
export function RecordFields({
  app,
  type,
  records,
  values,
  onChange,
  exclude,
}: {
  app: LiteAppTree;
  type: LiteEntityType;
  /** The app's records, for relations to its own types. */
  records: readonly LiteRecord[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** The record itself, which can't relate to itself. */
  exclude?: string;
}) {
  const relations = app.relations.filter((relation) => relation.from_type_id === type.id);
  return (
    <>
      {type.fields.map((field) => (
        <FieldInput key={field.key} field={field} value={values[field.key]} onChange={(value) => onChange(field.key, value)} />
      ))}
      {relations.map((relation) => (
        <RelationInput key={relation.id} relation={relation} records={records} value={values[relation.key]} exclude={exclude} onChange={(value) => onChange(relation.key, value)} />
      ))}
    </>
  );
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));

function FieldInput({ field, value, onChange }: { field: LiteField; value: unknown; onChange: (value: unknown) => void }) {
  const label = `${fieldLabel(field)}${field.required ? " *" : ""}`;
  switch (field.type) {
    case "long_text":
      return (
        <label className="studio-field">
          <span className="studio-field__label">{label}</span>
          <textarea className="bungalow-input" rows={4} value={text(value)} required={field.required} onChange={(e) => onChange(e.target.value)} />
          {field.description ? <span className="muted studio-field__hint">{field.description}</span> : null}
        </label>
      );
    case "boolean":
      return <Checkbox label={fieldLabel(field)} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "select":
      return (
        <Select label={label} hint={field.description} value={text(value)} required={field.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <fieldset className="studio-field studio-field--choices">
          <legend className="studio-field__label">{label}</legend>
          {(field.options ?? []).map((option) => (
            <Checkbox
              key={option}
              label={option}
              checked={selected.includes(option)}
              onChange={(e) => onChange(e.target.checked ? [...selected, option] : selected.filter((v) => v !== option))}
            />
          ))}
        </fieldset>
      );
    }
    case "uri":
      return <EntityPicker label={label} hint={field.description} valueKind="uri" value={typeof value === "string" ? value : null} onChange={(next) => onChange(next)} />;
    default: {
      const inputType =
        field.type === "number" || field.type === "integer"
          ? "number"
          : field.type === "date"
            ? "date"
            : field.type === "datetime"
              ? "datetime-local"
              : field.type === "url"
                ? "url"
                : field.type === "email"
                  ? "email"
                  : "text";
      return (
        <Input
          label={label}
          hint={field.description}
          type={inputType}
          step={field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined}
          required={field.required}
          value={text(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }
}

function RelationInput({
  relation,
  records,
  value,
  exclude,
  onChange,
}: {
  relation: LiteRelation;
  records: readonly LiteRecord[];
  value: unknown;
  exclude?: string;
  onChange: (value: unknown) => void;
}) {
  // To one of the app's own types: its records, by id. To a host type: any entity of it, by id.
  const options: EntityOption[] | undefined = relation.to_type_id
    ? records.filter((r) => r.type_id === relation.to_type_id && r.id !== exclude).map((r) => ({ type: "lite_record" as EntityType, id: r.id, title: r.title }))
    : undefined;
  const types = (relation.to_type_id ? ["lite_record"] : relation.to_entity_type ? [relation.to_entity_type] : undefined) as EntityType[] | undefined;
  if (relation.kind === "many") {
    const list = Array.isArray(value) ? value.map(String) : [];
    return <EntityPicker multiple label={relation.label} types={types} options={options} valueKind="id" value={list} onChange={(next) => onChange(next)} />;
  }
  return (
    <EntityPicker label={relation.label} types={types} options={options} valueKind="id" value={typeof value === "string" ? value : null} onChange={(next) => onChange(next)} />
  );
}
