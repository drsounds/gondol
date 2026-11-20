import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../../supabase/useSession";
import { useSettingsScopeIds } from "../../../settings/settings";
import { aiDb } from "./conversations";

/**
 * AI credits (docs/guide/ai.md "Credits"): how much AI an account may use, set by a site's owner or
 * a workspace's owners and admins as tiers (`ai_credit_tiers`: credits per hour, day, week, month,
 * year or once, narrowed to apps, providers, models, roles or accounts, per account or shared), with
 * what a token costs (`ai_credit_rates`, default 1 credit per 1,000 tokens in or out). The AI edge
 * functions check `ai_credits()` before they ask a model and charge the answer's tokens afterwards
 * (`ai_credit_usage`). No tier: unlimited.
 */

export type AiCreditScopeKind = "site" | "workspace";
export type AiCreditInterval = "hour" | "day" | "week" | "month" | "year" | "once";
export const AI_CREDIT_INTERVALS: AiCreditInterval[] = ["hour", "day", "week", "month", "year", "once"];
/** Roles a tier can be narrowed to: workspace roles, and for a site `owner`, `member` or `visitor`. */
export const AI_CREDIT_ROLES = ["owner", "admin", "member", "guest", "visitor"] as const;

/** One tier as it applies to the caller now (from `ai_credits()`). */
export interface AiCreditTierState {
  id: string;
  name: string;
  description: string | null;
  scope: AiCreditScopeKind;
  scopeId: string;
  scopeName: string;
  credits: number;
  interval: AiCreditInterval;
  shared: boolean;
  priority: number;
  apps: string[];
  providers: string[];
  models: string[];
  periodStart: string;
  /** When the period ends and the tier's credits come back; null for `once`. */
  periodEnd: string | null;
  used: number;
  remaining: number;
}

/** The caller's credits (`ai_credits()`). */
export interface AiCreditState {
  /** Whether any tier applies; when not, AI is unlimited. */
  limited: boolean;
  /** Whether every limiting scope has credits left. */
  allowed: boolean;
  /** What's left and the whole of the tightest scope (site or workspace). */
  remaining: number | null;
  total: number | null;
  nextRefillAt: string | null;
  siteId: string | null;
  workspaceId: string | null;
  tiers: AiCreditTierState[];
}

export type AiCreditTier = {
  id: string;
  user_id: string;
  scope: AiCreditScopeKind;
  scope_id: string;
  name: string;
  description: string | null;
  credits: number;
  interval: AiCreditInterval;
  starts_at: string;
  ends_at: string | null;
  shared: boolean;
  apps: string[];
  providers: string[];
  models: string[];
  roles: string[];
  accounts: string[];
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
export type AiCreditTierWrite = Partial<Omit<AiCreditTier, "id" | "user_id" | "created_at" | "updated_at">>;

export type AiCreditRate = {
  id: string;
  user_id: string;
  scope: AiCreditScopeKind;
  scope_id: string;
  app_id: string | null;
  provider: string | null;
  model: string | null;
  input_per_1k: number;
  output_per_1k: number;
  created_at: string;
  updated_at: string;
};
export type AiCreditRateWrite = Partial<Omit<AiCreditRate, "id" | "user_id" | "created_at" | "updated_at">>;

export type AiCreditUsage = {
  id: string;
  user_id: string;
  tier_id: string | null;
  scope: AiCreditScopeKind | null;
  scope_id: string | null;
  app_id: string;
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  credits: number;
  created_at: string;
};

/** A site or workspace whose credits the caller manages (`ai_credit_scopes()`). */
export type AiCreditScope = {
  scope: AiCreditScopeKind;
  scope_id: string;
  name: string;
};

// --- What every AI request names ---------------------------------------------------------------

let workspaceId: string | null = null;

/** The open workspace, for requests made outside React (AiCreditScopeSync keeps it current). */
export function setAiCreditWorkspace(id: string | null): void {
  workspaceId = id;
}

/** Fields the AI functions read to pick the credits a chat request uses: the app asking and the workspace. */
export function aiCreditFields(app?: string): { app?: string; workspaceId?: string } {
  return { ...(app ? { app } : {}), ...(workspaceId ? { workspaceId } : {}) };
}

/** Keeps the workspace AI requests name in step with the open one. Mounted by the ai app. */
export function AiCreditScopeSync({ children }: { children: ReactNode }) {
  const { workspace } = useSettingsScopeIds();
  useEffect(() => setAiCreditWorkspace(workspace), [workspace]);
  return children;
}

// --- Telling the pie an answer has been charged -------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();

/** Called by the providers when an answer is done, so the balance is read again. */
export function notifyAiCreditsChanged(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function useCreditsVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
}

// --- Reading -------------------------------------------------------------------------------------

export const aiCreditsKey = ["gondol", "ai", "credits"] as const;

const isMissing = (error: { code?: string } | null) => error?.code === "PGRST202" || error?.code === "42883";

const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0) || 0);

function parseState(raw: unknown): AiCreditState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const tiers = Array.isArray(value.tiers) ? (value.tiers as Record<string, unknown>[]) : [];
  return {
    limited: value.limited === true,
    allowed: value.allowed !== false,
    remaining: value.remaining == null ? null : num(value.remaining),
    total: value.total == null ? null : num(value.total),
    nextRefillAt: typeof value.nextRefillAt === "string" ? value.nextRefillAt : null,
    siteId: typeof value.siteId === "string" ? value.siteId : null,
    workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : null,
    tiers: tiers.map((tier) => ({
      ...(tier as unknown as AiCreditTierState),
      credits: num(tier.credits),
      used: num(tier.used),
      remaining: num(tier.remaining),
      priority: num(tier.priority),
      apps: (tier.apps as string[] | null) ?? [],
      providers: (tier.providers as string[] | null) ?? [],
      models: (tier.models as string[] | null) ?? [],
    })),
  };
}

/**
 * The signed-in account's credits here (this site, the open workspace); null while signed out or
 * when the database has no credits. Read again after every answer and every minute.
 */
export function useAiCredits() {
  const { session } = useSession();
  const ids = useSettingsScopeIds();
  const changed = useCreditsVersion();
  const query = useQuery({
    queryKey: [...aiCreditsKey, "state", session?.user.id ?? null, ids.site, ids.workspace],
    enabled: !!session,
    refetchInterval: 60_000,
    staleTime: 10_000,
    queryFn: async (): Promise<AiCreditState | null> => {
      const { data, error } = await aiDb().rpc("ai_credits", {
        p_site_id: ids.site,
        p_site_domain: typeof window === "undefined" ? null : window.location.host,
        p_workspace_id: ids.workspace,
      });
      if (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      return parseState(data);
    },
  });
  const { refetch } = query;
  useEffect(() => {
    if (changed) void refetch();
  }, [changed, refetch]);
  return query;
}

/** The caller's latest charges. */
export function useAiCreditUsage(limit = 50) {
  const { session } = useSession();
  const changed = useCreditsVersion();
  return useQuery({
    queryKey: [...aiCreditsKey, "usage", session?.user.id ?? null, limit, changed],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await aiDb()
        .from("ai_credit_usage")
        .select("*")
        .eq("user_id", session!.user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return [];
        throw error;
      }
      return (data ?? []) as AiCreditUsage[];
    },
  });
}

/** The sites and workspaces whose credits the caller manages. */
export function useAiCreditScopes() {
  const { session } = useSession();
  return useQuery({
    queryKey: [...aiCreditsKey, "scopes", session?.user.id ?? null],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await aiDb().rpc("ai_credit_scopes");
      if (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      return (data ?? []) as AiCreditScope[];
    },
  });
}

/** Every tier of the scopes the caller manages (RLS lets only those through). */
export function useAiCreditTiers() {
  return useQuery({
    queryKey: [...aiCreditsKey, "tiers"],
    queryFn: async () => {
      const { data, error } = await aiDb().from("ai_credit_tiers").select("*").order("scope").order("priority", { ascending: false }).order("name");
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return [];
        throw error;
      }
      return ((data ?? []) as AiCreditTier[]).map((tier) => ({ ...tier, credits: num(tier.credits) }));
    },
  });
}

/** Every rate of the scopes the caller manages. */
export function useAiCreditRates() {
  return useQuery({
    queryKey: [...aiCreditsKey, "rates"],
    queryFn: async () => {
      const { data, error } = await aiDb().from("ai_credit_rates").select("*").order("scope").order("app_id").order("provider").order("model");
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return [];
        throw error;
      }
      return ((data ?? []) as AiCreditRate[]).map((rate) => ({ ...rate, input_per_1k: num(rate.input_per_1k), output_per_1k: num(rate.output_per_1k) }));
    },
  });
}

/** Charges by everyone in the scopes the caller manages, newest first. */
export function useAiCreditScopeUsage(limit = 200) {
  return useQuery({
    queryKey: [...aiCreditsKey, "scope-usage", limit],
    queryFn: async () => {
      const { data, error } = await aiDb().from("ai_credit_usage").select("*").not("scope", "is", null).order("created_at", { ascending: false }).limit(limit);
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return [];
        throw error;
      }
      return ((data ?? []) as AiCreditUsage[]).map((row) => ({ ...row, credits: num(row.credits) }));
    },
  });
}

// --- Writing -------------------------------------------------------------------------------------

function useInvalidateCredits() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: aiCreditsKey });
}

export function useSaveAiCreditTier() {
  const invalidate = useInvalidateCredits();
  return useMutation({
    mutationFn: async ({ id, ...values }: AiCreditTierWrite & { id?: string }): Promise<AiCreditTier> => {
      const query = id
        ? aiDb().from("ai_credit_tiers").update(values).eq("id", id)
        : aiDb()
            .from("ai_credit_tiers")
            .insert({ ...values, scope: values.scope ?? "site", scope_id: values.scope_id ?? "", name: values.name ?? "", credits: values.credits ?? 0 });
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return data as AiCreditTier;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteAiCreditTier() {
  const invalidate = useInvalidateCredits();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await aiDb().from("ai_credit_tiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useSaveAiCreditRate() {
  const invalidate = useInvalidateCredits();
  return useMutation({
    mutationFn: async ({ id, ...values }: AiCreditRateWrite & { id?: string }): Promise<AiCreditRate> => {
      const query = id
        ? aiDb().from("ai_credit_rates").update(values).eq("id", id)
        : aiDb()
            .from("ai_credit_rates")
            .insert({ ...values, scope: values.scope ?? "site", scope_id: values.scope_id ?? "" });
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return data as AiCreditRate;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteAiCreditRate() {
  const invalidate = useInvalidateCredits();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await aiDb().from("ai_credit_rates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// --- Showing -------------------------------------------------------------------------------------

/** Credits as shown: whole numbers when large, two decimals when small. */
export function formatCredits(value: number | null | undefined, locale?: string): string {
  const n = value ?? 0;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 }).format(n);
}

/** The share left, 0–1, of what's left out of the whole. */
export function creditShare(remaining: number | null | undefined, total: number | null | undefined): number {
  if (!total || total <= 0) return 1;
  return Math.min(1, Math.max(0, (remaining ?? 0) / total));
}
