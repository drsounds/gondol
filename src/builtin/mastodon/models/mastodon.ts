import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "../../../supabase/client";
import { useSession } from "../../../supabase/useSession";
import { toEntityUri } from "../../../entities/uri";
import type { Json } from "../../../supabase/types";
import type {
  AdminAccount,
  DomainBlock,
  MAccount,
  MastodonAccountRow,
  MastodonDatabase,
  MastodonInstance,
  MastodonList,
  MastodonListAccount,
  MNotification,
  MSearchResults,
  MStatus,
  MThread,
} from "./types";

/** The shared client, typed with the app's tables and functions. */
export const mastodonDb = () => getSupabaseClient<MastodonDatabase>();

export const mastodonKey = ["gondol", "mastodon"] as const;
const PAGE = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

export const instanceUri = (row: { id: string }) => toEntityUri("mastodon_instance", row.id);
export const accountUri = (row: { id: string }) => toEntityUri("mastodon_account", row.id);
export const statusUri = (row: { id: string }) => toEntityUri("mastodon_status", row.id);
export const listUri = (row: { id: string }) => toEntityUri("mastodon_list", row.id);
export const domainBlockUri = (row: { id: string }) => toEntityUri("mastodon_domain_block", row.id);
export const notificationUri = (row: { id: string }) => toEntityUri("mastodon_notification", row.id);

/** A row's key in URLs: its slug, else its identifier. */
export const keyOf = (row: { slug?: string | null; identifier?: string | null; id: string }) => row.slug || row.identifier || row.id;

/** Where things live in the app. */
export const paths = {
  home: "/mastodon",
  tab: (tab: string) => (tab === "home" ? "/mastodon" : `/mastodon/${tab}`),
  compose: "/mastodon/new",
  reply: (status: MStatus) => `/mastodon/statuses/${keyOf(status)}/reply`,
  status: (status: { slug?: string | null; identifier?: string | null; id: string }) => `/mastodon/statuses/${keyOf(status)}`,
  editStatus: (status: MStatus) => `/mastodon/statuses/${keyOf(status)}/edit`,
  account: (account: { slug?: string | null; identifier?: string | null; id: string }) => `/mastodon/accounts/${keyOf(account)}`,
  newAccount: "/mastodon/accounts/new",
  editAccount: (account: { slug?: string | null; identifier?: string | null; id: string }) => `/mastodon/accounts/${keyOf(account)}/edit`,
  tag: (name: string) => `/mastodon/tags/${encodeURIComponent(name.toLowerCase())}`,
  lists: "/mastodon/lists",
  newList: "/mastodon/lists/new",
  list: (list: MastodonList) => `/mastodon/lists/${keyOf(list)}`,
  editList: (list: MastodonList) => `/mastodon/lists/${keyOf(list)}/edit`,
  search: (q?: string) => (q ? `/mastodon/search/${encodeURIComponent(q)}` : "/mastodon/search"),
  remote: "/mastodon/remote",
  instances: "/mastodon-instances",
  newInstance: "/mastodon-instances/new",
  instance: (instance: MastodonInstance) => `/mastodon-instances/${keyOf(instance)}`,
  editInstance: (instance: MastodonInstance) => `/mastodon-instances/${keyOf(instance)}/edit`,
};

const errorFrom = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message ?? "Something went wrong");
};

/** Asks the server to deliver what's queued now, rather than at the next minute's tick. */
export async function pokeDeliveries(): Promise<void> {
  try {
    await mastodonDb().functions.invoke("mastodon/deliver", { method: "POST", body: {} });
  } catch {
    // pg_cron delivers it within a minute anyway.
  }
}

// ── Instances ───────────────────────────────────────────────────────────────────────────────

export function useInstances() {
  const { session } = useSession();
  return useQuery({
    queryKey: [...mastodonKey, "instances"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await mastodonDb().from("mastodon_instances").select("*").is("soft_deleted_at", null).order("title");
      errorFrom(error);
      return (data ?? []) as MastodonInstance[];
    },
  });
}

export function findByKey<T extends { id: string; slug?: string | null; identifier?: string | null }>(rows: readonly T[], key: string | undefined): T | undefined {
  if (!key) return undefined;
  return rows.find((row) => row.slug === key || row.identifier === key || row.id === key);
}

export function useSaveInstance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<MastodonInstance> & { domain: string; title: string }) => {
      const { id, ...values } = input;
      const db = mastodonDb().from("mastodon_instances");
      const { data, error } = id ? await db.update(values).eq("id", id).select("*").single() : await db.insert(values).select("*").single();
      errorFrom(error);
      return data as MastodonInstance;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export function useDeleteInstance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await mastodonDb().from("mastodon_instances").update({ soft_deleted_at: new Date().toISOString() }).eq("id", id);
      errorFrom(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

// ── The user's own profiles and the one in use ───────────────────────────────────────────────

export function useMyAccounts() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: [...mastodonKey, "mine", userId ?? ""],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await mastodonDb()
        .from("mastodon_accounts")
        .select("*")
        .eq("user_id", userId!)
        .is("domain", null)
        .is("soft_deleted_at", null)
        .order("created_at");
      errorFrom(error);
      return (data ?? []) as MastodonAccountRow[];
    },
  });
}

const CURRENT_KEY = "gondol.mastodon.account";

function readCurrent(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

/**
 * The profile the client acts as: the one picked last on this device, else the first that can
 * post. Every profile of the user's is theirs to switch to.
 */
export function useCurrentAccount() {
  const mine = useMyAccounts();
  const [picked, setPicked] = useState<string | null>(() => (typeof window === "undefined" ? null : readCurrent()));
  const usable = useMemo(() => (mine.data ?? []).filter((a) => a.status === "active" || a.status === "silenced"), [mine.data]);
  const current = usable.find((a) => a.id === picked) ?? usable[0] ?? null;
  const pick = useCallback((id: string) => {
    setPicked(id);
    try {
      window.localStorage.setItem(CURRENT_KEY, id);
    } catch {
      // Remembering it is a convenience.
    }
  }, []);
  return { accounts: mine.data ?? [], usable, current, pick, isLoading: mine.isLoading, error: mine.error };
}

export function useSaveProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<MastodonAccountRow> & { id?: string }) => {
      const { id, ...values } = input;
      const db = mastodonDb().from("mastodon_accounts");
      const { data, error } = id ? await db.update(values).eq("id", id).select("*").single() : await db.insert(values as Partial<MastodonAccountRow> & { username: string }).select("*").single();
      errorFrom(error);
      await pokeDeliveries();
      return data as MastodonAccountRow;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export function useDeleteProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await mastodonDb().from("mastodon_accounts").delete().eq("id", id);
      errorFrom(error);
      await pokeDeliveries();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type TimelineKind = "home" | "local" | "federated" | "tag" | "list" | "account" | "favourites" | "bookmarks" | "direct";

/** A timeline, newest first, a page at a time (older pages by the last one's date). */
export function useTimeline(kind: TimelineKind, viewer: string | null | undefined, arg?: string | null, options: { withReplies?: boolean; enabled?: boolean } = {}) {
  const needsViewer = kind === "home" || kind === "favourites" || kind === "bookmarks" || kind === "direct";
  return useInfiniteQuery({
    queryKey: [...mastodonKey, "timeline", kind, viewer ?? "", arg ?? "", options.withReplies ?? false],
    enabled: (options.enabled ?? true) && (!needsViewer || !!viewer),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await mastodonDb().rpc("mastodon_timeline", {
        p_kind: kind,
        p_viewer: viewer ?? null,
        p_arg: arg ?? null,
        p_before: pageParam,
        p_limit: PAGE,
        p_with_replies: options.withReplies ?? false,
      });
      errorFrom(error);
      return (data ?? []) as unknown as MStatus[];
    },
    getNextPageParam: (last) => (last.length < PAGE ? undefined : last[last.length - 1].created_at),
  });
}

export function useNotifications(viewer: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: [...mastodonKey, "notifications", viewer ?? ""],
    enabled: !!viewer,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await mastodonDb().rpc("mastodon_notification_list", { p_viewer: viewer!, p_before: pageParam, p_limit: 30 });
      errorFrom(error);
      return (data ?? []) as unknown as MNotification[];
    },
    getNextPageParam: (last) => (last.length < 30 ? undefined : last[last.length - 1].created_at),
  });
}

export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await mastodonDb().from("mastodon_notifications").update({ read_at: new Date().toISOString() }).eq("account_id", accountId).is("read_at", null);
      errorFrom(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...mastodonKey, "notifications"] }),
  });
}

/** A status's id from a URL key (slug, identifier or uuid). */
async function statusIdFor(key: string): Promise<string | null> {
  if (isUuid(key)) return key;
  const { data, error } = await mastodonDb().from("mastodon_statuses").select("id").or(`slug.eq.${key},identifier.eq.${key}`).limit(1).maybeSingle();
  errorFrom(error);
  return (data as { id: string } | null)?.id ?? null;
}

export function useThread(key: string | undefined, viewer: string | null | undefined) {
  return useQuery({
    queryKey: [...mastodonKey, "thread", key ?? "", viewer ?? ""],
    enabled: !!key,
    queryFn: async () => {
      const id = await statusIdFor(key!);
      if (!id) return null;
      const { data, error } = await mastodonDb().rpc("mastodon_thread", { p_status: id, p_viewer: viewer ?? null });
      errorFrom(error);
      const thread = data as unknown as MThread | null;
      return thread?.status ? thread : null;
    },
  });
}

/** An account by URL key (slug, identifier, uuid or `user@domain`), with how `viewer` stands to it. */
export function useAccount(key: string | undefined, viewer: string | null | undefined) {
  return useQuery({
    queryKey: [...mastodonKey, "account", key ?? "", viewer ?? ""],
    enabled: !!key,
    queryFn: async () => {
      const { data: id, error } = await mastodonDb().rpc("mastodon_find_account", { p_key: decodeURIComponent(key!) });
      errorFrom(error);
      if (!id) return null;
      const { data, error: cardError } = await mastodonDb().rpc("mastodon_account_card", { p_id: id as string, p_viewer: viewer ?? null });
      errorFrom(cardError);
      return (data ?? null) as unknown as MAccount | null;
    },
  });
}

export function useSearch(query: string, viewer: string | null | undefined) {
  const q = query.trim();
  return useQuery({
    queryKey: [...mastodonKey, "search", q, viewer ?? ""],
    enabled: q.length > 0,
    queryFn: async () => {
      const { data, error } = await mastodonDb().rpc("mastodon_search", { p_query: q, p_viewer: viewer ?? null, p_limit: 20 });
      errorFrom(error);
      return (data ?? { accounts: [], statuses: [], hashtags: [] }) as unknown as MSearchResults;
    },
  });
}

/**
 * Looks `user@domain` or a link up on its own server, keeping what it finds here. Answers the ids
 * of the accounts and statuses found.
 */
export function useResolveRemote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { q: string; account?: string | null }) => {
      const { data, error } = await mastodonDb().functions.invoke("mastodon/client/resolve", { body: input });
      if (error) throw new Error(await functionError(error));
      return (data ?? { accounts: [], statuses: [] }) as { accounts: string[]; statuses: string[] };
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...mastodonKey, "search"] }),
  });
}

/** Fetches a remote account and its latest posts again. */
export function useRefreshRemote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await mastodonDb().functions.invoke("mastodon/client/refresh", { body: { account_id: accountId } });
      if (error) throw new Error(await functionError(error));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

async function functionError(error: { message?: string; context?: unknown }): Promise<string> {
  const response = error.context as Response | undefined;
  if (response && typeof response.json === "function") {
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // Not JSON.
    }
  }
  return error.message ?? "Something went wrong";
}

// ── Writing: posting and acting on statuses and accounts ─────────────────────────────────────

export type PostInput = {
  account: string;
  text: string;
  spoilerText?: string;
  sensitive?: boolean;
  visibility?: string;
  language?: string | null;
  inReplyTo?: string | null;
  media?: { url: string; preview_url?: string | null; description?: string | null; type?: string; media_id?: string | null }[];
  poll?: { options: string[]; multiple: boolean; expires_in: number } | null;
};

export function usePostStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: PostInput) => {
      const { data, error } = await mastodonDb().rpc("mastodon_post_status", {
        p_account: input.account,
        p_text: input.text,
        p_spoiler_text: input.spoilerText ?? null,
        p_sensitive: input.sensitive ?? false,
        p_visibility: input.visibility ?? "public",
        p_language: input.language ?? null,
        p_in_reply_to: input.inReplyTo ?? null,
        p_media: (input.media ?? []) as unknown as Json,
        p_poll: (input.poll ?? null) as unknown as Json,
      });
      errorFrom(error);
      await pokeDeliveries();
      return data as { id: string; slug: string; identifier: string };
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export function useEditStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; text: string; spoilerText: string; sensitive: boolean }) => {
      const { error } = await mastodonDb()
        .from("mastodon_statuses")
        .update({ text: input.text, spoiler_text: input.spoilerText, sensitive: input.sensitive })
        .eq("id", input.id);
      errorFrom(error);
      await pokeDeliveries();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export type StatusAction = "favourite" | "unfavourite" | "reblog" | "unreblog" | "bookmark" | "unbookmark" | "delete";

/** Favourites, boosts, bookmarks and deletes, as `account`. */
export function useStatusAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, status, account }: { action: StatusAction; status: MStatus; account: string }) => {
      const db = mastodonDb();
      const target = status.reblog ?? status;
      let result: { error: { message?: string } | null } = { error: null };
      switch (action) {
        case "favourite":
          result = await db.from("mastodon_favourites").insert({ account_id: account, status_id: target.id });
          break;
        case "unfavourite":
          result = await db.from("mastodon_favourites").delete().eq("account_id", account).eq("status_id", target.id);
          break;
        case "reblog":
          result = await db.rpc("mastodon_post_status", { p_account: account, p_reblog_of: target.id, p_visibility: "public" });
          break;
        case "unreblog":
          result = await db
            .from("mastodon_statuses")
            .update({ soft_deleted_at: new Date().toISOString() })
            .eq("account_id", account)
            .eq("reblog_of_id", target.id)
            .is("soft_deleted_at", null);
          break;
        case "bookmark":
          result = await db.from("mastodon_bookmarks").insert({ account_id: account, status_id: target.id });
          break;
        case "unbookmark":
          result = await db.from("mastodon_bookmarks").delete().eq("account_id", account).eq("status_id", target.id);
          break;
        case "delete":
          result = await db.from("mastodon_statuses").update({ soft_deleted_at: new Date().toISOString() }).eq("id", status.id);
          break;
      }
      errorFrom(result.error);
      if (action !== "bookmark" && action !== "unbookmark") await pokeDeliveries();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export function useVote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ poll, account, choices }: { poll: string; account: string; choices: number[] }) => {
      const { error } = await mastodonDb()
        .from("mastodon_poll_votes")
        .insert(choices.map((choice) => ({ poll_id: poll, account_id: account, choice })));
      errorFrom(error);
      await pokeDeliveries();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export type AccountAction = "follow" | "unfollow" | "block" | "unblock" | "mute" | "unmute";

export function useAccountAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, target, account }: { action: AccountAction; target: string; account: string }) => {
      const db = mastodonDb();
      const pair = { account_id: account, target_account_id: target };
      const result =
        action === "follow"
          ? await db.from("mastodon_follows").insert(pair)
          : action === "unfollow"
            ? await db.from("mastodon_follows").delete().eq("account_id", account).eq("target_account_id", target)
            : action === "block"
              ? await db.from("mastodon_blocks").insert(pair)
              : action === "unblock"
                ? await db.from("mastodon_blocks").delete().eq("account_id", account).eq("target_account_id", target)
                : action === "mute"
                  ? await db.from("mastodon_mutes").insert(pair)
                  : await db.from("mastodon_mutes").delete().eq("account_id", account).eq("target_account_id", target);
      errorFrom(result.error);
      if (action !== "mute" && action !== "unmute") await pokeDeliveries();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

/** Accepting or turning down a follow request to a locked profile of the user's. */
export function useFollowRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ follower, account, accept }: { follower: string; account: string; accept: boolean }) => {
      const db = mastodonDb().from("mastodon_follows");
      const { error } = accept
        ? await db.update({ state: "accepted" }).eq("account_id", follower).eq("target_account_id", account)
        : await db.delete().eq("account_id", follower).eq("target_account_id", account);
      errorFrom(error);
      await pokeDeliveries();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export function useFollowRequests(account: string | null | undefined) {
  return useQuery({
    queryKey: [...mastodonKey, "follow-requests", account ?? ""],
    enabled: !!account,
    queryFn: async () => {
      const { data, error } = await mastodonDb().from("mastodon_follows").select("account_id").eq("target_account_id", account!).eq("state", "pending");
      errorFrom(error);
      const ids = ((data ?? []) as { account_id: string }[]).map((row) => row.account_id);
      if (!ids.length) return [] as MastodonAccountRow[];
      const { data: accounts, error: accountsError } = await mastodonDb().from("mastodon_accounts").select("*").in("id", ids);
      errorFrom(accountsError);
      return (accounts ?? []) as MastodonAccountRow[];
    },
  });
}

// ── Lists ───────────────────────────────────────────────────────────────────────────────────

export function useLists(account: string | null | undefined) {
  return useQuery({
    queryKey: [...mastodonKey, "lists", account ?? ""],
    enabled: !!account,
    queryFn: async () => {
      const db = mastodonDb();
      const [lists, members] = await Promise.all([
        db.from("mastodon_lists").select("*").eq("account_id", account!).order("title"),
        db.from("mastodon_list_accounts").select("*"),
      ]);
      errorFrom(lists.error);
      errorFrom(members.error);
      const byList = new Map<string, string[]>();
      for (const row of (members.data ?? []) as MastodonListAccount[]) byList.set(row.list_id, [...(byList.get(row.list_id) ?? []), row.account_id]);
      return ((lists.data ?? []) as MastodonList[]).map((list) => ({ ...list, members: byList.get(list.id) ?? [] }));
    },
  });
}

export type MastodonListWithMembers = MastodonList & { members: string[] };

export function useSaveList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; account_id: string; title: string; replies_policy: string; exclusive: boolean; members: string[] }) => {
      const db = mastodonDb();
      const values = { account_id: input.account_id, title: input.title, replies_policy: input.replies_policy as MastodonList["replies_policy"], exclusive: input.exclusive };
      const { data, error } = input.id
        ? await db.from("mastodon_lists").update(values).eq("id", input.id).select("*").single()
        : await db.from("mastodon_lists").insert(values).select("*").single();
      errorFrom(error);
      const list = data as MastodonList;
      const { data: current, error: membersError } = await db.from("mastodon_list_accounts").select("account_id").eq("list_id", list.id);
      errorFrom(membersError);
      const have = new Set(((current ?? []) as { account_id: string }[]).map((row) => row.account_id));
      const want = new Set(input.members);
      const add = [...want].filter((id) => !have.has(id));
      const drop = [...have].filter((id) => !want.has(id));
      if (add.length) errorFrom((await db.from("mastodon_list_accounts").insert(add.map((account_id) => ({ list_id: list.id, account_id })))).error);
      if (drop.length) errorFrom((await db.from("mastodon_list_accounts").delete().eq("list_id", list.id).in("account_id", drop)).error);
      return list;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export function useDeleteList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => errorFrom((await mastodonDb().from("mastodon_lists").delete().eq("id", id)).error),
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

/** The accounts a profile follows (list members are picked from them, like Mastodon). */
export function useFollowing(account: string | null | undefined) {
  return useQuery({
    queryKey: [...mastodonKey, "following", account ?? ""],
    enabled: !!account,
    queryFn: async () => {
      const { data, error } = await mastodonDb().from("mastodon_follows").select("target_account_id").eq("account_id", account!).eq("state", "accepted");
      errorFrom(error);
      const ids = ((data ?? []) as { target_account_id: string }[]).map((row) => row.target_account_id);
      if (!ids.length) return [] as MastodonAccountRow[];
      const { data: accounts, error: accountsError } = await mastodonDb().from("mastodon_accounts").select("*").in("id", ids);
      errorFrom(accountsError);
      return (accounts ?? []) as MastodonAccountRow[];
    },
  });
}

// ── Running an instance: its people and blocked servers ──────────────────────────────────────

export function useAdminAccounts(instance: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [...mastodonKey, "admin", instance ?? ""],
    enabled: !!instance && enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await mastodonDb().rpc("mastodon_admin_accounts", { p_instance: instance! });
      errorFrom(error);
      return (data ?? []) as AdminAccount[];
    },
  });
}

export function useAdminSetAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { account: string; status?: string | null; role?: string | null; adminNote?: string | null }) => {
      const { error } = await mastodonDb().rpc("mastodon_admin_set_account", {
        p_account: input.account,
        p_status: input.status ?? null,
        p_role: input.role ?? null,
        p_admin_note: input.adminNote ?? null,
      });
      errorFrom(error);
      await pokeDeliveries();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export function useAdminCreateAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { instance: string; email: string; username: string; displayName?: string; role: string }) => {
      const { data, error } = await mastodonDb().rpc("mastodon_admin_create_account", {
        p_instance: input.instance,
        p_email: input.email,
        p_username: input.username,
        p_display_name: input.displayName ?? null,
        p_role: input.role,
      });
      errorFrom(error);
      return data as unknown as MAccount;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export function useDomainBlocks(instance: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [...mastodonKey, "domain-blocks", instance ?? ""],
    enabled: !!instance && enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await mastodonDb().from("mastodon_domain_blocks").select("*").eq("instance_id", instance!).order("domain");
      errorFrom(error);
      return (data ?? []) as DomainBlock[];
    },
  });
}

export function useSaveDomainBlock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<DomainBlock> & { instance_id: string; domain: string }) => {
      const { id, ...values } = input;
      const db = mastodonDb().from("mastodon_domain_blocks");
      const { data, error } = id ? await db.update(values).eq("id", id).select("*").single() : await db.insert(values).select("*").single();
      errorFrom(error);
      return data as DomainBlock;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

export function useDeleteDomainBlock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => errorFrom((await mastodonDb().from("mastodon_domain_blocks").delete().eq("id", id)).error),
    onSuccess: () => client.invalidateQueries({ queryKey: mastodonKey }),
  });
}

/** Keeps a value for a short while after it last changed, e.g. a search box. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
