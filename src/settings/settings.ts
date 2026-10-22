import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase/client";
import { useSession } from "../supabase/useSession";
import { useSite } from "../sites/sites";
import { getInternalApp } from "../apps/registry";
import type { InternalAppBundle } from "../apps/types";
import type { Json } from "../supabase/types";
import { appSettingsSchema, SETTING_SCOPES, type AppSetting, type AppSettings, type AppSettingValue, type SettingScope } from "./schema";
import { flattenSettings, type ResolvedSetting } from "./tree";

/**
 * App settings: the values of what apps declare in their manifest's `settings` (./schema.ts),
 * stored in the `app_settings` table, one row per app and scope (`user` + the account's id, `site`
 * + the site's id, `workspace` + the workspace's id) whose `data` holds the values by setting key.
 *
 * Read a value with `useAppSetting(appId, key)` (or all of an app's with `useAppSettings`): the
 * user's own value where the setting is stored per user, else the open workspace's, else the
 * site's served here, else the setting's `default`. Edit them with `<AppSettingsPanel scope=… />`
 * (./AppSettingsPanel.tsx), or `useSaveAppSetting` for a control of your own.
 */

/** Most specific first: the order values are looked up in. */
const LOOKUP_ORDER: readonly SettingScope[] = ["user", "workspace", "site"];

let useWorkspaceIdHook: () => string | null = () => null;

/**
 * Tells gondol which workspace is open (gondol has no workspaces of its own): a hook returning its
 * id, or null for none. Without it, workspace-scoped settings fall back to the site's and defaults.
 * configureGondol({ settings: { useWorkspaceId } }) calls it.
 */
export function configureSettingsScopes(options: { useWorkspaceId?: () => string | null }): void {
  if (options.useWorkspaceId) useWorkspaceIdHook = options.useWorkspaceId;
}

/** The ids each scope means here: the signed-in account, the open workspace, the site served. */
export function useSettingsScopeIds(): Record<SettingScope, string | null> {
  const { session } = useSession();
  const { site } = useSite();
  const workspaceId = useWorkspaceIdHook();
  const userId = session?.user.id ?? null;
  const siteId = site?.id ?? null;
  return useMemo(() => ({ user: userId, workspace: workspaceId, site: siteId }), [userId, workspaceId, siteId]);
}

const parsed = new WeakMap<object, AppSettings | null>();

/** An app's settings as its manifest declares them; undefined when it has none (or they're invalid). */
export function appSettingsOf(app: InternalAppBundle | undefined): AppSettings | undefined {
  const declared = (app?.manifest as { settings?: unknown } | undefined)?.settings;
  if (!app || !declared || typeof declared !== "object") return undefined;
  if (!parsed.has(declared)) {
    // defineApp has validated it already; a bundle built by hand gets checked here.
    const result = appSettingsSchema.safeParse(declared);
    if (!result.success) console.error(`app "${app.id}": invalid settings in its manifest`, result.error.issues);
    parsed.set(declared, result.success ? result.data : null);
  }
  return parsed.get(declared) ?? undefined;
}

/** Every setting an app declares, with its scopes. */
export function appSettingDefinitions(appId: string): ResolvedSetting[] {
  return flattenSettings(appSettingsOf(getInternalApp(appId)));
}

/** A stored value as the setting's type, or undefined when it isn't one (left over, edited by hand). */
export function coerceSettingValue(setting: AppSetting, raw: unknown): AppSettingValue | undefined {
  if (raw === undefined || raw === null) return undefined;
  switch (setting.type) {
    case "checkbox":
      return typeof raw === "boolean" ? raw : undefined;
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
      if (setting.min !== undefined && raw < setting.min) return undefined;
      if (setting.max !== undefined && raw > setting.max) return undefined;
      return setting.integer && !Number.isInteger(raw) ? undefined : raw;
    }
    case "select":
      return typeof raw === "string" && setting.options.some((o) => o.value === raw) ? raw : undefined;
    case "checkboxes":
      return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && setting.options.some((o) => o.value === v)) : undefined;
    case "text":
    case "string":
      return typeof raw === "string" ? raw : undefined;
  }
}

/** Why a value can't be saved, as a message key of gondol's catalogue; null when it can. */
export function settingValueProblem(setting: AppSetting, value: AppSettingValue | undefined): string | null {
  if (value === undefined) return null;
  if (setting.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "settings.invalidNumber";
    if (setting.integer && !Number.isInteger(value)) return "settings.invalidInteger";
    if ((setting.min !== undefined && value < setting.min) || (setting.max !== undefined && value > setting.max)) return "settings.outOfRange";
  }
  if (setting.type === "string" && typeof value === "string" && value) {
    if (setting.pattern && !new RegExp(`^(?:${setting.pattern})$`).test(value)) return "settings.invalidPattern";
    if (setting.format === "url" && !/^https?:\/\/[^\s/]+/i.test(value)) return "settings.invalidUrl";
    if (setting.format === "email" && !/^[^\s@]+@[^\s@]+$/.test(value)) return "settings.invalidEmail";
  }
  if ((setting.type === "string" || setting.type === "text") && setting.maxLength && typeof value === "string" && value.length > setting.maxLength) {
    return "settings.tooLong";
  }
  return null;
}

/** Values stored at one scope, by app id, then key. */
export type ScopeValues = Record<string, Record<string, unknown>>;

export function appSettingsQueryKey(scope: SettingScope, scopeId: string | null) {
  return ["gondol", "app-settings", scope, scopeId] as const;
}

/** Every app's values stored at a scope (e.g. `site` + a site's id). */
export function useScopeSettings(scope: SettingScope, scopeId: string | null | undefined) {
  return useQuery({
    queryKey: appSettingsQueryKey(scope, scopeId ?? null),
    enabled: !!scopeId,
    staleTime: 60_000,
    queryFn: async (): Promise<ScopeValues> => {
      const { data, error } = await supabase.from("app_settings").select("app_id, data").eq("scope", scope).eq("scope_id", scopeId!);
      if (error) throw error;
      const out: ScopeValues = {};
      for (const row of data ?? []) {
        if (row.data && typeof row.data === "object" && !Array.isArray(row.data)) out[row.app_id] = row.data as Record<string, unknown>;
      }
      return out;
    },
  });
}

/** Where a value in effect comes from: a scope, or the setting's default. */
export type SettingSource = SettingScope | "default";

export interface AppSettingsState {
  /** Every declared setting's value in effect (undefined: not set and no default). */
  values: Record<string, AppSettingValue | undefined>;
  /** Where each value in `values` comes from. */
  sources: Record<string, SettingSource>;
  get: <T extends AppSettingValue = AppSettingValue>(key: string) => T | undefined;
  isLoading: boolean;
}

/**
 * The value in effect of every setting an app declares: the most specific scope the setting is
 * stored at that has a value (user, workspace, site), else its default.
 */
export function useAppSettings(appId: string): AppSettingsState {
  const ids = useSettingsScopeIds();
  const user = useScopeSettings("user", ids.user);
  const workspace = useScopeSettings("workspace", ids.workspace);
  const site = useScopeSettings("site", ids.site);
  const definitions = useMemo(() => appSettingDefinitions(appId), [appId]);
  const stored: Record<SettingScope, ScopeValues | undefined> = { user: user.data, workspace: workspace.data, site: site.data };
  const { values, sources } = useMemo(
    () => resolveAppSettings(appId, definitions, stored),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appId, definitions, user.data, workspace.data, site.data],
  );
  const get = useCallback(<T extends AppSettingValue = AppSettingValue>(key: string) => values[key] as T | undefined, [values]);
  return { values, sources, get, isLoading: user.isLoading || workspace.isLoading || site.isLoading };
}

/** The values in effect from what each scope stores (`skip`: scopes to leave out, e.g. the one being edited). */
export function resolveAppSettings(
  appId: string,
  definitions: ResolvedSetting[],
  stored: Partial<Record<SettingScope, ScopeValues | undefined>>,
  skip: readonly SettingScope[] = [],
): { values: Record<string, AppSettingValue | undefined>; sources: Record<string, SettingSource> } {
  const values: Record<string, AppSettingValue | undefined> = {};
  const sources: Record<string, SettingSource> = {};
  for (const { setting, scopes } of definitions) {
    let found = false;
    for (const scope of LOOKUP_ORDER) {
      if (!scopes.includes(scope) || skip.includes(scope)) continue;
      const value = coerceSettingValue(setting, stored[scope]?.[appId]?.[setting.key]);
      if (value === undefined) continue;
      values[setting.key] = value;
      sources[setting.key] = scope;
      found = true;
      break;
    }
    if (!found) {
      values[setting.key] = setting.default;
      sources[setting.key] = "default";
    }
  }
  return { values, sources };
}

/** One setting's value in effect (see useAppSettings). */
export function useAppSetting<T extends AppSettingValue = AppSettingValue>(appId: string, key: string): T | undefined {
  return useAppSettings(appId).get<T>(key);
}

/** Sets (or, with `value: undefined`, clears) a setting's value at a scope. */
export function useSaveAppSetting(scope: SettingScope, scopeId: string | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = appSettingsQueryKey(scope, scopeId ?? null);
  return useMutation({
    mutationFn: async ({ appId, key, value }: { appId: string; key: string; value: AppSettingValue | undefined }) => {
      if (!scopeId) throw new Error(`No ${scope} to save the setting for`);
      // Merge into the row as stored now, so two sheets open at once don't undo each other's keys.
      const { data: row, error: readError } = await supabase
        .from("app_settings")
        .select("data")
        .eq("app_id", appId)
        .eq("scope", scope)
        .eq("scope_id", scopeId)
        .maybeSingle();
      if (readError) throw readError;
      const current = row?.data && typeof row.data === "object" && !Array.isArray(row.data) ? { ...(row.data as Record<string, Json | undefined>) } : {};
      if (value === undefined) delete current[key];
      else current[key] = value;
      const { session } = (await supabase.auth.getSession()).data;
      const { error } = await supabase
        .from("app_settings")
        .upsert({ app_id: appId, scope, scope_id: scopeId, data: current as Json, updated_by: session?.user.id ?? null }, { onConflict: "app_id,scope,scope_id" });
      if (error) throw error;
      return { appId, values: current as Record<string, unknown> };
    },
    onMutate: async ({ appId, key, value }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ScopeValues>(queryKey);
      const next: ScopeValues = { ...(previous ?? {}), [appId]: { ...(previous?.[appId] ?? {}) } };
      if (value === undefined) delete next[appId][key];
      else next[appId][key] = value;
      queryClient.setQueryData(queryKey, next);
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
    },
    onSuccess: ({ appId, values }) => {
      queryClient.setQueryData<ScopeValues>(queryKey, (previous) => ({ ...(previous ?? {}), [appId]: values }));
    },
  });
}

export { SETTING_SCOPES };
export type { SettingScope, AppSetting, AppSettings, AppSettingValue, ResolvedSetting };
