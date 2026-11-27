import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import { namespaced } from "../shell/storage";

const STORAGE_NAME = "query-cache";
/** Cached data older than this is dropped instead of shown as stale. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WRITE_DELAY_MS = 1000;
/** Bumped whenever the format changes; older caches are dropped. 2: Maps and Dates kept, unsupported data skipped. */
const CACHE_VERSION = 2;
const TYPE_MARKER = "__gondolQueryCacheType";

interface PersistedCache {
  version: typeof CACHE_VERSION;
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
}

class Unsupported extends Error {}

/**
 * Turns query data into plain JSON, keeping Sets, Maps and Dates. Anything else JSON would silently
 * change (class instances, functions, …) throws, so that query isn't persisted: a page given a
 * Map back as `{}` crashes on load (`map.get is not a function`).
 */
function encode(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === undefined) return undefined;
  if (typeof value !== "object") throw new Unsupported();
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : encode(item)));
  if (value instanceof Set) return { [TYPE_MARKER]: "Set", values: [...value].map(encode) };
  if (value instanceof Map) return { [TYPE_MARKER]: "Map", entries: [...value].map(([k, v]) => [encode(k), encode(v)]) };
  if (value instanceof Date) return { [TYPE_MARKER]: "Date", time: value.getTime() };
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Unsupported();
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = encode(item);
  }
  return out;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  switch (record[TYPE_MARKER]) {
    case "Set":
      return new Set((record.values as unknown[]).map(decode));
    case "Map":
      return new Map((record.entries as [unknown, unknown][]).map(([k, v]) => [decode(k), decode(v)]));
    case "Date":
      return new Date(record.time as number);
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) out[key] = decode(item);
  return out;
}

/** The dehydrated state with every query's data encoded; queries whose data can't be kept are left out. */
function encodeState(state: ReturnType<typeof dehydrate>): ReturnType<typeof dehydrate> {
  const queries = state.queries.flatMap((query) => {
    try {
      return [{ ...query, state: { ...query.state, data: encode(query.state.data) } }];
    } catch {
      return [];
    }
  });
  return { ...state, queries };
}

function decodeState(state: ReturnType<typeof dehydrate>): ReturnType<typeof dehydrate> {
  return {
    ...state,
    queries: state.queries.map((query) => ({ ...query, state: { ...query.state, data: decode(query.state.data) } })),
  };
}

function stringifyCache(value: PersistedCache): string {
  return JSON.stringify({ ...value, state: encodeState(value.state) });
}

function parseCache(raw: string): PersistedCache {
  const parsed = JSON.parse(raw) as PersistedCache;
  if (parsed?.version !== CACHE_VERSION || !parsed.state) return parsed;
  return { ...parsed, state: decodeState(parsed.state) };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Puts what an earlier visit cached back into the client, so revisited pages show it at once while it refetches. */
export function restoreQueryCache(queryClient: QueryClient, now: number = Date.now()): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const raw = store.getItem(namespaced(STORAGE_NAME));
    if (!raw) return false;
    const persisted = parseCache(raw);
    if (persisted?.version !== CACHE_VERSION || !persisted.state || now - persisted.savedAt > MAX_AGE_MS) {
      store.removeItem(namespaced(STORAGE_NAME));
      return false;
    }
    hydrate(queryClient, persisted.state);
    return true;
  } catch {
    store.removeItem(namespaced(STORAGE_NAME));
    return false;
  }
}

/** Saves the client's successfully loaded queries to localStorage whenever the cache changes. Returns a stop function. */
export function persistQueryCache(queryClient: QueryClient): () => void {
  const store = storage();
  if (!store) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    timer = undefined;
    try {
      const state = dehydrate(queryClient, { shouldDehydrateQuery: (query) => query.state.status === "success" });
      store.setItem(namespaced(STORAGE_NAME), stringifyCache({ version: CACHE_VERSION, savedAt: Date.now(), state }));
    } catch {
      // Storage full or data not serializable: the cache just isn't persisted.
    }
  };
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (timer === undefined) timer = setTimeout(write, WRITE_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** Forgets the persisted cache, e.g. on sign out, so the next user doesn't see the previous one's data. */
export function clearPersistedQueryCache(): void {
  storage()?.removeItem(namespaced(STORAGE_NAME));
}
