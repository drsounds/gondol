import type { ReactNode } from "react";
import { Button } from "../design-system/bungalow-79d923";
import { useI18n } from "../i18n/i18n";
import { useSiteOffers } from "../sites/capabilities";

interface EmptyStateProps {
  /** What the list holds, plural and lower case ("projects"), for the default title and text. */
  items: string;
  /** Overrides "We couldn't find any {items}". */
  title?: ReactNode;
  /** Overrides "When you create {items} they will show up here." */
  description?: ReactNode;
  /** The create action, usually the same as the list header's add button. */
  actionLabel?: ReactNode;
  onAction?: () => void;
  actionDisabled?: boolean;
  /** Glyph inside the circle; a magnifying glass by default. */
  icon?: ReactNode;
}

/** Spotify-style "nothing here" placeholder for an empty list: a round glyph, a title, a line of text and a create button. */
export function EmptyState({ items, title, description, actionLabel, onAction, actionDisabled, icon }: EmptyStateProps) {
  const { t } = useI18n();
  // The create action goes when the site doesn't offer creating (its aspects, sites/capabilities.ts).
  const canCreate = useSiteOffers()({ aspects: ["create"] });
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon ?? <MagnifyingGlass />}</div>
      <p className="empty-state__title">{title ?? t("empty.title", { items })}</p>
      <p className="empty-state__text">{description ?? t("empty.description", { items })}</p>
      {actionLabel && onAction && canCreate ? (
        <Button variant="outline" onClick={onAction} disabled={actionDisabled}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function MagnifyingGlass() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="2.25" />
      <path d="M15 15 20.5 20.5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
    </svg>
  );
}
