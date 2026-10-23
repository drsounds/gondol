import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "../../../supabase/client";
import type { OAuthClient, OAuthDatabase, OAuthSecret } from "./types";

/** The shared client, typed with the oauth app's tables and functions. */
export const oauthDb = () => getSupabaseClient<OAuthDatabase>();

/** Every column but `secret_hash`, which the browser can't read (and has no use for). */
export const OAUTH_CLIENT_COLUMNS =
  "id, user_id, app_uri, name, client_id, secret_hint, secret_created_at, redirect_uri, callback_url, scopes, last_used_at, created_at, updated_at";

export const oauthClientsKey = ["gondol", "oauth", "clients"] as const;
export const oauthGrantsKey = ["gondol", "oauth", "grants"] as const;

/** The user's credentials, newest first. */
export function useOAuthClients() {
  return useQuery({
    queryKey: oauthClientsKey,
    queryFn: async () => {
      const { data, error } = await oauthDb().from("oauth_clients").select(OAUTH_CLIENT_COLUMNS).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OAuthClient[];
    },
  });
}

export type OAuthClientValues = Pick<OAuthClient, "name" | "app_uri" | "redirect_uri" | "callback_url" | "scopes">;

/** Creates a credential; the answer holds its secret, which nothing can show again. */
export function useCreateOAuthClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: OAuthClientValues): Promise<OAuthSecret> => {
      const { data, error } = await oauthDb().rpc("oauth_create_client", {
        p_name: values.name,
        p_redirect_uri: values.redirect_uri,
        p_app_uri: values.app_uri,
        p_callback_url: values.callback_url,
        p_scopes: values.scopes,
      });
      if (error) throw error;
      return data as OAuthSecret;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: oauthClientsKey }),
  });
}

export function useUpdateOAuthClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: OAuthClientValues & { id: string }) => {
      const { error } = await oauthDb().from("oauth_clients").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: oauthClientsKey }),
  });
}

/** Deletes a credential, and with it every code and token issued through it. */
export function useDeleteOAuthClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await oauthDb().from("oauth_clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: oauthClientsKey }),
  });
}

/** A new secret for a credential; the old one stops working at once. Tokens already issued stay valid. */
export function useRegenerateOAuthSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<OAuthSecret> => {
      const { data, error } = await oauthDb().rpc("oauth_regenerate_secret", { p_id: id });
      if (error) throw error;
      return data as OAuthSecret;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: oauthClientsKey }),
  });
}

/** The apps the user has allowed and not disconnected. */
export function useOAuthGrants() {
  return useQuery({
    queryKey: oauthGrantsKey,
    queryFn: async () => {
      const { data, error } = await oauthDb().rpc("oauth_grant_list");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Disconnects an app: every token the user's allowed it is revoked. */
export function useRevokeOAuthGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await oauthDb().rpc("oauth_revoke_grant", { p_client_id: clientId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: oauthGrantsKey }),
  });
}

/** An authorization request, as the consent page reads it from its query string (RFC 6749 §4.1.1). */
export type AuthorizeRequest = {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  scopes: string[] | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
};

export function parseAuthorizeRequest(search: string): AuthorizeRequest {
  const params = new URLSearchParams(search);
  const scope = params.get("scope");
  return {
    responseType: params.get("response_type"),
    clientId: params.get("client_id"),
    redirectUri: params.get("redirect_uri"),
    scopes: scope == null ? null : scope.split(/[\s+]+/).filter(Boolean),
    state: params.get("state"),
    codeChallenge: params.get("code_challenge"),
    codeChallengeMethod: params.get("code_challenge_method"),
  };
}

/** `redirectUri` with the answer's parameters (code or error, and state) added to its query. */
export function redirectWith(redirectUri: string, values: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value != null) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Issues a code for the signed-in user; the consent page sends the user back with it. */
export async function authorizeOAuth(request: { clientId: string; redirectUri: string; scopes: string[]; codeChallenge: string | null; codeChallengeMethod: string | null }) {
  const { data, error } = await oauthDb().rpc("oauth_authorize", {
    p_client_id: request.clientId,
    p_redirect_uri: request.redirectUri,
    p_scopes: request.scopes,
    p_code_challenge: request.codeChallenge,
    p_code_challenge_method: request.codeChallengeMethod,
  });
  if (error) throw error;
  return data as string;
}

export function useOAuthConsentClient(clientId: string | null, redirectUri: string | null) {
  return useQuery({
    queryKey: ["gondol", "oauth", "consent", clientId, redirectUri],
    enabled: !!clientId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await oauthDb().rpc("oauth_client_for_consent", { p_client_id: clientId!, p_redirect_uri: redirectUri });
      if (error) throw error;
      return data;
    },
  });
}
