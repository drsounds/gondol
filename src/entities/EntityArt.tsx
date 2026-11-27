import type { CSSProperties } from "react";
import { Icon, type IconName } from "../design-system/bungalow-79d923";
import { entityExtensions } from "./extensions";
import type { EntityType } from "./uri";

/**
 * Glyph (from bungalow's fixed icon font) and tile hue of an entity type's generated cover art.
 * `shape: "round"` crops its art (cover image or generated tile) to a circle, like Spotify's
 * artists: for person-like types (creators, profiles, alter egos, agents, …). Default `square`.
 */
export type EntityArtStyle = { icon: IconName; hue: number; shape?: EntityArtShape };
export type EntityArtShape = "square" | "round";

let entityArt: Partial<Record<EntityType, EntityArtStyle>> = {};

/** Registers the app's entity types' tile glyphs and hues. */
export function registerEntityArt(art: Partial<Record<EntityType, EntityArtStyle>>): void {
  entityArt = { ...entityArt, ...art };
}

/** Whether an entity type's art is a circle or a square (see `EntityArtStyle.shape`). */
export function entityArtShape(type: string | null | undefined): EntityArtShape {
  return (type && entityArt[type as EntityType]?.shape) || "square";
}

/** True for entity types whose art is cropped to a circle; hosts use it for art they draw themselves. */
export function isRoundEntityType(type: string | null | undefined): boolean {
  return entityArtShape(type) === "round";
}


/**
 * Square "cover art" for an entity (search results, the sidebar library): its square cover image
 * when `uri` is given and the user has set one (see "Covers…"), else a gradient in the entity
 * type's hue with its glyph, or — at larger sizes — the title's initial with a small glyph badge,
 * standing in for Spotify's album/playlist covers.
 */
export function EntityArt({ type, title, size, uri }: { type: EntityType; title: string; size: "sm" | "md" | "lg"; uri?: string }) {
  const cover = entityExtensions().useCoverImage(uri);
  return <EntityArtTile type={type} title={title} size={size} cover={cover} />;
}

/** EntityArt with the cover image given (public site pages, which can't read the owner's covers). */
export function EntityArtTile({ type, title, size, cover }: { type: string; title: string; size: "sm" | "md" | "lg"; cover?: string | null }) {
  const style = entityArt[type as EntityType] ?? { icon: "document" as IconName, hue: 210 };
  const round = style.shape === "round" ? " search-art--round" : "";
  if (cover) {
    return (
      <span className={`search-art search-art--${size} search-art--cover${round}`} aria-hidden="true">
        <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </span>
    );
  }
  return (
    <span className={`search-art search-art--${size}${round}`} style={{ "--tile-hue": style.hue } as CSSProperties} aria-hidden="true">
      {size === "sm" ? <Icon name={style.icon} /> : <span className="search-art__initial">{title.charAt(0).toUpperCase()}</span>}
      {size === "sm" ? null : <Icon name={style.icon} className="search-art__badge" />}
    </span>
  );
}
