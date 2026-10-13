import { useCallback } from "react";
import { useSite, type SiteConfig } from "./sites";

/**
 * Roles and aspects: two dimensions that tag what an app declares (its features, palette actions
 * and entity menu items), so a site can offer only the part of the app it is for.
 *
 * - A **role** is who the thing is for: `admin` (sites, apps, access), `analytics` (reports, audit,
 *   charts), `creator` (makes and edits content), `curator` (collects, tags, publishes others'
 *   work), `operator` (runs the day to day: schedules, automations, quarantines) and `consumer`
 *   (browses, plays, saves to the library).
 * - An **aspect** is what kind of work it does: `view`, `create`, `edit`, `organize` (library,
 *   playlists, tags, order), `share` (copy links, make public), `analyze`, `configure` and
 *   `delete`.
 *
 * A site sets the roles and aspects it serves (`sites.roles` / `sites.aspects`, NULL = all). A
 * tagged thing is offered when, in each dimension, it shares a value with the site, or either side
 * leaves that dimension open: untagged things are always offered, and so is everything on a site
 * with no roles or aspects set.
 *
 * Tag a feature in the app's manifest.json (`"roles": [...]`, `"aspects": [...]` on the feature, or
 * on the manifest itself for all of its features) or on its AppFeature, an AppAction on the action,
 * and an ActionMenu item on the MenuAction. Menu items keyed `edit`, `delete`, `open`, … get their
 * aspect from DEFAULT_ACTION_ASPECTS when they don't set one.
 */

export const SITE_ROLES = ["admin", "analytics", "creator", "curator", "operator", "consumer"] as const;
export type SiteRole = (typeof SITE_ROLES)[number];

export const SITE_ASPECTS = ["view", "create", "edit", "organize", "share", "analyze", "configure", "delete"] as const;
export type SiteAspect = (typeof SITE_ASPECTS)[number];

/** The roles and aspects something is tagged with. A missing or empty list leaves that dimension open. */
export interface Capability {
  roles?: readonly SiteRole[];
  aspects?: readonly SiteAspect[];
}

export function isSiteRole(value: unknown): value is SiteRole {
  return typeof value === "string" && (SITE_ROLES as readonly string[]).includes(value);
}

export function isSiteAspect(value: unknown): value is SiteAspect {
  return typeof value === "string" && (SITE_ASPECTS as readonly string[]).includes(value);
}

/** The aspect of an ActionMenu item that doesn't name one, by its key (apps add theirs: registerActionAspects). */
export const DEFAULT_ACTION_ASPECTS: Record<string, readonly SiteAspect[]> = {
  edit: ["edit"],
  delete: ["delete"],
  remove: ["delete"],
  open: ["view"],
  show: ["view"],
  preview: ["view"],
  play: ["view"],
  watch: ["view"],
  up: ["organize"],
  down: ["organize"],
  left: ["organize"],
  right: ["organize"],
  "add-sub": ["create"],
  "add-child": ["create"],
};

/** Adds an app's menu keys to DEFAULT_ACTION_ASPECTS (its manifest's `menuAspects`). */
export function registerActionAspects(aspects: Record<string, readonly SiteAspect[]>): void {
  Object.assign(DEFAULT_ACTION_ASPECTS, aspects);
}

/** A menu item's capability: its own tags, else the default aspect for its key. */
export function actionCapability(action: Capability & { key?: string }): Capability {
  if (action.roles?.length || action.aspects?.length) return action;
  const aspects = action.key ? DEFAULT_ACTION_ASPECTS[action.key] : undefined;
  return aspects ? { aspects } : {};
}

const overlaps = (served: readonly string[] | null | undefined, tagged: readonly string[] | undefined) =>
  !served || !tagged?.length || tagged.some((value) => served.includes(value));

/** Whether a site offers something tagged with `capability` (see the top of this file). */
export function siteOffers(site: Pick<SiteConfig, "roles" | "aspects"> | null | undefined, capability: Capability | undefined): boolean {
  if (!site || !capability) return true;
  return overlaps(site.roles, capability.roles) && overlaps(site.aspects, capability.aspects);
}

/** The current site's check, for filtering features, actions and menu items. */
export function useSiteOffers(): (capability: Capability | undefined) => boolean {
  const { site } = useSite();
  return useCallback((capability: Capability | undefined) => siteOffers(site, capability), [site]);
}

/** Merges capabilities from the most to the least specific: each dimension comes from the first that sets it. */
export function mergeCapability(...capabilities: (Capability | undefined)[]): Capability {
  const roles = capabilities.find((c) => c?.roles?.length)?.roles;
  const aspects = capabilities.find((c) => c?.aspects?.length)?.aspects;
  return { ...(roles ? { roles } : {}), ...(aspects ? { aspects } : {}) };
}
