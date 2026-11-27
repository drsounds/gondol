import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../i18n/i18n";

/**
 * Text clamped to a few lines with "Show more" / "Show less" (only when the clamp hides anything).
 * The About card uses it, and so does an entity page's description under its toolbar
 * (`<EntityDescription/>`).
 */
export function ClampedText({ lines = 4, className, children }: { lines?: number; className?: string; children: ReactNode }) {
  const { t } = useI18n();
  const textRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, children]);

  return (
    <div className={className ? `clamped-text ${className}` : "clamped-text"}>
      <div
        ref={textRef}
        className={expanded ? "clamped-text__text" : "clamped-text__text clamped-text__text--clamped"}
        style={{ WebkitLineClamp: lines, lineClamp: lines } as CSSProperties}
      >
        {children}
      </div>
      {clamped || expanded ? (
        <button type="button" className="link-button clamped-text__more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? t("about.showLess") : t("about.showMore")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The description of a "thing" entity (a playlist, a release, a quest, …) right under its page's
 * toolbar, clamped to three lines. People and organizations (subjects) show theirs in the About card
 * at the bottom of the page instead (`<AboutCard/>`).
 */
export function EntityDescription({ children }: { children: ReactNode }) {
  return (
    <ClampedText lines={3} className="entity-description">
      {children}
    </ClampedText>
  );
}
