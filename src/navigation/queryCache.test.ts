import { beforeEach, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { clearPersistedQueryCache, persistQueryCache, restoreQueryCache } from "./queryCache";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
});

test("restores persisted queries as stale data", () => {
  store.set("gondol:query-cache", JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    state: { mutations: [], queries: [{ queryKey: ["a"], queryHash: '["a"]', state: { data: 1, dataUpdateCount: 1, dataUpdatedAt: Date.now(), error: null, errorUpdateCount: 0, errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false, status: "success", fetchStatus: "idle" } }] },
  }));
  const client = new QueryClient();
  expect(restoreQueryCache(client)).toBe(true);
  expect(client.getQueryData(["a"])).toBe(1);
});

test("persists and restores Set query data", async () => {
  const client = new QueryClient();
  const stop = persistQueryCache(client);
  client.setQueryData(["set"], new Set(["value"]));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  stop();

  const restored = new QueryClient();
  expect(restoreQueryCache(restored)).toBe(true);
  expect(restored.getQueryData(["set"])).toEqual(new Set(["value"]));
});

test("persists Maps and Dates, and leaves out data it can't keep", async () => {
  class Box {
    constructor(public value: number) {}
  }
  const client = new QueryClient();
  const stop = persistQueryCache(client);
  client.setQueryData(["map"], new Map([["a", { when: new Date(5), tags: new Set([1]) }]]));
  client.setQueryData(["box"], { box: new Box(1) });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  stop();

  const restored = new QueryClient();
  expect(restoreQueryCache(restored)).toBe(true);
  const map = restored.getQueryData<Map<string, { when: Date; tags: Set<number> }>>(["map"]);
  expect(map).toBeInstanceOf(Map);
  expect(map?.get("a")?.when).toEqual(new Date(5));
  expect(map?.get("a")?.tags).toEqual(new Set([1]));
  expect(restored.getQueryData(["box"])).toBeUndefined();
});

test("drops caches from an older format", () => {
  store.set("gondol:query-cache", JSON.stringify({ version: 1, savedAt: Date.now(), state: { mutations: [], queries: [] } }));
  expect(restoreQueryCache(new QueryClient())).toBe(false);
  expect(store.size).toBe(0);
});

test("drops expired and cleared caches", () => {
  store.set("gondol:query-cache", JSON.stringify({ version: 2, savedAt: 0, state: { mutations: [], queries: [] } }));
  expect(restoreQueryCache(new QueryClient())).toBe(false);
  expect(store.size).toBe(0);
  store.set("gondol:query-cache", JSON.stringify({ savedAt: Date.now(), state: { mutations: [], queries: [] } }));
  expect(restoreQueryCache(new QueryClient())).toBe(false);
  expect(store.size).toBe(0);
  store.set("gondol:query-cache", "x");
  clearPersistedQueryCache();
  expect(store.size).toBe(0);
});

test("leaves out queries that opt out, and keeps the most recent when storage is full", async () => {
  const client = new QueryClient();
  client.getQueryCache().build(client, { queryKey: ["secret"], meta: { persist: false } });
  client.setQueryData(["secret"], "hidden");
  client.setQueryData(["old"], "a", { updatedAt: Date.now() - 1000 });
  client.setQueryData(["new"], "b");
  // A store with room for one query only.
  const window = (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window;
  const setItem = window.localStorage.setItem;
  window.localStorage.setItem = (k, v) => {
    if (v.includes('"old"') && v.includes('"new"')) throw new Error("QuotaExceededError");
    setItem(k, v);
  };
  const stop = persistQueryCache(client);
  client.setQueryData(["new"], "c");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  stop();

  const restored = new QueryClient();
  expect(restoreQueryCache(restored)).toBe(true);
  expect(restored.getQueryData(["new"])).toBe("c");
  expect(restored.getQueryData(["old"])).toBeUndefined();
  expect(restored.getQueryData(["secret"])).toBeUndefined();
});

test("drops single queries older than the cache's age limit", () => {
  const query = (key: string, dataUpdatedAt: number) => ({
    queryKey: [key], queryHash: `["${key}"]`,
    state: { data: key, dataUpdateCount: 1, dataUpdatedAt, error: null, errorUpdateCount: 0, errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false, status: "success", fetchStatus: "idle" },
  });
  store.set("gondol:query-cache", JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    state: { mutations: [], queries: [query("fresh", Date.now()), query("ancient", 1)] },
  }));
  const client = new QueryClient();
  expect(restoreQueryCache(client)).toBe(true);
  expect(client.getQueryData(["fresh"])).toBe("fresh");
  expect(client.getQueryData(["ancient"])).toBeUndefined();
});
