import { useQuery } from "@tanstack/react-query";
import { parseEntityUri } from "../../../entities/uri";
import { sessionUserId } from "../../../supabase/session";
import { streamsDb, streamsKey, type Stream } from "../../streams/models";

/** The URI fields of a stream a condition can test, plus `task` (its context or object is the task). */
export const STREAM_URI_FIELDS = ["subject_uri", "object_uri", "context_uri", "motivation_uri", "task"] as const;
export type StreamUriField = (typeof STREAM_URI_FIELDS)[number];
export type StreamConditionField = StreamUriField | "predicate";
export const STREAM_CONDITION_FIELDS: readonly StreamConditionField[] = ["subject_uri", "predicate", "object_uri", "context_uri", "motivation_uri", "task"];

/** One condition: a field is (or isn't) one of `values` (URIs, or predicates). */
export type StreamCondition = { id: string; field: StreamConditionField; op: "is" | "not"; values: string[] };

export type StreamFilter = {
  /** ISO timestamps; a stream counts when it starts inside the span. Null is open-ended. */
  from: string | null;
  to: string | null;
  /** "HH:MM" both or neither: only streams starting at that time of day (wrapping past midnight). */
  timeFrom: string;
  timeTo: string;
  /** The object's entity types; empty for every type. */
  types: string[];
  conditions: StreamCondition[];
  match: "all" | "any";
};

/** The entity type of a URI, or null. */
export const uriType = (uri: string | null | undefined): string | null => (uri ? (parseEntityUri(uri)?.entityType ?? null) : null);

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

function fieldValues(stream: Stream, field: StreamConditionField): (string | null)[] {
  switch (field) {
    case "predicate":
      return [stream.action];
    case "task":
      return [stream.context_uri, stream.object_uri].filter((u) => uriType(u) === "task");
    default:
      return [stream[field]];
  }
}

function conditionHolds(stream: Stream, condition: StreamCondition): boolean {
  if (condition.values.length === 0) return true;
  const wanted = new Set(condition.values.map((v) => v.trim().toLowerCase()));
  const hit = fieldValues(stream, condition.field).some((v) => !!v && wanted.has(v.trim().toLowerCase()));
  return condition.op === "is" ? hit : !hit;
}

/** Whether a stream passes the filter's time of day, types and conditions (the span is the query's). */
export function streamMatches(stream: Stream, filter: StreamFilter): boolean {
  const from = minutesOf(filter.timeFrom);
  const to = minutesOf(filter.timeTo);
  if (from != null && to != null && from !== to) {
    const d = new Date(stream.start_date);
    const at = d.getHours() * 60 + d.getMinutes();
    const inside = from < to ? at >= from && at < to : at >= from || at < to;
    if (!inside) return false;
  }
  if (filter.types.length > 0 && !filter.types.includes(uriType(stream.object_uri) ?? "")) return false;
  const active = filter.conditions.filter((c) => c.values.length > 0);
  if (active.length === 0) return true;
  return filter.match === "all" ? active.every((c) => conditionHolds(stream, c)) : active.some((c) => conditionHolds(stream, c));
}

/** The most rows one analysis reads. */
export const STREAM_ANALYTICS_LIMIT = 10000;

/** The user's streams that start inside the span, oldest first. */
export function useStreamsInSpan(from: string | null, to: string | null) {
  return useQuery({
    queryKey: [...streamsKey, "analytics", from, to],
    queryFn: async () => {
      const userId = await sessionUserId();
      let query = streamsDb().from("streams").select("*").eq("user_id", userId);
      if (from) query = query.gte("start_date", from);
      if (to) query = query.lt("start_date", to);
      const { data, error } = await query.order("start_date").limit(STREAM_ANALYTICS_LIMIT);
      if (error) throw error;
      return (data ?? []).map((s) => ({ ...s, quantity: Number(s.quantity ?? 1) })) as Stream[];
    },
  });
}

export type StreamTotals = { count: number; quantity: number; duration: number; timed: number; open: number };

export function totalsOf(streams: readonly Stream[]): StreamTotals {
  const totals: StreamTotals = { count: 0, quantity: 0, duration: 0, timed: 0, open: 0 };
  for (const s of streams) {
    totals.count += 1;
    totals.quantity += s.quantity;
    if (s.duration_seconds != null) {
      totals.duration += s.duration_seconds;
      totals.timed += 1;
    } else if (!s.end_date) totals.open += 1;
  }
  return totals;
}

export type Granularity = "hour" | "day" | "week" | "month";

/** A sensible bucket for a span. */
export function autoGranularity(from: Date, to: Date): Granularity {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 2) return "hour";
  if (days <= 92) return "day";
  if (days <= 731) return "week";
  return "month";
}

/** The local start of the bucket `date` falls in (weeks start on Monday). */
export function bucketStart(date: Date, granularity: Granularity): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  if (granularity === "hour") return d;
  d.setHours(0);
  if (granularity === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (granularity === "month") d.setDate(1);
  return d;
}

function nextBucket(date: Date, granularity: Granularity): Date {
  const d = new Date(date);
  if (granularity === "hour") d.setHours(d.getHours() + 1);
  else if (granularity === "day") d.setDate(d.getDate() + 1);
  else if (granularity === "week") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export type Bucket = { start: Date; totals: StreamTotals };

/** Streams per bucket from `from` to `to`, empty buckets included (at most 400). */
export function bucketize(streams: readonly Stream[], from: Date, to: Date, granularity: Granularity): Bucket[] {
  const byKey = new Map<number, Stream[]>();
  for (const s of streams) {
    const key = bucketStart(new Date(s.start_date), granularity).getTime();
    byKey.set(key, [...(byKey.get(key) ?? []), s]);
  }
  const buckets: Bucket[] = [];
  for (let at = bucketStart(from, granularity); at < to && buckets.length < 400; at = nextBucket(at, granularity)) {
    buckets.push({ start: at, totals: totalsOf(byKey.get(at.getTime()) ?? []) });
  }
  return buckets;
}

export type StreamGrouping = "predicate" | "object_uri" | "type" | "context_uri" | "motivation_uri" | "subject_uri";
export const STREAM_GROUPINGS: readonly StreamGrouping[] = ["predicate", "object_uri", "type", "context_uri", "motivation_uri", "subject_uri"];

export type StreamGroup = { key: string | null; totals: StreamTotals };

/** Streams grouped by a field, largest first by `metric`. */
export function groupStreams(streams: readonly Stream[], grouping: StreamGrouping, metric: keyof Pick<StreamTotals, "count" | "quantity" | "duration">): StreamGroup[] {
  const groups = new Map<string | null, Stream[]>();
  for (const s of streams) {
    const key = grouping === "predicate" ? s.action : grouping === "type" ? uriType(s.object_uri) : s[grouping];
    groups.set(key ?? null, [...(groups.get(key ?? null) ?? []), s]);
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, totals: totalsOf(rows) })).sort((a, b) => b.totals[metric] - a.totals[metric]);
}
