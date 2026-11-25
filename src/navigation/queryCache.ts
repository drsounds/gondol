import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import { namespaced } from "../shell/storage";

const STORAGE_NAME = "query-cache";
/** Cached data older than this is dropped instead of shown as stale. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WRITE_DELAY_MS = 1000;

interface PersistedCache {
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
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
    const persisted = JSON.parse(raw) as PersistedCache;
    if (!persisted?.state || now - persisted.savedAt > MAX_AGE_MS) {
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
      store.setItem(namespaced(STORAGE_NAME), JSON.stringify({ savedAt: Date.now(), state } satisfies PersistedCache));
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
