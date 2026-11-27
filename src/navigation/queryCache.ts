import { dehydrate, hydrate, type DefaultOptions, type Query, type QueryClient } from "@tanstack/react-query";
import { namespaced } from "../shell/storage";

/**
 * Every page's data is kept on the device: the query client keeps loaded queries for a week
 * (queryClientDefaults' gcTime, not React Query's five minutes, after which a page left behind would
 * be forgotten), and persistQueryCache() writes them to localStorage, so a page visited before,
 * in this visit or an earlier one, shows its last data at once and refreshes it in the background
 * (stale-while-revalidate). Data never loaded shows as skeletons (src/shell/Skeleton.tsx).
 *
 * A query opts out with `meta: { persist: false }` (secrets, huge or short-lived data). Signing out
 * forgets the cache (clearQueryCacheOnSignOut), so the next account never sees the previous one's.
 */

const STORAGE_NAME = "query-cache";
/** Cached data older than this is dropped instead of shown as stale. */
export const QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AGE_MS = QUERY_CACHE_MAX_AGE_MS;
const WRITE_DELAY_MS = 1000;
/** At most this many queries are persisted, the most recently loaded first. */
const MAX_PERSISTED_QUERIES = 400;

/**
 * Defaults for the app's QueryClient: loaded data stays in memory as long as it is persisted, counts
 * as fresh for 30 s (navigating back and forth doesn't refetch everything) and isn't refetched on
 * every window focus. Mutations invalidate what they change as before.
 */
export const queryClientDefaults: DefaultOptions = {
  queries: {
    gcTime: QUERY_CACHE_MAX_AGE_MS,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  },
};
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
    const fresh = persisted.state.queries.filter((query) => now - query.state.dataUpdatedAt <= MAX_AGE_MS);
    hydrate(queryClient, { ...persisted.state, queries: fresh });
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
    const savedAt = Date.now();
    // The most recently loaded queries first, so a full store keeps those.
    const recent = queryClient
      .getQueryCache()
      .getAll()
      .filter(shouldPersist)
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
      .slice(0, MAX_PERSISTED_QUERIES);
    let keep = recent.length;
    while (keep > 0) {
      const allowed = new Set(recent.slice(0, keep));
      try {
        const state = dehydrate(queryClient, { shouldDehydrateQuery: (query) => allowed.has(query) });
        store.setItem(namespaced(STORAGE_NAME), stringifyCache({ version: CACHE_VERSION, savedAt, state }));
        return;
      } catch {
        // Storage full: try again with the more recent half.
        keep = Math.floor(keep / 2);
      }
    }
    store.removeItem(namespaced(STORAGE_NAME));
  };
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (timer === undefined) timer = setTimeout(write, WRITE_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
  };
}

function shouldPersist(query: Query): boolean {
  return query.state.status === "success" && query.meta?.persist !== false;
}

/** Forgets the persisted cache, e.g. on sign out, so the next user doesn't see the previous one's data. */
export function clearPersistedQueryCache(): void {
  storage()?.removeItem(namespaced(STORAGE_NAME));
}

/**
 * Empties the client and the persisted cache when the user signs out (or the session ends). Pass
 * the auth client's onAuthStateChange; returns a stop function.
 */
export function clearQueryCacheOnSignOut(
  queryClient: QueryClient,
  onAuthStateChange: (callback: (event: string) => void) => { data: { subscription: { unsubscribe: () => void } } },
): () => void {
  const { data } = onAuthStateChange((event) => {
    if (event !== "SIGNED_OUT") return;
    clearPersistedQueryCache();
    queryClient.clear();
  });
  return () => data.subscription.unsubscribe();
}
