import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "../../../supabase/client";
import type { AccountsDatabase, AccountConnection } from "./types";

const db = () => getSupabaseClient<AccountsDatabase>();
export const accountConnectionsKey = ["accounts", "connections"] as const;

export function useAccountConnections() {
  return useQuery({
    queryKey: accountConnectionsKey,
    queryFn: async () => {
      const { data, error } = await db()
        .from("account_connections")
        .select("id, provider, external_user_id, login, display_name, created_at, updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AccountConnection[];
    },
  });
}

export function useConnectGithub() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await db().functions.invoke<{ url: string }>("accounts", { body: { action: "connect-github" } });
      if (error) throw error;
      if (!data?.url) throw new Error("The accounts service returned no sign-in URL");
      return data.url;
    },
  });
}

export function useDisconnectAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await db().functions.invoke("accounts", { body: { action: "disconnect", account_id: accountId } });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountConnectionsKey }),
  });
}
