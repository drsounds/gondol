import { beforeEach, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { clearPersistedQueryCache, restoreQueryCache } from "./queryCache";

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
    savedAt: Date.now(),
    state: { mutations: [], queries: [{ queryKey: ["a"], queryHash: '["a"]', state: { data: 1, dataUpdateCount: 1, dataUpdatedAt: 1, error: null, errorUpdateCount: 0, errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false, status: "success", fetchStatus: "idle" } }] },
  }));
  const client = new QueryClient();
  expect(restoreQueryCache(client)).toBe(true);
  expect(client.getQueryData(["a"])).toBe(1);
});

test("drops expired and cleared caches", () => {
  store.set("gondol:query-cache", JSON.stringify({ savedAt: 0, state: { mutations: [], queries: [] } }));
  expect(restoreQueryCache(new QueryClient())).toBe(false);
  expect(store.size).toBe(0);
  store.set("gondol:query-cache", "x");
  clearPersistedQueryCache();
  expect(store.size).toBe(0);
});
