import type { ServiceAccount } from "./types";

/**
 * Where services keep their sessions: the player app stores them as `external_service_accounts`
 * rows (private to their owner, secrets write-only), so a sign-in lasts across devices and
 * "Music services" lists them. Services read and write sessions only through this store.
 */
export interface ServiceAccountStore {
  /** The account `serviceId` is signed in with, if any. */
  current(serviceId: string): ServiceAccount | null;
  /** Records a sign-in; `secret` (a token, a key) is stored write-only. Resolves to the stored account. */
  signedIn(serviceId: string, account: ServiceAccount, secret?: Record<string, unknown>): Promise<ServiceAccount>;
  /** Records a sign-out of `serviceId` (its secret is dropped). */
  signedOut(serviceId: string): Promise<void>;
  /** Calls `listener` when accounts change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** In-memory accounts, until the player app hands over the database's (and in tests). */
export function memoryAccountStore(): ServiceAccountStore {
  const accounts = new Map<string, ServiceAccount>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());
  return {
    current: (serviceId) => accounts.get(serviceId) ?? null,
    signedIn: async (serviceId, account) => {
      accounts.set(serviceId, account);
      changed();
      return account;
    },
    signedOut: async (serviceId) => {
      accounts.delete(serviceId);
      changed();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

let store: ServiceAccountStore = memoryAccountStore();
const storeListeners = new Set<() => void>();

/** The store services use now. */
export function serviceAccounts(): ServiceAccountStore {
  return store;
}

/** Replaces the store (the player app, once it's on). */
export function setServiceAccountStore(next: ServiceAccountStore): void {
  store = next;
  storeListeners.forEach((l) => l());
}

/** Calls `listener` when the store is replaced or its accounts change. */
export function subscribeServiceAccounts(listener: () => void): () => void {
  storeListeners.add(listener);
  let inner = store.subscribe(listener);
  const swap = () => {
    inner();
    inner = store.subscribe(listener);
  };
  storeListeners.add(swap);
  return () => {
    inner();
    storeListeners.delete(listener);
    storeListeners.delete(swap);
  };
}
