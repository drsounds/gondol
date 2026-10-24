import { createContext, useContext, type ReactNode } from "react";
import type { MenuAction } from "./ActionMenu";

/**
 * What an app's own apps add to gondol's entity system. gondol's entity UI (ActionMenu, EntityArt,
 * the global filter, a site's tag conditions) asks through these hooks, so the apps that provide
 * them (covers, tags, the library, playlists, …) stay in the app.
 *
 * Register them once, before rendering: they're called as React hooks, so they must stay the same
 * for the life of the page.
 */
export interface EntityExtensions {
  /** The square cover image of the entity behind `uri`, shown by EntityArt instead of its tile. */
  useCoverImage(uri: string | undefined): string | null | undefined;
  /** The user's tags, offered by tag conditions (the global filter, sites). */
  useTags(): { data?: { id: string; name: string }[] };
  /** The lower-cased tag names of every tagged entity, by URI; only fetched while `enabled`. */
  useTagNamesByUri(enabled: boolean): Map<string, string[]>;
  /**
   * Whether the user likes (has saved) the entity behind `uri`, and a way to change it; rows show
   * a filled heart for liked entities. Null when there's nothing to like. With `open` (and its
   * `openLabel`), pressing a liked row's glyph calls it instead of unliking, e.g. to open the app's
   * "Add to playlist" sheet where "Saved" can be unticked along with the playlists.
   */
  useLike(uri: string | undefined, name?: string): EntityLike | null;
  /**
   * Restrictions the app puts on entities (e.g. a quarantine), as a lookup by URI: restricted
   * entities are faded like soft-deleted ones (`dimmed`) and their "Share" is
   * disabled (`noSharing`). Called once per component, so it should read from a shared cache.
   */
  useRestrictions(): (uri: string | undefined) => EntityRestriction | null;
  /**
   * Where the share sheet (ShareSheet.tsx) can send an entity besides the clipboard: the app's
   * agents, channels, threads, … Only fetched while `enabled` (the sheet is open).
   */
  useShareTargets(enabled: boolean): ShareTargets;
}

/** One place an entity can be sent to from the share sheet (an agent, a channel, a thread, …). */
export interface ShareTarget {
  /** Stable and unique among the targets. */
  key: string;
  /** What kind of place it is, as a heading for its group ("Agents", "Channels", "Threads"). */
  group: string;
  name: string;
  /** A second, muted line (an agent's title, a thread's channel). */
  detail?: string;
  /** spacify: URI of the target itself, for its art. */
  uri?: string;
}

/** The entity being shared, in every form a target may want. */
export interface SharedEntity {
  /** The in-app URI (by uuid), as mentions and links store it. */
  uri: string;
  name: string;
  /** The URI to show people: spacify:<type>:<slug or identifier>. */
  shareUri: string;
  /** Its web address, null for types without a page. */
  url: string | null;
}

/** What `EntityExtensions.useShareTargets` returns. */
export interface ShareTargets {
  targets: ShareTarget[];
  isLoading?: boolean;
  /** Sends `entity` to `target`, with the user's optional `message`. */
  send(target: ShareTarget, entity: SharedEntity, message: string): Promise<void>;
}

/** Whether an entity is liked (see `EntityExtensions.useLike`). */
export interface EntityLike {
  liked: boolean;
  setLiked: (liked: boolean) => void;
  /** What pressing a liked row's glyph does instead of unliking. */
  open?: () => void;
  /** The glyph's accessible name when `open` is set. */
  openLabel?: string;
}

/** What the app restricts about one entity (see `EntityExtensions.useRestrictions`). */
export interface EntityRestriction {
  /** Fade the entity wherever it's listed (opacity 0.2, like a soft-deleted one). */
  dimmed: boolean;
  /** Disable the ways to share it ("Share", and the app's own sharing actions). */
  noSharing: boolean;
  /** Why, for a tooltip or a note (e.g. the quarantine's name). */
  reason?: string;
}

const NO_RESTRICTION = () => null;

const NO_SHARE_TARGETS: ShareTargets = { targets: [], send: async () => {} };

const EMPTY_TAG_NAMES = new Map<string, string[]>();

let extensions: EntityExtensions = {
  useCoverImage: () => undefined,
  useTags: () => ({ data: [] }),
  useTagNamesByUri: () => EMPTY_TAG_NAMES,
  useLike: () => null,
  useRestrictions: () => NO_RESTRICTION,
  useShareTargets: () => NO_SHARE_TARGETS,
};

export function registerEntityExtensions(next: Partial<EntityExtensions>): void {
  extensions = { ...extensions, ...next };
}

export function entityExtensions(): EntityExtensions {
  return extensions;
}

/** Extra items for an entity's "⋯" menu (Save to library, Tags…, Covers…), given its URI and name. */
export type EntityActionsFor = (uri: string, name: string) => MenuAction[];

const EntityActionsContext = createContext<EntityActionsFor | null>(null);

/**
 * Makes every ActionMenu with a `uri` (and every EntitySheet with one) offer the app's entity-wide
 * actions, so any list gets them just by passing `uri`.
 */
export function EntityActionsProvider({ actionsFor, children }: { actionsFor: EntityActionsFor; children: ReactNode }) {
  return <EntityActionsContext.Provider value={actionsFor}>{children}</EntityActionsContext.Provider>;
}

/** The app's entity-wide actions for `uri` (none without a URI or outside EntityActionsProvider). */
export function useCollectionActions(uri: string | undefined, name: string): MenuAction[] {
  const actionsFor = useContext(EntityActionsContext);
  return actionsFor && uri ? actionsFor(uri, name) : [];
}
