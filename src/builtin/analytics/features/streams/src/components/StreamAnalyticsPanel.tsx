import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, Card, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntityPicker } from "../../../../../../entities/EntityPicker";
import { entityTypeLabel, labelFor, useEntityLabels } from "../../../../../../entities/lookup";
import { entityKey } from "../../../../../../entities/slugs";
import { isEntityUri, parseEntityUri, toEntityUri, type EntityType } from "../../../../../../entities/uri";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import type { DateRangeSearch } from "../../../../../../navigation/dateRangeSearch";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { formatDuration, fromLocalInput, toLocalInput, type Stream } from "../../../../../streams/models";
import {
  autoGranularity,
  bucketize,
  groupStreams,
  STREAM_ANALYTICS_LIMIT,
  STREAM_CONDITION_FIELDS,
  STREAM_GROUPINGS,
  streamMatches,
  totalsOf,
  uriType,
  useStreamsInSpan,
  type Granularity,
  type StreamCondition,
  type StreamConditionField,
  type StreamFilter,
  type StreamGrouping,
  type StreamTotals,
} from "../../../../models";

type Metric = "count" | "quantity" | "duration";
const METRICS: readonly Metric[] = ["count", "quantity", "duration"];
const PRESETS = ["today", "7d", "30d", "12m", "all"] as const;
type Preset = (typeof PRESETS)[number];

function presetSpan(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (preset === "7d") start.setDate(start.getDate() - 6);
  if (preset === "30d") start.setDate(start.getDate() - 29);
  if (preset === "12m") start.setFullYear(start.getFullYear() - 1);
  if (preset === "all") return { from: "", to: "" };
  return { from: toLocalInput(start.toISOString()), to: toLocalInput(end.toISOString()) };
}

let conditionSeq = 0;
const newCondition = (field: StreamConditionField = "object_uri"): StreamCondition => ({ id: `c${++conditionSeq}`, field, op: "is", values: [] });

/**
 * Analytics of the user's streams (`/analytics`): pick a period (and a time of day), the object's
 * entity types and conditions on subject, predicate, object, context, motivation and task, then
 * read the totals, a chart over time, a breakdown and the matching streams.
 */
export function StreamAnalyticsPanel() {
  const { t, intlLocale } = useI18n();
  const navigate = useNavigate();
  const [preset, setPreset] = useState<Preset | null>("30d");
  const [span, setSpan] = useState(() => presetSpan("30d"));
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [conditions, setConditions] = useState<StreamCondition[]>([]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [metric, setMetric] = useState<Metric>("count");
  const [granularity, setGranularity] = useState<Granularity | "auto">("auto");
  const [grouping, setGrouping] = useState<StreamGrouping>("predicate");

  const from = fromLocalInput(span.from);
  const to = fromLocalInput(span.to);
  const query = useStreamsInSpan(from, to);
  const inSpan = useMemo(() => query.data ?? [], [query.data]);

  const filter: StreamFilter = { from, to, timeFrom, timeTo, types, conditions, match };
  const streams = inSpan.filter((s) => streamMatches(s, filter));
  const totals = totalsOf(streams);

  // The chart runs over the whole span; an open-ended one runs over the streams it has.
  const chartFrom = from ? new Date(from) : streams[0] ? new Date(streams[0].start_date) : new Date();
  const chartTo = to ? new Date(to) : new Date(Math.max(Date.now(), ...streams.map((s) => Date.parse(s.start_date) + 1)));
  const bucketSize = granularity === "auto" ? autoGranularity(chartFrom, chartTo) : granularity;
  const buckets = bucketize(streams, chartFrom, chartTo, bucketSize);
  const groups = groupStreams(streams, grouping, metric);

  const objectTypes = useMemo(
    () => [...new Set(inSpan.map((s) => uriType(s.object_uri)).filter((x): x is string => !!x))].sort(),
    [inSpan],
  );
  const predicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of inSpan) counts.set(s.action, (counts.get(s.action) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([action]) => action);
  }, [inSpan]);
  const subjects = useMemo(() => [...new Set(inSpan.map((s) => s.subject_uri))], [inSpan]);

  const { data: labels } = useEntityLabels(
    [...new Set([...streams.flatMap((s) => [s.object_uri, s.context_uri, s.motivation_uri]), ...conditions.flatMap((c) => c.values)])].filter(
      (u): u is string => !!u && isEntityUri(u),
    ),
  );
  const uriLabel = (uri: string | null) => (uri ? (labelFor(labels, uri) ?? uri) : "—");
  const num = (n: number) => new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 }).format(n);
  const hours = (seconds: number) => new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 }).format(seconds / 3600);
  const metricValue = (x: StreamTotals) => x[metric];
  const metricText = (value: number) => (metric === "duration" ? formatDuration(value) : num(value));
  const when = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" });
  const typeName = (type: string) => entityTypeLabel(t, toEntityUri(type as EntityType, "x"));
  const subjectLabel = (uri: string) => ((parseEntityUri(uri)?.entityType as string | undefined) === "user" ? t("analytics.you") : uriLabel(uri));

  function choosePreset(next: Preset) {
    setPreset(next);
    setSpan(presetSpan(next));
  }
  function updateCondition(id: string, patch: Partial<StreamCondition>) {
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  /** Narrows the analysis to one group (from its row menu). */
  function addGroupCondition(key: string | null) {
    if (key == null) return;
    if (grouping === "type") setTypes([key]);
    else setConditions((prev) => [...prev, { ...newCondition(grouping === "predicate" ? "predicate" : grouping), values: [key] }]);
  }
  function editStream(s: Stream) {
    navigate({ to: `/streams/${entityKey(s)}/edit`, search: (prev: DateRangeSearch) => prev } as Parameters<typeof navigate>[0]);
  }

  const groupLabel = (key: string | null) => {
    if (key == null) return t("analytics.none");
    if (grouping === "predicate") return key;
    if (grouping === "type") return typeName(key);
    if (grouping === "subject_uri") return subjectLabel(key);
    return uriLabel(key);
  };
  const groupTotal = groups.reduce((s, g) => s + metricValue(g.totals), 0);
  const shown = [...streams].reverse().slice(0, 200);

  return (
    <div className="stack analytics">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("analytics.streams.title")}</h2>
          <p className="muted">{t("analytics.streams.intro")}</p>
        </div>
      </div>

      <Card>
        <div className="stack analytics__filters">
          <div className="analytics__presets" role="group" aria-label={t("analytics.period")}>
            {PRESETS.map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={preset === p} onClick={() => choosePreset(p)}>
                {t(`analytics.preset.${p}` as MessageKey)}
              </button>
            ))}
          </div>
          <div className="form-grid">
            <Input
              label={t("analytics.from")}
              type="datetime-local"
              value={span.from}
              onChange={(e) => {
                setPreset(null);
                setSpan((s) => ({ ...s, from: e.target.value }));
              }}
            />
            <Input
              label={t("analytics.to")}
              type="datetime-local"
              value={span.to}
              onChange={(e) => {
                setPreset(null);
                setSpan((s) => ({ ...s, to: e.target.value }));
              }}
            />
            <Input label={t("analytics.timeFrom")} type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
            <Input label={t("analytics.timeTo")} type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </div>
          <p className="muted analytics__hint">{t("analytics.timeHint")}</p>

          {objectTypes.length > 0 ? (
            <div className="stack analytics__types">
              <div className="stat-label">{t("analytics.types")}</div>
              <div className="analytics__presets" role="group" aria-label={t("analytics.types")}>
                {objectTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="chip"
                    aria-pressed={types.includes(type)}
                    onClick={() => setTypes((prev) => (prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]))}
                  >
                    {typeName(type)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="stack">
            <div className="analytics__conditions-head">
              <div className="stat-label">{t("analytics.conditions")}</div>
              {conditions.length > 1 ? (
                <Select aria-label={t("analytics.match")} value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")}>
                  <option value="all">{t("analytics.match.all")}</option>
                  <option value="any">{t("analytics.match.any")}</option>
                </Select>
              ) : null}
            </div>
            {conditions.map((c) => (
              <div key={c.id} className="analytics__condition">
                <Select
                  aria-label={t("analytics.field")}
                  value={c.field}
                  onChange={(e) => updateCondition(c.id, { field: e.target.value as StreamConditionField, values: [] })}
                >
                  {STREAM_CONDITION_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {t(`analytics.field.${f}` as MessageKey)}
                    </option>
                  ))}
                </Select>
                <Select aria-label={t("analytics.operator")} value={c.op} onChange={(e) => updateCondition(c.id, { op: e.target.value as "is" | "not" })}>
                  <option value="is">{t("analytics.op.is")}</option>
                  <option value="not">{t("analytics.op.not")}</option>
                </Select>
                <div className="analytics__condition-value">
                  {c.field === "predicate" ? (
                    <Select
                      aria-label={t("analytics.field.predicate")}
                      value={c.values[0] ?? ""}
                      onChange={(e) => updateCondition(c.id, { values: e.target.value ? [e.target.value] : [] })}
                    >
                      <option value="">{t("analytics.choosePredicate")}</option>
                      {[...new Set([...predicates, ...c.values])].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <EntityPicker
                      multiple
                      ariaLabel={t(`analytics.field.${c.field}` as MessageKey)}
                      valueKind="uri"
                      types={c.field === "task" ? ["task"] : undefined}
                      options={
                        c.field === "subject_uri"
                          ? subjects.map((uri) => {
                              const ref = parseEntityUri(uri);
                              return { type: ref?.entityType ?? ("user" as EntityType), id: ref?.entityId ?? uri, title: subjectLabel(uri) };
                            })
                          : undefined
                      }
                      value={c.values}
                      onChange={(values) => updateCondition(c.id, { values })}
                    />
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setConditions((prev) => prev.filter((x) => x.id !== c.id))}>
                  {t("analytics.removeCondition")}
                </Button>
              </div>
            ))}
            <div className="row-actions">
              <Button variant="outline" size="sm" onClick={() => setConditions((prev) => [...prev, newCondition()])}>
                {t("analytics.addCondition")}
              </Button>
              {conditions.length > 0 || types.length > 0 || timeFrom || timeTo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConditions([]);
                    setTypes([]);
                    setTimeFrom("");
                    setTimeTo("");
                  }}
                >
                  {t("analytics.clear")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {query.isLoading ? (
        <p className="muted">{t("app.loading")}</p>
      ) : streams.length === 0 ? (
        <EmptyState items={t("streams.items")} description={inSpan.length > 0 ? t("analytics.noneMatch") : t("analytics.noneInPeriod")} />
      ) : (
        <>
          {inSpan.length >= STREAM_ANALYTICS_LIMIT ? <p className="muted">{t("analytics.limited", { limit: num(STREAM_ANALYTICS_LIMIT) })}</p> : null}
          <div className="stat-grid">
            <Card>
              <div className="stat-label">{t("analytics.metric.count")}</div>
              <div className="stat-value">{num(totals.count)}</div>
              {totals.open > 0 ? <div className="stat-note">{t("analytics.openCount", { count: num(totals.open) })}</div> : null}
            </Card>
            <Card>
              <div className="stat-label">{t("analytics.metric.quantity")}</div>
              <div className="stat-value">{num(totals.quantity)}</div>
            </Card>
            <Card>
              <div className="stat-label">{t("analytics.metric.duration")}</div>
              <div className="stat-value">{formatDuration(totals.duration)}</div>
              <div className="stat-note">{t("analytics.hours", { hours: hours(totals.duration) })}</div>
            </Card>
            <Card>
              <div className="stat-label">{t("analytics.averageDuration")}</div>
              <div className="stat-value">{totals.timed ? formatDuration(totals.duration / totals.timed) : "—"}</div>
            </Card>
          </div>

          <Card>
            <div className="stack">
              <div className="panel-head">
                <div className="panel-title">{t("analytics.overTime")}</div>
                <div className="row-actions">
                  <Select aria-label={t("analytics.metric")} value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
                    {METRICS.map((m) => (
                      <option key={m} value={m}>
                        {t(`analytics.metric.${m}` as MessageKey)}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label={t("analytics.granularity")} value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity | "auto")}>
                    {(["auto", "hour", "day", "week", "month"] as const).map((g) => (
                      <option key={g} value={g}>
                        {t(`analytics.granularity.${g}` as MessageKey)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <BarChart
                bars={buckets.map((b) => ({ key: b.start.getTime(), value: metricValue(b.totals), label: bucketLabel(b.start, bucketSize, intlLocale) }))}
                format={metricText}
                label={t(`analytics.metric.${metric}` as MessageKey)}
              />
            </div>
          </Card>

          <Card>
            <div className="stack">
              <div className="panel-head">
                <div className="panel-title">{t("analytics.breakdown")}</div>
                <Select aria-label={t("analytics.groupBy")} value={grouping} onChange={(e) => setGrouping(e.target.value as StreamGrouping)}>
                  {STREAM_GROUPINGS.map((g) => (
                    <option key={g} value={g}>
                      {t(`analytics.group.${g}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t(`analytics.group.${grouping}` as MessageKey)}</th>
                      <th className="num">{t("analytics.metric.count")}</th>
                      <th className="num">{t("analytics.metric.quantity")}</th>
                      <th className="num">{t("analytics.metric.duration")}</th>
                      <th>{t("analytics.share")}</th>
                      <th className="action-row-cell" aria-label={t("streams.actions")} />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.slice(0, 100).map((g) => {
                      const share = groupTotal > 0 ? metricValue(g.totals) / groupTotal : 0;
                      const uri = g.key && grouping !== "predicate" && grouping !== "type" && isEntityUri(g.key) ? g.key : undefined;
                      return (
                        <tr key={g.key ?? "—"} className="action-row">
                          <td className="wrap">{groupLabel(g.key)}</td>
                          <td className="num">{num(g.totals.count)}</td>
                          <td className="num">{num(g.totals.quantity)}</td>
                          <td className="num">{formatDuration(g.totals.duration)}</td>
                          <td>
                            <span className="analytics__share" title={`${Math.round(share * 100)} %`}>
                              <span className="analytics__share-bar" style={{ inlineSize: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }} />
                              <span className="analytics__share-text">{Math.round(share * 100)} %</span>
                            </span>
                          </td>
                          <td className="action-row-cell">
                            {g.key != null ? (
                              <ActionMenu
                                name={groupLabel(g.key)}
                                uri={uri}
                                actions={[{ key: "filter", label: t("analytics.filterOn"), onSelect: () => addGroupCondition(g.key) }]}
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          <Card>
            <div className="stack">
              <div className="panel-title">{t("analytics.matching", { count: num(streams.length) })}</div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("streams.action")}</th>
                      <th>{t("streams.start")}</th>
                      <th>{t("streams.object")}</th>
                      <th className="num">{t("streams.duration")}</th>
                      <th className="num">{t("streams.quantity")}</th>
                      <th>{t("streams.motivation")}</th>
                      <th className="action-row-cell" aria-label={t("streams.actions")} />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id} className="action-row">
                        <td className="wrap">{s.action}</td>
                        <td>{when.format(new Date(s.start_date))}</td>
                        <td className="wrap">{uriLabel(s.object_uri)}</td>
                        <td className="num">{s.duration_seconds != null ? formatDuration(s.duration_seconds) : t("streams.ongoing")}</td>
                        <td className="num">{num(s.quantity)}</td>
                        <td className="wrap">{uriLabel(s.motivation_uri)}</td>
                        <td className="action-row-cell">
                          <ActionMenu name={s.action} uri={toEntityUri("stream", s.id)} actions={[{ key: "edit", label: t("streams.edit"), onSelect: () => editStream(s) }]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {streams.length > shown.length ? <p className="muted">{t("analytics.showingLatest", { count: num(shown.length) })}</p> : null}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function bucketLabel(start: Date, granularity: Granularity, locale: string): string {
  const options: Intl.DateTimeFormatOptions =
    granularity === "hour"
      ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
      : granularity === "month"
        ? { month: "short", year: "numeric" }
        : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(locale, options).format(start);
}

/**
 * One series of bars over time, in the primary accent: rounded tops on the baseline, a 2px gap
 * between bars, a recessive grid and a tooltip per bar (hover or focus).
 */
function BarChart({ bars, format, label }: { bars: { key: number; value: number; label: string }[]; format: (value: number) => string; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  // Drawn at the figure's own width in pixels, so the text stays its size on phones and wide screens.
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const max = Math.max(0, ...bars.map((b) => b.value));
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 28, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const step = bars.length ? plotW / bars.length : plotW;
  const barW = Math.max(1, step - 2);
  const y = (v: number) => (max > 0 ? (v / max) * plotH : 0);
  const ticks = [0.5, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(2, Math.floor(width / 110))));
  const hovered = active != null ? bars[active] : null;

  return (
    <figure ref={ref} className="analytics-chart" aria-label={label}>
      <div className="analytics-chart__readout" aria-live="polite">
        {hovered ? (
          <>
            <span className="analytics-chart__readout-label">{hovered.label}</span> <strong>{format(hovered.value)}</strong>
          </>
        ) : (
          <span className="muted">{label}</span>
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="analytics-chart__svg" role="img" aria-label={label} onMouseLeave={() => setActive(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={pad.top + plotH - y(v)} y2={pad.top + plotH - y(v)} className="analytics-chart__grid" />
            {max > 0 ? (
              <text x={pad.left + 2} y={pad.top + plotH - y(v) - 4} className="analytics-chart__tick">
                {format(v)}
              </text>
            ) : null}
          </g>
        ))}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} className="analytics-chart__axis" />
        {bars.map((b, i) => {
          const h = y(b.value);
          const x = pad.left + i * step + 1;
          const r = Math.min(4, barW / 2, h);
          const top = pad.top + plotH - h;
          const base = pad.top + plotH;
          return (
            <g key={b.key} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} tabIndex={0} className="analytics-chart__bar-group">
              {/* A hit target the full height of the plot, wider than thin bars. */}
              <rect x={pad.left + i * step} y={pad.top} width={step} height={plotH} fill="transparent" />
              {h > 0 ? (
                <path
                  className={active === i ? "analytics-chart__bar analytics-chart__bar--active" : "analytics-chart__bar"}
                  d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`}
                />
              ) : null}
              <title>{`${b.label}: ${format(b.value)}`}</title>
              {i % labelEvery === 0 ? (
                <text x={i === 0 ? x : x + barW / 2} y={height - 8} textAnchor={i === 0 ? "start" : "middle"} className="analytics-chart__tick">
                  {b.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
