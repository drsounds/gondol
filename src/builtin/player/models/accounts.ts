import { playerDb } from "./db";
import { sessionUserId } from "../../../supabase/session";
import type { ServiceAccountStore } from "../../../playback/accounts";
import type { ServiceAccount } from "../../../playback/types";

/**
 * Service sessions as `external_service_accounts` rows: one per account a user signed a service in
 * with, private to them (RLS: only the owner reads or writes; never shared with a workspace). A
 * row is `signed_in` or `signed_out`; signing in again re-uses the row for the same external
 * account. Secrets (tokens, API keys) go to `external_service_account_secrets` through
 * `set_external_service_account_secret()`, which the browser can write but never read.
 */
export interface ExternalServiceAccount {
  id: string;
  user_id: string;
  service_id: string;
  name: string;
  external_id: string | null;
  image_url: string | null;
  status: "signed_in" | "signed_out";
  signed_in_at: string | null;
  signed_out_at: string | null;
  has_secret: boolean;
  identifier: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export const ACCOUNT_COLUMNS = "id, user_id, service_id, name, external_id, image_url, status, signed_in_at, signed_out_at, has_secret, identifier, slug, created_at, updated_at";

/**
 * The signed-in user's accounts, cached for the page: services ask `current()` synchronously, and
 * the Music services page and the service dock re-render through `subscribe` (useSyncExternalStore).
 */
class AccountsCache {
  rows: ExternalServiceAccount[] = [];
  loaded = false;
  error: string | null = null;
  private listeners = new Set<() => void>();
  private loading: Promise<ExternalServiceAccount[]> | null = null;
  private version = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** (Re)loads the rows; concurrent calls share one request. */
  load(): Promise<ExternalServiceAccount[]> {
    this.loading ??= (async () => {
      try {
        const { data: session } = await playerDb().auth.getSession();
        const userId = session.session?.user.id;
        if (!userId) {
          this.rows = [];
        } else {
          const { data, error } = await playerDb()
            .from("external_service_accounts")
            .select(ACCOUNT_COLUMNS)
            .eq("user_id", userId)
            .order("signed_in_at", { ascending: false, nullsFirst: false });
          if (error) throw error;
          this.rows = (data ?? []) as ExternalServiceAccount[];
        }
        this.error = null;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
      } finally {
        this.loaded = true;
        this.loading = null;
        this.changed();
      }
      return this.rows;
    })();
    return this.loading;
  }
}

export const accountsCache = new AccountsCache();

/** Writes an account's secret (null removes it). The browser can never read it back. */
export async function setAccountSecret(accountId: string, secret: Record<string, unknown> | null) {
  const { error } = await playerDb().rpc("set_external_service_account_secret", { p_account_id: accountId, p_secret: secret });
  if (error) throw error;
}

/** Signs `serviceId` in with `account`: re-uses the row for the same external account (or name). */
export async function saveSignIn(serviceId: string, account: ServiceAccount, secret?: Record<string, unknown> | null): Promise<ExternalServiceAccount> {
  const userId = await sessionUserId();
  const now = new Date().toISOString();
  const all = accountsCache.loaded ? accountsCache.rows : await accountsCache.load();
  const existing =
    (account.id ? all.find((a) => a.id === account.id) : undefined) ??
    all.find((a) => a.service_id === serviceId && (account.externalId ? a.external_id === account.externalId : a.name === account.name.trim()));
  const values = {
    name: account.name.trim() || serviceId,
    external_id: account.externalId ?? null,
    image_url: account.imageUrl ?? null,
    status: "signed_in",
    signed_in_at: now,
  };
  // One signed-in account per service (a unique index holds to it): sign the others out first.
  const others = all.filter((a) => a.service_id === serviceId && a.status === "signed_in" && a.id !== existing?.id).map((a) => a.id);
  if (others.length) {
    const { error: outError } = await playerDb().from("external_service_accounts").update({ status: "signed_out", signed_out_at: now }).in("id", others);
    if (outError) throw outError;
  }
  const { data, error } = existing
    ? await playerDb().from("external_service_accounts").update(values).eq("id", existing.id).select(ACCOUNT_COLUMNS).single()
    : await playerDb().from("external_service_accounts").insert({ ...values, user_id: userId, service_id: serviceId }).select(ACCOUNT_COLUMNS).single();
  if (error) throw error;
  const row = data as ExternalServiceAccount;
  if (secret !== undefined) await setAccountSecret(row.id, secret);
  await accountsCache.load();
  return row;
}

/** Signs `serviceId` out (one account, or every signed-in one) and drops the secrets. */
export async function saveSignOut(serviceId: string, accountId?: string): Promise<void> {
  const userId = await sessionUserId();
  let query = playerDb()
    .from("external_service_accounts")
    .update({ status: "signed_out", signed_out_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("service_id", serviceId)
    .eq("status", "signed_in");
  if (accountId) query = query.eq("id", accountId);
  const { data, error } = await query.select("id");
  if (error) throw error;
  for (const row of (data ?? []) as { id: string }[]) await setAccountSecret(row.id, null);
  await accountsCache.load();
}

/** Deletes an account row (its secret goes with it). */
export async function deleteAccount(accountId: string): Promise<void> {
  const { error } = await playerDb().from("external_service_accounts").delete().eq("id", accountId);
  if (error) throw error;
  await accountsCache.load();
}

const toAccount = (row: ExternalServiceAccount): ServiceAccount => ({
  id: row.id,
  name: row.name,
  externalId: row.external_id ?? undefined,
  imageUrl: row.image_url ?? undefined,
});

/** The store services keep their sessions in (playback/accounts.ts), on these rows. */
export function databaseAccountStore(): ServiceAccountStore {
  return {
    current: (serviceId) => {
      const row = accountsCache.rows.find((r) => r.service_id === serviceId && r.status === "signed_in");
      return row ? toAccount(row) : null;
    },
    signedIn: async (serviceId, account, secret) => toAccount(await saveSignIn(serviceId, account, secret)),
    signedOut: (serviceId) => saveSignOut(serviceId),
    subscribe: accountsCache.subscribe,
  };
}
