import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../../supabase/useSession";
import { publicOrigin } from "../../../shell/desktopApp";
import { getAppName } from "../../../sites/siteHead";
import { mastodonDb, mastodonKey } from "./mastodon";
import type { RemoteSession } from "./types";

/**
 * The client side of the app: signing in to other Mastodon servers and using them from here. The
 * browser talks to the other server directly (Mastodon answers its client API and /oauth/token with
 * CORS), with its own OAuth app registered there; the session (its client credentials and token)
 * is kept in `mastodon_remote_sessions`, which only its owner reads.
 */

const SCOPES = "read write follow";
export const REMOTE_CALLBACK_PATH = "/mastodon/remote/callback";

/** A server's host as typed (a URL, `user@host` or the host), lower-cased, or null when it isn't one. */
export function normalizeHost(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (!host) return null;
  if (host.includes("@")) host = host.slice(host.lastIndexOf("@") + 1);
  host = host.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?$/.test(host) ? host : null;
}

async function remoteFetch<T>(session: Pick<RemoteSession, "host" | "access_token">, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (session.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  headers.set("Accept", "application/json");
  const response = await fetch(`https://${session.host}${path}`, { ...init, headers });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message = (body as { error?: string } | null)?.error;
    throw new Error(message || `${session.host} answered ${response.status}`);
  }
  return body as T;
}

const form = (values: Record<string, string>) => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return body;
};

export function useRemoteSessions() {
  const { session } = useSession();
  return useQuery({
    queryKey: [...mastodonKey, "remote", session?.user.id ?? ""],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await mastodonDb().from("mastodon_remote_sessions").select("*").order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as RemoteSession[];
    },
  });
}

/**
 * Registers this app on the server, keeps a pending session and sends the browser to the server's
 * sign-in page; it comes back to REMOTE_CALLBACK_PATH.
 */
export function useStartRemoteSignIn() {
  return useMutation({
    mutationFn: async (input: { host: string }) => {
      const host = normalizeHost(input.host);
      if (!host) throw new Error("bad-host");
      const redirect = `${publicOrigin()}${REMOTE_CALLBACK_PATH}`;
      const app = await remoteFetch<{ client_id: string; client_secret: string }>({ host, access_token: null }, "/api/v1/apps", {
        method: "POST",
        body: form({ client_name: getAppName() || "Gondol", redirect_uris: redirect, scopes: SCOPES, website: publicOrigin() }),
      });
      const { data, error } = await mastodonDb()
        .from("mastodon_remote_sessions")
        .insert({ host, redirect_uri: redirect, client_id: app.client_id, client_secret: app.client_secret, scopes: SCOPES, state: "pending" })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      const session = data as RemoteSession;
      const authorize = new URL(`https://${host}/oauth/authorize`);
      authorize.searchParams.set("client_id", session.client_id);
      authorize.searchParams.set("redirect_uri", redirect);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", SCOPES);
      authorize.searchParams.set("state", session.id);
      window.location.assign(authorize.toString());
      return session;
    },
  });
}

/** Finishes a sign-in: swaps the code for a token and remembers who signed in. */
export function useFinishRemoteSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, state }: { code: string; state: string }) => {
      const { data, error } = await mastodonDb().from("mastodon_remote_sessions").select("*").eq("id", state).maybeSingle();
      if (error) throw new Error(error.message);
      const session = data as RemoteSession | null;
      if (!session) throw new Error("unknown-state");
      if (session.state === "active") return session;
      const token = await remoteFetch<{ access_token: string }>({ host: session.host, access_token: null }, "/oauth/token", {
        method: "POST",
        body: form({
          grant_type: "authorization_code",
          code,
          client_id: session.client_id,
          client_secret: session.client_secret,
          redirect_uri: session.redirect_uri,
          scope: session.scopes,
        }),
      });
      const account = await remoteFetch<{ acct: string } & Record<string, unknown>>({ host: session.host, access_token: token.access_token }, "/api/v1/accounts/verify_credentials");
      const { data: saved, error: saveError } = await mastodonDb()
        .from("mastodon_remote_sessions")
        .update({ access_token: token.access_token, account: account as never, acct: `${account.acct}@${session.host}`, state: "active" })
        .eq("id", session.id)
        .select("*")
        .single();
      if (saveError) throw new Error(saveError.message);
      return saved as RemoteSession;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...mastodonKey, "remote"] }),
  });
}

export function useRemoveRemoteSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (session: RemoteSession) => {
      if (session.access_token) {
        // Best effort: the server forgets the token too.
        await remoteFetch(session, "/oauth/revoke", {
          method: "POST",
          body: form({ client_id: session.client_id, client_secret: session.client_secret, token: session.access_token }),
        }).catch(() => undefined);
      }
      const { error } = await mastodonDb().from("mastodon_remote_sessions").delete().eq("id", session.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...mastodonKey, "remote"] }),
  });
}

/** A status as another server's API sends it (only what the client shows). */
export type RemoteStatus = {
  id: string;
  created_at: string;
  url: string | null;
  uri: string;
  content: string;
  spoiler_text: string;
  sensitive: boolean;
  visibility: string;
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
  favourited?: boolean;
  reblogged?: boolean;
  bookmarked?: boolean;
  account: { id: string; acct: string; display_name: string; avatar: string; url: string };
  reblog: RemoteStatus | null;
  media_attachments: { id: string; type: string; url: string; preview_url: string | null; description: string | null }[];
};

export const REMOTE_TIMELINES = ["home", "local", "federated", "notifications"] as const;
export type RemoteTimeline = (typeof REMOTE_TIMELINES)[number];

export function useRemoteTimeline(session: RemoteSession | undefined, timeline: RemoteTimeline) {
  return useInfiniteQuery({
    queryKey: [...mastodonKey, "remote-timeline", session?.id ?? "", timeline],
    enabled: !!session?.access_token,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const base =
        timeline === "home"
          ? "/api/v1/timelines/home"
          : timeline === "notifications"
            ? "/api/v1/notifications"
            : `/api/v1/timelines/public?local=${timeline === "local"}`;
      const sep = base.includes("?") ? "&" : "?";
      const path = `${base}${sep}limit=20${pageParam ? `&max_id=${encodeURIComponent(pageParam)}` : ""}`;
      if (timeline === "notifications") {
        const items = await remoteFetch<{ id: string; type: string; created_at: string; account: RemoteStatus["account"]; status: RemoteStatus | null }[]>(session!, path);
        return items.map((item) => ({ kind: "notification" as const, id: item.id, item }));
      }
      const statuses = await remoteFetch<RemoteStatus[]>(session!, path);
      return statuses.map((status) => ({ kind: "status" as const, id: status.id, status }));
    },
    getNextPageParam: (last) => (last.length < 20 ? undefined : last[last.length - 1].id),
  });
}

export type RemoteAction = "favourite" | "unfavourite" | "reblog" | "unreblog" | "bookmark" | "unbookmark";

export function useRemoteStatusAction(session: RemoteSession | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ status, action }: { status: RemoteStatus; action: RemoteAction }) =>
      remoteFetch(session!, `/api/v1/statuses/${encodeURIComponent((status.reblog ?? status).id)}/${action}`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...mastodonKey, "remote-timeline", session?.id ?? ""] }),
  });
}

export function useRemotePost(session: RemoteSession | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { status: string; spoiler_text?: string; visibility: string }) =>
      remoteFetch(session!, "/api/v1/statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...mastodonKey, "remote-timeline", session?.id ?? ""] }),
  });
}
