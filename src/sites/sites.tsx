import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase/client";
import { useSession } from "../supabase/useSession";
import { entityExtensions } from "../entities/extensions";
import { namespaced } from "../shell/storage";
import { entityEditPath, entityViewPath, parseEntityUri, toEntityUri, type EntityType } from "../entities/uri";
import { featureCapability, getInternalApp, getInternalApps } from "../apps/registry";
import type { AppFeature, InternalAppBundle } from "../apps/types";
import type { SavedIconStyle } from "../theme/savedIcon";
import type { DesktopLayout, LayoutStyle, MenuStyle, PlayerVisibility, SheetStyle, ThemeEngine, UserTheme } from "../theme/userTheme";
import { isSitePreferenceLocked, sitePreferenceValue, type SitePreference } from "./preferences";
import { setSiteDeveloperMode } from "../shell/developerMode";
import type { Theme } from "../theme/theme";
import { isSiteAspect, isSiteRole, siteOffers, type SiteAspect, type SiteRole } from "./capabilities";

const appDependencies = (id: string) => getInternalApp(id)?.dependencies ?? [];

/**
 * Sites: one Spacify per domain (the `sites` table, managed in the Sites app, src/apps/sites). The
 * site served on the current host decides which internal apps are on, who may use it, the page's
 * base layout, a theme that replaces the visitor's own, and which entities show up (entity types
 * plus conditions), and which roles and aspects of the apps it offers (./capabilities.ts). `SiteProvider` resolves it through `site_for_domain()`, which also works
 * before sign-in, so the sign-in page already wears the site's theme.
 *
 * `?site=<domain>` previews a site on any host (remembered for the tab; `?site=` with no value
 * goes back to the host's own site).
 */

/**
 * The page's base layout and the visitor preferences the site sets (./preferences.ts): each one a
 * default for visitors who haven't picked their own, or, when listed in `locked`, what everyone
 * gets on this site.
 */
export interface SiteLayout {
  desktopLayout?: DesktopLayout;
  /** Goes with the site's desktopLayout (the classic layout's frame). */
  classicFrame?: boolean;
  layoutStyle?: LayoutStyle;
  /** The "saved to library" glyph (savedIcon.tsx). */
  savedIcon?: SavedIconStyle;
  /** The interface language (a locale of the app's catalogue). */
  locale?: string;
  /** Whether the bottom player shows (PlayerVisibility). */
  player?: PlayerVisibility;
  /** Whether "Your Library" shows under the desktop menu. */
  sidebarLibrary?: boolean;
  /** Features in the menu, or apps leading to their features (MenuStyle). */
  menuStyle?: MenuStyle;
  darkTabBar?: boolean;
  darkFrame?: boolean;
  /** The phone tab bar floats over the content on a fading background (ShellSettings.fadingTabBar). */
  fadingTabBar?: boolean;
  hideSoftDeletedEntities?: boolean;
  hideFutureEntities?: boolean;
  /** The browser's native menu and text selection (shell/developerMode.ts). */
  developerMode?: boolean;
  /** Every shade is the foreground or the background colour (data-high-contrast). */
  highContrast?: boolean;
  /** Edit sheets as a modal or as a page over everything (SheetStyle). */
  sheetStyle?: SheetStyle;
  /** Lines between the rows of data tables. */
  tableLines?: boolean;
  /** The preferences visitors can't change here. Unset: see isSitePreferenceLocked(). */
  locked?: SitePreference[];
  /** Where "/" goes: an app's path such as "/wiki", or "/" for the usual home view. */
  homePath?: string;
}

/** The parts of a site's theme a site can leave to its visitors (SiteTheme.locked). */
export const SITE_THEME_PARTS = ["engine", "mode", "accentColor"] as const;
export type SiteThemePart = (typeof SITE_THEME_PARTS)[number];

/**
 * A site accent: a colour (#rrggbb), "foreground" (the text colour, so accented things read as
 * plain ink on the background) or "theme" (the theme's own accent, set on purpose).
 */
export type SiteAccent = string | "foreground" | "theme";

/**
 * A site's theme: the engine and the advanced/aero/TUI settings it uses, its colour scheme (light,
 * dark or the device's) and accent colour. Each part is optional. A part the site sets is a default
 * for visitors who haven't picked their own, or, when it is in `locked`, what everyone gets there
 * (like SiteLayout's preferences; see isSiteThemeLocked()).
 */
export interface SiteTheme {
  engine?: ThemeEngine;
  theme?: UserTheme;
  /** Light/dark colour scheme; unset leaves the visitor's own. */
  mode?: Theme;
  /** Accent for the simple and advanced engines; unset leaves the visitor's own. */
  accentColor?: SiteAccent;
  /** The parts visitors can't change here. Unset: see isSiteThemeLocked(). */
  locked?: SiteThemePart[];
  /**
   * Before `locked`: whether visitors could switch to their own theme here. A theme saved without
   * `locked` locks everything it sets unless this is on.
   */
  allowPersonal?: boolean;
}

/** The value a site theme sets for a part, or undefined when it leaves it to the visitor. */
export function siteThemePartValue(theme: SiteTheme | null | undefined, part: SiteThemePart): string | undefined {
  if (!theme) return undefined;
  if (part === "engine") return theme.engine;
  if (part === "mode") return theme.mode;
  // A theme saved before `locked` that brings its own engine also brought that engine's accent.
  if (theme.accentColor) return theme.accentColor;
  return !Array.isArray(theme.locked) && theme.engine && !theme.allowPersonal ? "theme" : undefined;
}

/** Whether the site's value for a part is all visitors get (a value it sets and locks). */
export function isSiteThemeLocked(theme: SiteTheme | null | undefined, part: SiteThemePart): boolean {
  if (siteThemePartValue(theme, part) === undefined) return false;
  if (!Array.isArray(theme?.locked)) return !theme?.allowPersonal;
  return theme.locked.includes(part);
}

const SITE_THEME_MODES: readonly Theme[] = ["system", "light", "dark"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A stored site theme, dropping anything malformed; null when it sets nothing. */
export function toSiteTheme(value: unknown): SiteTheme | null {
  const raw = asObject<Record<string, unknown> | null>(value, null);
  if (!raw) return null;
  const theme: SiteTheme = {};
  if (typeof raw.engine === "string" && ["simple", "advanced", "aero", "tui"].includes(raw.engine)) {
    theme.engine = raw.engine as ThemeEngine;
    theme.theme = asObject<UserTheme>(raw.theme, {});
  }
  if (SITE_THEME_MODES.includes(raw.mode as Theme)) theme.mode = raw.mode as Theme;
  if (typeof raw.accentColor === "string" && HEX_COLOR.test(raw.accentColor)) theme.accentColor = raw.accentColor.toLowerCase();
  else if (raw.accentColor === "foreground" || raw.accentColor === "theme") theme.accentColor = raw.accentColor;
  if (Array.isArray(raw.locked)) theme.locked = SITE_THEME_PARTS.filter((part) => (raw.locked as unknown[]).includes(part));
  if (raw.allowPersonal === true) theme.allowPersonal = true;
  return theme.engine || theme.mode || theme.accentColor ? theme : null;
}

export const SITE_CONDITION_FIELDS = ["title", "tag", "ownership", "updated"] as const;
export type SiteConditionField = (typeof SITE_CONDITION_FIELDS)[number];

/** The operators each condition field offers, the first being the default. */
export const SITE_CONDITION_OPS: Record<SiteConditionField, readonly string[]> = {
  title: ["contains", "not_contains", "starts_with", "equals"],
  // The value is a tag's name, so it matches each signed-in user's own tag of that name.
  tag: ["has", "has_not"],
  ownership: ["is", "is_not"],
  updated: ["within_days", "older_than_days"],
};
export const SITE_OWNERSHIPS = ["own", "shared", "public"] as const;

export interface SiteCondition {
  field: SiteConditionField;
  op: string;
  value: string;
}

export type SiteConditionMatch = "all" | "any";

/** The site served on the current host, as `site_for_domain()` returns it. */
export interface SiteConfig {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  enabled_apps: string[] | null;
  layout: SiteLayout;
  theme: SiteTheme | null;
  entity_types: string[] | null;
  conditions: SiteCondition[];
  condition_match: SiteConditionMatch;
  /** The roles and aspects of the apps the site offers (./capabilities.ts); null offers all. */
  roles: SiteRole[] | null;
  aspects: SiteAspect[] | null;
  restricted: boolean;
  /** Visitors without an account may browse the owner's public entities (rendered on the server for SEO). */
  allow_anonymous: boolean;
  /**
   * The domain of the owner's master site (`sites.is_master`), which OAuth sign-ins and other
   * third-party authentication on every one of the owner's sites go through (see oauthReturnUrl),
   * or null when the owner has none.
   */
  master_domain: string | null;
  is_owner: boolean;
  /** Whether the caller may use the site: always for an open one, else its owner and linked accounts. */
  is_member: boolean;
}

const sitePreviewKey = () => namespaced("site-preview");
const siteCacheKey = (key: string) => namespaced(`site:${key}`);

/** Domains are compared lower-case without a scheme, port, path or leading "www." (as normalize_site_domain() in SQL). */
export function normalizeSiteDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[:/?#].*$/, "")
    .replace(/^www\./, "");
}

export const SITE_DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** The domain whose site this tab shows: a `?site=` preview, else the host itself. */
export function resolveSiteDomain(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const param = new URLSearchParams(window.location.search).get("site");
    if (param !== null) {
      const preview = normalizeSiteDomain(param);
      if (preview) window.sessionStorage.setItem(sitePreviewKey(), preview);
      else window.sessionStorage.removeItem(sitePreviewKey());
    }
    const stored = window.sessionStorage.getItem(sitePreviewKey());
    if (stored) return stored;
  } catch {
    /* storage unavailable: fall back to the host */
  }
  return normalizeSiteDomain(window.location.hostname);
}

function readCachedSite(key: string): SiteConfig | null | undefined {
  try {
    const raw = window.localStorage.getItem(siteCacheKey(key));
    return raw == null ? undefined : (JSON.parse(raw) as SiteConfig | null);
  } catch {
    return undefined;
  }
}

function writeCachedSite(key: string, site: SiteConfig | null) {
  try {
    window.localStorage.setItem(siteCacheKey(key), JSON.stringify(site));
  } catch {
    /* ignore */
  }
}

function asObject<T>(value: unknown, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : fallback;
}

/** Turns a site_for_domain() row into a SiteConfig, dropping anything malformed. */
export function toSiteConfig(row: Record<string, unknown>): SiteConfig {
  const conditions = Array.isArray(row.conditions)
    ? (row.conditions as SiteCondition[]).filter(
        (c) => c && SITE_CONDITION_FIELDS.includes(c.field) && SITE_CONDITION_OPS[c.field].includes(c.op) && typeof c.value === "string",
      )
    : [];
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    domain: String(row.domain ?? ""),
    description: (row.description as string | null) ?? null,
    enabled_apps: (row.enabled_apps as string[] | null) ?? null,
    layout: asObject<SiteLayout>(row.layout, {}),
    theme: toSiteTheme(row.theme),
    entity_types: (row.entity_types as string[] | null) ?? null,
    conditions,
    condition_match: row.condition_match === "any" ? "any" : "all",
    roles: Array.isArray(row.roles) ? row.roles.filter(isSiteRole) : null,
    aspects: Array.isArray(row.aspects) ? row.aspects.filter(isSiteAspect) : null,
    restricted: row.restricted !== false,
    allow_anonymous: row.allow_anonymous === true,
    master_domain: typeof row.master_domain === "string" && row.master_domain ? row.master_domain : null,
    is_owner: row.is_owner === true,
    is_member: row.is_member === true,
  };
}

interface SiteValue {
  /** The host's (or previewed) domain, null during server rendering. */
  domain: string | null;
  /** The site served there, or null on a host without one. */
  site: SiteConfig | null;
  loading: boolean;
  /** True while the answer is being (re)checked, e.g. right after signing in. */
  checking: boolean;
  /** Ends a `?site=` preview. */
  endPreview: () => void;
  previewing: boolean;
}

/** The site SiteProvider resolved last, for code outside React (oauthReturnUrl's default). */
let currentSite: SiteConfig | null = null;

const SiteContext = createContext<SiteValue>({ domain: null, site: null, loading: false, checking: false, endPreview: () => {}, previewing: false });

export function SiteProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [domain, setDomain] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    const resolved = resolveSiteDomain();
    setDomain(resolved);
    try {
      setPreviewing(!!window.sessionStorage.getItem(sitePreviewKey()));
    } catch {
      setPreviewing(false);
    }
  }, []);

  // Cached per domain and account, since membership is part of the answer.
  const cacheKey = `${domain}:${userId ?? "anon"}`;
  const query = useQuery({
    queryKey: ["site-for-domain", domain, userId],
    enabled: !!domain,
    staleTime: 60_000,
    // The last answer for this domain, so a reload doesn't flash every app before the site loads.
    initialData: () => (domain ? readCachedSite(cacheKey) : undefined),
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<SiteConfig | null> => {
      const { data, error } = await supabase.rpc("site_for_domain", { p_domain: domain! });
      if (error) throw error;
      const row = (data ?? [])[0] as Record<string, unknown> | undefined;
      const site = row ? toSiteConfig(row) : null;
      writeCachedSite(cacheKey, site);
      return site;
    },
  });

  const endPreview = useCallback(() => {
    try {
      window.sessionStorage.removeItem(sitePreviewKey());
    } catch {
      /* ignore */
    }
    setPreviewing(false);
    setDomain(normalizeSiteDomain(window.location.hostname));
  }, []);

  // `data-site-create="off"` on <html> while the site doesn't offer creating, so the add button of
  // every list header (styles/base.css) goes with the plus button and the create picker.
  const site = query.data ?? null;
  currentSite = site;
  const createOff = !siteOffers(site, { aspects: ["create"] });
  useEffect(() => {
    if (createOff) document.documentElement.setAttribute("data-site-create", "off");
    else document.documentElement.removeAttribute("data-site-create");
  }, [createOff]);
  // The site's developer mode default or lock (browser only; the desktop app keeps its own).
  const siteDeveloperMode = sitePreferenceValue(site?.layout, "developerMode");
  const developerModeLocked = isSitePreferenceLocked(site?.layout, "developerMode");
  useEffect(() => {
    setSiteDeveloperMode(siteDeveloperMode, developerModeLocked);
  }, [siteDeveloperMode, developerModeLocked]);

  const value = useMemo<SiteValue>(
    () => ({
      domain,
      site: query.data ?? null,
      loading: !!domain && query.isLoading,
      checking: !!domain && query.isFetching,
      endPreview,
      previewing,
    }),
    [domain, query.data, query.isLoading, query.isFetching, endPreview, previewing],
  );
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/**
 * Where an OAuth provider (the sign-in, Google, …) should send the browser back to, for a flow that
 * ends at `target` (an absolute URL on this host). On a site whose owner has a master site on
 * another domain that is the master's relay, `https://<master>/auth/relay?to=<target>`, which checks
 * the target is one of the owner's sites and forwards the provider's answer (query and fragment)
 * there; so only the master's address has to be registered with the providers. Elsewhere, including
 * while previewing a site with `?site=`, it is `target` itself.
 */
export function oauthReturnUrl(target: string, site: SiteConfig | null = currentSite): string {
  const master = site?.master_domain;
  if (!master || typeof window === "undefined") return target;
  const host = normalizeSiteDomain(window.location.hostname);
  if (host === master || host !== site.domain) return target;
  return `${oauthRelayUrl(master)}?to=${encodeURIComponent(target)}`;
}

/** The master site's relay address, without a target (for providers that carry it in `state`). */
export function oauthRelayUrl(masterDomain: string): string {
  return `https://${masterDomain}/auth/relay`;
}

export function useSite(): SiteValue {
  return useContext(SiteContext);
}

/** Whether the site lets an internal app run (its own list plus what those apps depend on). */
export function siteAllowsApp(site: SiteConfig | null, appId: string, dependencies: (id: string) => string[] = () => []): boolean {
  if (!site?.enabled_apps) return true;
  // An app made at run time goes with the app it is part of (a user-built app with the studio).
  const partOf = getInternalApps().find((app) => app.id === appId)?.partOf;
  if (partOf && partOf !== appId) return siteAllowsApp(site, partOf, dependencies);
  const allowed = new Set<string>();
  const visit = (id: string) => {
    if (allowed.has(id)) return;
    allowed.add(id);
    dependencies(id).forEach(visit);
  };
  site.enabled_apps.forEach(visit);
  return allowed.has(appId);
}

/** Whether the site's entity types include `type` (only that setting; siteShowsType checks the rest). */
export function siteAllowsType(site: SiteConfig | null, type: string): boolean {
  return !site?.entity_types || site.entity_types.includes(type);
}

const featureRoots = (feature: AppFeature) =>
  [feature.path, ...(feature.aliases ?? [])].map((path) => `/${path.replace(/^\/+|\/+$/g, "")}`);

/**
 * The app and feature an entity type belongs to: the feature whose manifest entry lists the type in
 * `entityTypes`, else the one whose path (or alias) is the longest prefix of the type's edit sheet
 * (else its own page). Null for types no app feature holds (they follow only the site's entity types).
 */
export function entityTypeFeature(type: string): { app: InternalAppBundle; feature: AppFeature } | null {
  const apps = getInternalApps();
  for (const app of apps) {
    const declared = app.manifest.features.find((f) => f.entityTypes?.includes(type));
    const feature = declared && app.features.find((f) => f.id === declared.id);
    if (feature) return { app, feature };
  }
  const key = "\u0000";
  const path = entityEditPath(type as EntityType, key) ?? entityViewPath(type as EntityType, key);
  return featureForPath(path.split(key)[0]);
}

/** The app feature whose path (or alias) is the longest prefix of an in-app path, or null. */
export function featureForPath(path: string): { app: InternalAppBundle; feature: AppFeature } | null {
  const clean = path.replace(/\/+$/, "");
  let best: { app: InternalAppBundle; feature: AppFeature; length: number } | null = null;
  for (const app of getInternalApps()) {
    for (const feature of app.features) {
      for (const root of featureRoots(feature)) {
        if (root === "/" || (clean !== root && !clean.startsWith(`${root}/`))) continue;
        if (!best || root.length > best.length) best = { app, feature, length: root.length };
      }
    }
  }
  return best && { app: best.app, feature: best.feature };
}

// Per registered app list (registerApps replaces it), since every list row asks.
const typeFeatures = new WeakMap<InternalAppBundle[], Map<string, ReturnType<typeof entityTypeFeature>>>();
function cachedTypeFeature(type: string) {
  const apps = getInternalApps();
  let byType = typeFeatures.get(apps);
  if (!byType) typeFeatures.set(apps, (byType = new Map()));
  if (!byType.has(type)) byType.set(type, entityTypeFeature(type));
  return byType.get(type)!;
}

/**
 * Whether the site shows rows of an entity type anywhere: it's among the site's entity types, the
 * app it belongs to is enabled there (or a dependency of an enabled one), and the site offers that
 * app feature's roles and aspects (./capabilities.ts). Mixed lists (search, @ mentions, pickers,
 * the library, playlists, shelves) leave out the rest entirely.
 */
export function siteShowsType(site: SiteConfig | null, type: string): boolean {
  if (!site) return true;
  if (!siteAllowsType(site, type)) return false;
  const owner = cachedTypeFeature(type);
  if (!owner) return true;
  return siteAllowsApp(site, owner.app.id, appDependencies) && siteOffers(site, featureCapability(owner.app, owner.feature));
}

/** Whether the site shows the entity a spacify: URI points at; other URIs (web links) always show. */
export function siteShowsUri(site: SiteConfig | null, uri: string): boolean {
  const parsed = parseEntityUri(uri);
  return !parsed || siteShowsType(site, parsed.entityType);
}

/** The current site's siteShowsType / siteShowsUri. */
export function useSiteShows(): { type: (type: string) => boolean; uri: (uri: string) => boolean } {
  const { site } = useSite();
  return useMemo(() => ({ type: (type: string) => siteShowsType(site, type), uri: (uri: string) => siteShowsUri(site, uri) }), [site]);
}

/** What the conditions look at: a row as search_entities() returns it. */
export interface SiteFilterable {
  entity_type: string;
  entity_id: string;
  title: string | null;
  is_own: boolean;
  is_public: boolean;
  updated_at?: string | null;
}

const DAY_MS = 86_400_000;

/** Whether one condition holds for a row. `tagNames` are the lower-cased names of the row's tags. */
export function siteConditionHolds(condition: SiteCondition, row: SiteFilterable, tagNames: readonly string[], now = Date.now()): boolean {
  const value = condition.value.trim().toLowerCase();
  switch (condition.field) {
    case "title": {
      const title = (row.title ?? "").toLowerCase();
      if (condition.op === "not_contains") return !title.includes(value);
      if (condition.op === "starts_with") return title.startsWith(value);
      if (condition.op === "equals") return title === value;
      return title.includes(value);
    }
    case "tag": {
      const has = tagNames.includes(value);
      return condition.op === "has_not" ? !has : has;
    }
    case "ownership": {
      const kind = row.is_own ? "own" : row.is_public ? "public" : "shared";
      return condition.op === "is_not" ? kind !== value : kind === value;
    }
    case "updated": {
      const days = Number(value);
      if (!row.updated_at || !Number.isFinite(days)) return true;
      const age = now - new Date(row.updated_at).getTime();
      return condition.op === "older_than_days" ? age > days * DAY_MS : age <= days * DAY_MS;
    }
    default:
      return true;
  }
}

/** Whether a row passes a site's entity types and conditions. */
export function siteShowsEntity(site: SiteConfig | null, row: SiteFilterable, tagNames: readonly string[] = []): boolean {
  if (!site) return true;
  if (!siteShowsType(site, row.entity_type)) return false;
  const conditions = site.conditions.filter((c) => c.field === "updated" || c.field === "ownership" || c.value.trim());
  if (conditions.length === 0) return true;
  const holds = (c: SiteCondition) => siteConditionHolds(c, row, tagNames);
  return site.condition_match === "any" ? conditions.some(holds) : conditions.every(holds);
}

/**
 * The current site's filter for lists of entities (search, @ mentions, entity pickers). Tag
 * conditions read the user's own taggings, which are only fetched when the site has one.
 */
export function useSiteEntityFilter(): <T extends SiteFilterable>(rows: T[]) => T[] {
  const { site } = useSite();
  const needsTags = !!site?.conditions.some((c) => c.field === "tag");
  const tagNamesByUri = entityExtensions().useTagNamesByUri(needsTags);
  return useCallback(
    <T extends SiteFilterable>(rows: T[]) =>
      site
        ? rows.filter((row) => siteShowsEntity(site, row, tagNamesByUri.get(toEntityUri(row.entity_type as EntityType, row.entity_id)) ?? []))
        : rows,
    [site, tagNamesByUri],
  );
}
