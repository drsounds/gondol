import type { ReactNode } from "react";
import { useI18n } from "../i18n/i18n";
import { ClampedText } from "./ClampedText";
import { EntityArt } from "./EntityArt";
import type { EntityType } from "./uri";

/**
 * The "About" card at the bottom of an entity's page, like the one on a Spotify artist's page: the
 * entity's cover image across the top of the card (or its art beside the text when it has none) and
 * its description under it, clamped to a few lines with "Show more". Only subjects (people,
 * organizations, suppliers, …) show their description here; other entities show it under the toolbar
 * with `<EntityDescription/>`. Never under the title in the header.
 */
export function AboutCard({
  type,
  title,
  image,
  uri,
  children,
}: {
  /** The entity's type, for the fallback art. */
  type: EntityType;
  /** The entity's name: the fallback art's initials and the image's alt text. */
  title: string;
  /** The cover image (a horizontal, header or square cover); without one the entity's art is shown. */
  image?: string | null;
  /** The entity's URI, for the fallback art. */
  uri?: string;
  /** The description itself (plain text, or rich text rendered by the host). */
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <section className="about-card-section" aria-label={t("about.title")}>
      <h2 className="about-card-section__title">{t("about.title")}</h2>
      <div className={image ? "about-card about-card--image" : "about-card about-card--art"}>
        {image ? (
          <div className="about-card__image">
            <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />
          </div>
        ) : (
          <span className="about-card__art" aria-hidden="true">
            <EntityArt type={type} title={title || "?"} size="lg" uri={uri} />
          </span>
        )}
        <div className="about-card__body">
          <ClampedText className="about-card__text">{children}</ClampedText>
        </div>
      </div>
    </section>
  );
}
