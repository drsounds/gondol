import { useEffect, useMemo, useState } from "react";
import { entityExtensions } from "../entities/extensions";
import { Button, Checkbox, Icon, Input, Select } from "../design-system/bungalow-79d923";
import { entityTypes as registeredEntityTypes } from "../entities/lookup";
import {
  isFilterActive,
  useGlobalFilter,
  type DatePeriod,
  type FilterCondition,
  type GlobalFilter,
} from "./globalFilterState";
import { useI18n, type MessageKey } from "../i18n/i18n";
import { SITE_CONDITION_FIELDS, SITE_CONDITION_OPS, SITE_OWNERSHIPS, type SiteConditionField, type SiteConditionMatch } from "../sites/sites";

/**
 * The header's global filter controls (src/lib/globalFilter.tsx): a calendar button for the date
 * period and a funnel for the entity filter, each with a dot while it's set, the drawers they open,
 * and a bar under the header listing what's applied.
 */

// Dates are plain YYYY-MM-DD strings, computed in UTC so they never shift with the time zone.
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseIso = (s: string) => new Date(`${s}T00:00:00Z`);
const utcToday = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const monthStart = (d: Date, offset = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));

function periodPreset(kind: "today" | "week" | "month" | "year"): DatePeriod {
  const today = utcToday();
  if (kind === "today") return { from: iso(today), to: iso(today) };
  if (kind === "week") {
    const monday = addDays(today, -((today.getUTCDay() + 6) % 7));
    return { from: iso(monday), to: iso(addDays(monday, 6)) };
  }
  if (kind === "month") return { from: iso(monthStart(today)), to: iso(addDays(monthStart(today, 1), -1)) };
  const year = today.getUTCFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Moves a period one step: by whole months when it spans whole months, otherwise by its length. */
function shiftPeriod(period: { from: string; to: string }, direction: 1 | -1): DatePeriod {
  const from = parseIso(period.from);
  const to = parseIso(period.to);
  const wholeMonths = from.getUTCDate() === 1 && addDays(to, 1).getUTCDate() === 1;
  if (wholeMonths) {
    const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() + 1;
    const start = monthStart(from, direction * months);
    return { from: iso(start), to: iso(addDays(monthStart(start, months), -1)) };
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return { from: iso(addDays(from, direction * days)), to: iso(addDays(to, direction * days)) };
}

function FunnelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 2h13l-4.75 6.1v4.15L7.25 13.6V8.1L1.5 2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The calendar and funnel buttons, each with a dot while its part of the filter is set. */
export function GlobalFilterButtons({ onOpenPeriod, onOpenFilter }: { onOpenPeriod: () => void; onOpenFilter: () => void }) {
  const { t } = useI18n();
  const { filterActive, periodActive } = useGlobalFilter();
  return (
    <>
      <button
        type="button"
        className="chrome-nav-btn chrome-nav-btn--home global-filter-btn"
        aria-label={periodActive ? t("period.buttonActive") : t("period.button")}
        title={t("period.button")}
        aria-haspopup="dialog"
        data-tour="date-period"
        onClick={onOpenPeriod}
      >
        <Icon name="calendar" />
        {periodActive ? <span className="global-filter-btn__dot" aria-hidden="true" /> : null}
      </button>
      <button
        type="button"
        className="chrome-nav-btn chrome-nav-btn--home global-filter-btn"
        aria-label={filterActive ? t("filter.buttonActive") : t("filter.button")}
        title={t("filter.button")}
        aria-haspopup="dialog"
        data-tour="global-filter"
        onClick={onOpenFilter}
      >
        <FunnelIcon />
        {filterActive ? <span className="global-filter-btn__dot" aria-hidden="true" /> : null}
      </button>
    </>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="filter-drawer-backdrop" onClick={onClose}>
      <div className="filter-drawer" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="panel-title">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("filter.close")}>
            {t("filter.close")}
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The date period drawer. `fallback` is the period the finance views show while none is set, so
 * stepping earlier/later starts from what's on screen.
 */
export function DatePeriodDrawer({ onClose, fallback }: { onClose: () => void; fallback: { from: string; to: string } }) {
  const { t } = useI18n();
  const { period, periodActive, setPeriod } = useGlobalFilter();
  const current = { from: period.from ?? fallback.from, to: period.to ?? fallback.to };
  return (
    <Drawer title={t("period.title")} onClose={onClose}>
      <p className="muted">{t("period.intro")}</p>
      <div className="range-inputs">
        <Input
          label={t("range.from")}
          type="date"
          value={period.from ?? ""}
          max={period.to ?? undefined}
          onChange={(e) => setPeriod({ from: e.target.value || null, to: period.to })}
        />
        <Input
          label={t("range.to")}
          type="date"
          value={period.to ?? ""}
          min={period.from ?? undefined}
          onChange={(e) => setPeriod({ from: period.from, to: e.target.value || null })}
        />
        <div className="range-controls">
          <Button variant="outline" size="sm" onClick={() => setPeriod(shiftPeriod(current, -1))} aria-label={t("range.earlier")}>‹</Button>
          <Button variant="outline" size="sm" onClick={() => setPeriod(shiftPeriod(current, 1))} aria-label={t("range.later")}>›</Button>
        </div>
      </div>
      <div className="row-actions global-filter-presets">
        <Button variant="ghost" size="sm" onClick={() => setPeriod(periodPreset("today"))}>{t("range.today")}</Button>
        <Button variant="ghost" size="sm" onClick={() => setPeriod(periodPreset("week"))}>{t("period.week")}</Button>
        <Button variant="ghost" size="sm" onClick={() => setPeriod(periodPreset("month"))}>{t("period.month")}</Button>
        <Button variant="ghost" size="sm" onClick={() => setPeriod(periodPreset("year"))}>{t("range.year")}</Button>
      </div>
      <div className="row-actions">
        <Button variant="outline" size="sm" disabled={!periodActive} onClick={() => setPeriod({ from: null, to: null })}>
          {t("period.clear")}
        </Button>
        <Button size="sm" tone="primary" onClick={onClose}>
          {t("filter.done")}
        </Button>
      </div>
    </Drawer>
  );
}

const emptyCondition = (): FilterCondition => ({ field: "title", op: "contains", value: "" });

/** The entity filter drawer: entity types and conditions, applied to every view on "Apply". */
export function GlobalFilterDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { filter, setFilter } = useGlobalFilter();
  const [draft, setDraft] = useState<GlobalFilter>(() => ({
    ...filter,
    conditions: filter.conditions.length ? filter.conditions : [],
  }));
  const tags = entityExtensions().useTags();
  const entityTypes = useMemo(
    () => registeredEntityTypes().sort((a, b) => t(`entity.${a}` as MessageKey).localeCompare(t(`entity.${b}` as MessageKey))),
    [t],
  );
  const allTypes = draft.types == null;
  const setCondition = (index: number, patch: Partial<FilterCondition>) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  const toggleType = (type: string, on: boolean) =>
    setDraft((d) => {
      const types = new Set(d.types ?? []);
      if (on) types.add(type);
      else types.delete(type);
      return { ...d, types: [...types] };
    });

  return (
    <Drawer title={t("filter.title")} onClose={onClose}>
      <form
        className="stack global-filter-form"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...draft, types: draft.types?.length ? draft.types : null });
          onClose();
        }}
      >
        <p className="muted">{t("filter.intro")}</p>
        <p className="form-section-title">{t("filter.types")}</p>
        <Checkbox
          label={t("filter.allTypes")}
          checked={allTypes}
          onChange={(e) => setDraft((d) => ({ ...d, types: e.target.checked ? null : [] }))}
        />
        {!allTypes ? (
          <div className="site-check-grid global-filter-types">
            {entityTypes.map((type) => (
              <Checkbox
                key={type}
                label={t(`entity.${type}` as MessageKey)}
                checked={draft.types!.includes(type)}
                onChange={(e) => toggleType(type, e.target.checked)}
              />
            ))}
          </div>
        ) : null}

        <p className="form-section-title">{t("sites.conditions")}</p>
        {draft.conditions.length > 1 ? (
          <Select
            label={t("sites.match")}
            value={draft.match}
            onChange={(e) => setDraft((d) => ({ ...d, match: e.target.value as SiteConditionMatch }))}
          >
            <option value="all">{t("sites.matchAll")}</option>
            <option value="any">{t("sites.matchAny")}</option>
          </Select>
        ) : null}
        {draft.conditions.map((condition, index) => (
          <div key={index} className="site-condition">
            <Select
              aria-label={t("sites.conditionField")}
              value={condition.field}
              onChange={(e) => {
                const field = e.target.value as SiteConditionField;
                setCondition(index, { field, op: SITE_CONDITION_OPS[field][0], value: field === "ownership" ? "own" : "" });
              }}
            >
              {SITE_CONDITION_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {t(`sites.field.${field}` as MessageKey)}
                </option>
              ))}
            </Select>
            <Select aria-label={t("sites.conditionOp")} value={condition.op} onChange={(e) => setCondition(index, { op: e.target.value })}>
              {SITE_CONDITION_OPS[condition.field].map((op) => (
                <option key={op} value={op}>
                  {t(`sites.op.${op}` as MessageKey)}
                </option>
              ))}
            </Select>
            {condition.field === "ownership" ? (
              <Select aria-label={t("sites.conditionValue")} value={condition.value} onChange={(e) => setCondition(index, { value: e.target.value })}>
                {SITE_OWNERSHIPS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`sites.ownership.${kind}` as MessageKey)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                aria-label={t("sites.conditionValue")}
                type={condition.field === "updated" ? "number" : "text"}
                min={condition.field === "updated" ? 0 : undefined}
                list={condition.field === "tag" ? "global-filter-tag-names" : undefined}
                placeholder={t(`sites.valuePlaceholder.${condition.field}` as MessageKey)}
                value={condition.value}
                onChange={(e) => setCondition(index, { value: e.target.value })}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("sites.removeCondition")}
              onClick={() => setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, i) => i !== index) }))}
            >
              ×
            </Button>
          </div>
        ))}
        <datalist id="global-filter-tag-names">
          {(tags.data ?? []).map((tag) => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>
        <div className="row-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDraft((d) => ({ ...d, conditions: [...d.conditions, emptyCondition()] }))}
          >
            {t("sites.addCondition")}
          </Button>
        </div>
        <div className="row-actions global-filter-form__footer">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isFilterActive(filter) && !isFilterActive(draft)}
            onClick={() => {
              setFilter({ types: null, conditions: [], match: "all" });
              onClose();
            }}
          >
            {t("filter.clear")}
          </Button>
          <Button type="submit" size="sm" tone="primary">
            {t("filter.apply")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

/** What the global filter applies right now, under the header, with a way to clear each part. */
export function GlobalFilterBar({ onOpenPeriod, onOpenFilter }: { onOpenPeriod: () => void; onOpenFilter: () => void }) {
  const { t, intlLocale } = useI18n();
  const { filter, period, filterActive, periodActive, setFilter, setPeriod, clear } = useGlobalFilter();
  if (!filterActive && !periodActive) return null;
  const fmt = (s: string) =>
    parseIso(s).toLocaleDateString(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const periodLabel =
    period.from && period.to
      ? `${fmt(period.from)} – ${fmt(period.to)}`
      : period.from
        ? t("period.fromOnly", { date: fmt(period.from) })
        : period.to
          ? t("period.toOnly", { date: fmt(period.to) })
          : "";
  const typeLabel = filter.types
    ? filter.types.length <= 2
      ? filter.types.map((type) => t(`entity.${type}` as MessageKey)).join(", ")
      : t("filter.typesCount", { count: filter.types.length })
    : null;
  const conditionLabel = (c: FilterCondition) =>
    `${t(`sites.field.${c.field}` as MessageKey)} ${t(`sites.op.${c.op}` as MessageKey)} ${
      c.field === "ownership" ? t(`sites.ownership.${c.value}` as MessageKey) : `"${c.value}"`
    }`;
  return (
    <div className="global-filter-bar" role="status">
      <span className="global-filter-bar__label">{t("filter.active")}</span>
      {periodActive ? (
        <span className="global-filter-chip">
          <button type="button" className="global-filter-chip__body" onClick={onOpenPeriod}>
            <Icon name="calendar" /> {periodLabel}
          </button>
          <button type="button" className="global-filter-chip__clear" aria-label={t("period.clear")} onClick={() => setPeriod({ from: null, to: null })}>
            ×
          </button>
        </span>
      ) : null}
      {typeLabel ? (
        <span className="global-filter-chip">
          <button type="button" className="global-filter-chip__body" onClick={onOpenFilter}>
            {typeLabel}
          </button>
          <button
            type="button"
            className="global-filter-chip__clear"
            aria-label={t("filter.clearTypes")}
            onClick={() => setFilter({ ...filter, types: null })}
          >
            ×
          </button>
        </span>
      ) : null}
      {filter.conditions.map((c, i) => (
        <span key={i} className="global-filter-chip">
          <button type="button" className="global-filter-chip__body" onClick={onOpenFilter}>
            {i > 0 ? <span className="muted">{t(filter.match === "any" ? "filter.or" : "filter.and")} </span> : null}
            {conditionLabel(c)}
          </button>
          <button
            type="button"
            className="global-filter-chip__clear"
            aria-label={t("sites.removeCondition")}
            onClick={() => setFilter({ ...filter, conditions: filter.conditions.filter((_, j) => j !== i) })}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        className="global-filter-bar__clear"
        onClick={clear}
      >
        {t("filter.clearAll")}
      </button>
    </div>
  );
}
