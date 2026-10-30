import type { LiHTMLAttributes, ReactNode } from "react";
import { ActionMenu, type MenuAction } from "./ActionMenu";
import { EntityArt } from "./EntityArt";
import { parseEntityUri } from "./uri";

interface Props extends Omit<LiHTMLAttributes<HTMLLIElement>, "children" | "title"> {
  name: string;
  /** The muted line under the name: the entity type and details. */
  meta?: ReactNode;
  /** The entity's entity URI: its art, and the row menu's library/playlist/tag actions. */
  uri?: string;
  /** Art for rows without a entity URI (web links); defaults to the entity's art. */
  art?: ReactNode;
  /** A running number in front of the row (playlist position, track number), shown as 01, 02, … */
  number?: number;
  openable?: boolean;
  onOpen?: () => void;
  /** Tooltip on the row's main button (a link's URL). */
  hint?: string;
  /** A column between the name and the row menu (a playlist item's date added); hidden on phones. */
  aside?: ReactNode;
  actions?: MenuAction[];
}

/** 1 → "01", 12 → "12", 123 → "123". */
export const rowNumber = (n: number) => String(n).padStart(2, "0");

/**
 * An entity in a list (library, playlist items, a release's tracks), like the search results: art on
 * the left, the name over its type and details, the saved glyph and the "⋯" row menu. Render it in a
 * `.library-list` (`<ul>`/`<ol>`).
 */
export function EntityRow({ name, meta, uri, art, number, openable = true, onOpen, hint, aside, actions = [], className, ...li }: Props) {
  const parsed = uri ? parseEntityUri(uri) : null;
  return (
    <li {...li} className={["library-row library-row--entity action-row", className].filter(Boolean).join(" ")}>
      {number != null ? <span className="entity-row__number">{rowNumber(number)}</span> : null}
      <button type="button" className="library-row__main" disabled={!openable} onClick={onOpen} title={hint}>
        {art ?? (parsed ? <EntityArt type={parsed.entityType} title={name} size="sm" uri={uri} /> : null)}
        <span className="library-row__text">
          <span className="library-row__label">{name}</span>
          {meta ? <span className="library-row__meta">{meta}</span> : null}
        </span>
      </button>
      {aside != null ? <span className="entity-row__aside">{aside}</span> : null}
      {uri || actions.length ? <ActionMenu name={name} uri={uri} actions={actions} /> : null}
    </li>
  );
}
