import { useMemo } from "react";
import { Button, Select } from "../design-system/bungalow-79d923";
import { useI18n, type MessageKey } from "../i18n/i18n";
import { entityTypes } from "./lookup";
import {
  HEADER_LAYOUTS,
  HEADER_SUBJECTS,
  sanitizeEntityHeaderTypes,
  type EntityHeaderTypes,
  type EntityHeaderTypeSettings,
  type HeaderLayout,
  type HeaderSubjects,
} from "./entityHeaderSettings";

/**
 * Header settings per entity type (Account › Layout, the site sheet): a row per type that has its
 * own (its header layout and where its related subjects go, each "As for every type" or a value),
 * and a picker that adds a type. Types left out follow the settings for every type.
 */
export function EntityHeaderTypesField({
  value,
  onChange,
  disabled,
}: {
  value: EntityHeaderTypes | null | undefined;
  onChange: (next: EntityHeaderTypes) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const settings = sanitizeEntityHeaderTypes(value);
  const label = (type: string) => t(`entity.${type}` as MessageKey);
  const types = useMemo(() => entityTypes().map((type) => ({ type, name: label(type) })).sort((a, b) => a.name.localeCompare(b.name)), [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const configured = types.filter(({ type }) => settings[type]);
  const set = (type: string, patch: EntityHeaderTypeSettings | null) => {
    const next = { ...settings };
    if (patch === null) delete next[type];
    else next[type] = { ...next[type], ...patch };
    onChange(next);
  };

  return (
    <div className="bungalow-field entity-header-types">
      <span className="bungalow-label">{t("appearance.entityHeaders")}</span>
      <span className="bungalow-help">{t("appearance.entityHeaders.hint")}</span>
      {configured.map(({ type, name }) => (
        <div key={type} className="entity-header-types__row">
          <span className="entity-header-types__type">{name}</span>
          <Select
            label={t("appearance.headerLayout")}
            value={settings[type]?.layout ?? ""}
            disabled={disabled}
            onChange={(e) => set(type, { layout: (e.target.value || undefined) as HeaderLayout | undefined })}
          >
            <option value="">{t("appearance.entityHeaders.inherit")}</option>
            {HEADER_LAYOUTS.map((option) => (
              <option key={option} value={option}>
                {t(`appearance.headerLayout.${option}` as MessageKey)}
              </option>
            ))}
          </Select>
          <Select
            label={t("appearance.headerSubjects")}
            value={settings[type]?.subjects ?? ""}
            disabled={disabled}
            onChange={(e) => set(type, { subjects: (e.target.value || undefined) as HeaderSubjects | undefined })}
          >
            <option value="">{t("appearance.entityHeaders.inherit")}</option>
            {HEADER_SUBJECTS.map((option) => (
              <option key={option} value={option}>
                {t(`appearance.headerSubjects.${option}` as MessageKey)}
              </option>
            ))}
          </Select>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => set(type, null)}>
            {t("appearance.entityHeaders.remove")}
          </Button>
        </div>
      ))}
      <Select
        label={t("appearance.entityHeaders.add")}
        value=""
        disabled={disabled}
        onChange={(e) => {
          // A new row starts out vertical, the one thing a type can set that "every type" may not.
          if (e.target.value) set(e.target.value, { layout: "vertical" });
        }}
      >
        <option value="">{t("appearance.entityHeaders.pick")}</option>
        {types
          .filter(({ type }) => !settings[type])
          .map(({ type, name }) => (
            <option key={type} value={type}>
              {name}
            </option>
          ))}
      </Select>
    </div>
  );
}
