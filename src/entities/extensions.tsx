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
   * a filled heart for liked entities. Null when there's nothing to like.
   */
  useLike(uri: string | undefined): { liked: boolean; setLiked: (liked: boolean) => void } | null;
}

const EMPTY_TAG_NAMES = new Map<string, string[]>();

let extensions: EntityExtensions = {
  useCoverImage: () => undefined,
  useTags: () => ({ data: [] }),
  useTagNamesByUri: () => EMPTY_TAG_NAMES,
  useLike: () => null,
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
