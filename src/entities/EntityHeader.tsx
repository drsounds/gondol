import type { ReactNode } from "react";
import { HeroHeader } from "../shell/HeroHeader";
import { useI18n } from "../i18n/i18n";
import { SavedIcon } from "../theme/savedIcon";
import { ActionMenu, type MenuAction } from "./ActionMenu";
import { entityExtensions } from "./extensions";
import { ShareButton } from "./ShareSheet";
import type { ResolvedEntityHeader } from "./entityHeaderSettings";
import { useEntityHeaderSettings } from "./useEntityHeaderSettings";

/**
 * The header at the top of an entity's own page, the same on every type (the generic entity view,
 * a playlist, a release, …): a HeroHeader with the visitor's header settings (fade, tint, parallax)
 * running edge to edge over the page, with the way back on top (`back`), then the entity's art and
 * its texts (`children`: the type, the title, a byline). Put it first in a `.hero-page`, and the
 * toolbar (`<EntityToolbar/>`) right under it.
 *
 * Its layout follows the header settings for the entity (useEntityHeaderSettings(): the visitor's
 * and the site's, per entity type, and the entity's own), or `settings` when the page resolved them
 * already. In the vertical layout phones show the art large and centred with the texts and
 * `description` under it (its own description under the toolbar, an `.entity-description`, is hidden there);
 * the entity's editor can hide the art while there is a header image.
 */
export function EntityHeader({
  uri,
  art,
  image,
  tintImage,
  back,
  className,
  description,
  settings,
  children,
}: {
  /** The entity, for its own tint colour. */
  uri?: string | null;
  art: ReactNode;
  /** The header image behind it, when it has one. */
  image?: string | null;
  /** Where the tint's colour comes from without a header image (its cover). */
  tintImage?: string | null;
  back?: ReactNode;
  className?: string;
  /** The entity's description, shown under its name on phones in the vertical layout. */
  description?: ReactNode;
  /** The header settings in effect, when the page resolved them already. */
  settings?: ResolvedEntityHeader;
  children: ReactNode;
}) {
  const resolved = useEntityHeaderSettings(uri);
  const { layout, hideArt } = settings ?? resolved;
  const showArt = !(hideArt && image);
  const classes = ["entity-view__hero", `entity-view__hero--${layout}`, showArt ? null : "entity-view__hero--no-art", className].filter(Boolean).join(" ");
  return (
    <HeroHeader uri={uri} className={classes} image={image ?? null} tintImage={tintImage ?? null}>
      {back}
      <div className="entity-view__hero-main">
        {showArt ? <div className="entity-view__art">{art}</div> : null}
        <div className="entity-view__text">
          {children}
          {layout === "vertical" && description ? <div className="entity-view__hero-description">{description}</div> : null}
        </div>
      </div>
    </HeroHeader>
  );
}

/** The type over an entity header's title (`<EntityHeader/>`'s children), with an optional badge. */
export function EntityHeaderType({ children, badge }: { children: ReactNode; badge?: ReactNode }) {
  return (
    <span className="entity-view__type">
      {children}
      {badge ? <span className="search-badge">{badge}</span> : null}
    </span>
  );
}

/**
 * The toolbar under an entity's header, the same on every page: an optional primary action first
 * (`primary`, e.g. a round play button), then the like (save to library, gondol's `useLike`
 * extension), "Share" and the "⋯" menu with the entity's own `actions` (and, from `uri`, everything
 * ActionMenu adds). `extra` goes after the menu, for page tools that belong beside it.
 */
export function EntityToolbar({
  uri,
  name,
  actions = [],
  primary,
  extra,
}: {
  uri: string;
  name: string;
  actions?: MenuAction[];
  primary?: ReactNode;
  extra?: ReactNode;
}) {
  const { t } = useI18n();
  const like = entityExtensions().useLike(uri, name);
  return (
    <div className="entity-view__actions">
      {primary}
      {like ? (
        <button
          type="button"
          className="entity-view__like"
          aria-pressed={like.liked}
          aria-label={like.liked ? t("actions.unlike", { name }) : t("actions.like", { name })}
          title={like.liked ? t("actions.unlike", { name }) : t("actions.like", { name })}
          onClick={() => like.setLiked(!like.liked)}
        >
          <SavedIcon saved={like.liked} />
        </button>
      ) : null}
      <ShareButton uri={uri} name={name} className="entity-view__share" />
      <span className="entity-view__more">
        <ActionMenu row={false} name={name} uri={uri} actions={actions} />
      </span>
      {extra ? <span className="entity-view__extra">{extra}</span> : null}
    </div>
  );
}

/** The big round play button that leads an entity's toolbar (`<EntityToolbar primary/>`). */
export function EntityPlayButton({ label, disabled, onClick, ...rest }: { label: string; disabled?: boolean; onClick: () => void; "data-tour"?: string }) {
  return (
    <button type="button" className="entity-view__play" aria-label={label} title={label} disabled={disabled} onClick={onClick} {...rest}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5Z" fill="currentColor" />
      </svg>
    </button>
  );
}
