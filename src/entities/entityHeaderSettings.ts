import { isSitePreferenceLocked, sitePreferenceValue } from "../sites/preferences";
import type { SiteLayout } from "../sites/sites";

/**
 * How an entity page's header (EntityHeader) is laid out. "standard": the art beside the texts.
 * "vertical": on phones the art is large and centred (80 % of the view's width), with the name and
 * the description under it, aligned to the start; on wider screens it is the standard layout.
 */
export type HeaderLayout = "standard" | "vertical";
export const HEADER_LAYOUTS: HeaderLayout[] = ["standard", "vertical"];

/**
 * Where a thing's related subjects (creators, a label, …) go. "auto": a byline under the name on
 * wide screens, and on phones entries at the bottom of the page under a title per entity type.
 * "byline": always under the name. "sections": always at the bottom.
 */
export type HeaderSubjects = "auto" | "byline" | "sections";
export const HEADER_SUBJECTS: HeaderSubjects[] = ["auto", "byline", "sections"];

/** The header settings for one entity type (or, with `hideArt`, one entity). Unset parts follow the level above. */
export interface EntityHeaderTypeSettings {
  layout?: HeaderLayout;
  subjects?: HeaderSubjects;
}

/** Header settings per entity type, keyed by the type (ShellSettings.entityHeaders, SiteLayout.entityHeaders). */
export type EntityHeaderTypes = Record<string, EntityHeaderTypeSettings>;

/** What an entity's editor set for its own page (stored by the host, e.g. with its covers). */
export interface EntityHeaderOverride extends EntityHeaderTypeSettings {
  /** No art in the header while it has a header image. */
  hideArt?: boolean;
}

/** The header settings in effect for one entity's page. */
export interface ResolvedEntityHeader {
  layout: HeaderLayout;
  subjects: HeaderSubjects;
  /** The entity's editor hid the art (it only goes while there is a header image). */
  hideArt: boolean;
}

const isLayout = (value: unknown): value is HeaderLayout => HEADER_LAYOUTS.includes(value as HeaderLayout);
const isSubjects = (value: unknown): value is HeaderSubjects => HEADER_SUBJECTS.includes(value as HeaderSubjects);

/** Only the well-formed entries of stored per-type settings (anything else is dropped). */
export function sanitizeEntityHeaderTypes(value: unknown): EntityHeaderTypes {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: EntityHeaderTypes = {};
  for (const [type, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const { layout, subjects } = raw as Record<string, unknown>;
    const entry: EntityHeaderTypeSettings = {};
    if (isLayout(layout)) entry.layout = layout;
    if (isSubjects(subjects)) entry.subjects = subjects;
    if (entry.layout || entry.subjects) out[type] = entry;
  }
  return out;
}

/** An entity's own header settings from stored JSON (null when it sets none). */
export function sanitizeEntityHeaderOverride(value: unknown): EntityHeaderOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { layout, subjects, hideArt } = value as Record<string, unknown>;
  const out: EntityHeaderOverride = {};
  if (isLayout(layout)) out.layout = layout;
  if (isSubjects(subjects)) out.subjects = subjects;
  if (hideArt === true) out.hideArt = true;
  return Object.keys(out).length ? out : null;
}

/** The visitor's own header preferences (UserTheme.shell). */
export interface OwnHeaderPreferences {
  headerLayout?: HeaderLayout;
  headerSubjects?: HeaderSubjects;
  entityHeaders?: EntityHeaderTypes;
}

/**
 * The header settings for an entity of `type`, the most specific level first: what the site locks
 * (its value for the type, else its value for every type), the entity's own, the visitor's for the
 * type, the site's for the type, the visitor's for every type, the site's for every type, the default.
 */
export function resolveEntityHeader({
  type,
  own,
  site,
  entity,
}: {
  type: string | null;
  own: OwnHeaderPreferences | null | undefined;
  site: SiteLayout | null | undefined;
  entity?: EntityHeaderOverride | null;
}): ResolvedEntityHeader {
  const siteTypes = sanitizeEntityHeaderTypes(sitePreferenceValue(site, "entityHeaders"));
  const ownTypes = sanitizeEntityHeaderTypes(own?.entityHeaders);
  const typesLocked = isSitePreferenceLocked(site, "entityHeaders");
  const pick = <K extends "layout" | "subjects">(
    key: K,
    global: "headerLayout" | "headerSubjects",
    fallback: NonNullable<EntityHeaderTypeSettings[K]>,
  ): NonNullable<EntityHeaderTypeSettings[K]> => {
    const siteType = type ? siteTypes[type]?.[key] : undefined;
    const siteGlobal = sitePreferenceValue(site, global) as EntityHeaderTypeSettings[K] | undefined;
    if (typesLocked && siteType) return siteType;
    if (isSitePreferenceLocked(site, global)) return (siteType ?? siteGlobal ?? fallback) as NonNullable<EntityHeaderTypeSettings[K]>;
    const ownGlobal = own?.[global] as EntityHeaderTypeSettings[K] | undefined;
    return (entity?.[key] ?? (type ? ownTypes[type]?.[key] : undefined) ?? siteType ?? ownGlobal ?? siteGlobal ?? fallback) as NonNullable<
      EntityHeaderTypeSettings[K]
    >;
  };
  return {
    layout: pick("layout", "headerLayout", "standard"),
    subjects: pick("subjects", "headerSubjects", "auto"),
    hideArt: !!entity?.hideArt,
  };
}
