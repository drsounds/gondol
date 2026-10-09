import { useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "../design-system/bungalow-79d923";

export interface WalkthroughStep {
  /** Matches a `data-tour="<target>"` attribute on the element to highlight. */
  target: string;
  title: string;
  body: string;
}

interface WalkthroughProps {
  steps: WalkthroughStep[];
  onFinish: () => void;
  skipLabel: string;
  backLabel: string;
  nextLabel: string;
  doneLabel: string;
  stepCountLabel: (current: number, total: number) => string;
}

const TOOLTIP_WIDTH = 320;
const TOOLTIP_MARGIN = 12;

function tooltipStyle(rect: DOMRect | null): CSSProperties {
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const spaceBelow = viewportH - rect.bottom;
  const top = spaceBelow > 200 ? rect.bottom + TOOLTIP_MARGIN : Math.max(TOOLTIP_MARGIN, rect.top - 200);
  const maxLeft = viewportW - TOOLTIP_WIDTH - TOOLTIP_MARGIN;
  const left = Math.min(Math.max(TOOLTIP_MARGIN, rect.left), Math.max(TOOLTIP_MARGIN, maxLeft));
  return { top, left };
}

/**
 * Spotlight/highlight tour: dims the screen except for a cutout around the
 * current step's target element, with a tooltip alongside it. Used both for
 * the first-time onboarding tour and the "new feature" guide popovers for
 * unseen app upgrades (see useOnboarding, AppUpgradesProvider + the
 * Dashboard's Walkthrough wiring in src/routes/index.tsx). Falls back to a centered, un-highlighted tooltip if
 * a step's target isn't currently in the DOM.
 */
export function Walkthrough({ steps, onFinish, skipLabel, backLabel, nextLabel, doneLabel, stepCountLabel }: WalkthroughProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[index];

  useLayoutEffect(() => {
    function update() {
      // A target can exist twice at once (e.g. the notification bell renders
      // once for the desktop chrome bar and once for the mobile header, each
      // hidden by CSS at the other breakpoint) — pick the one actually laid
      // out on screen rather than whichever comes first in the DOM.
      const candidates = document.querySelectorAll(`[data-tour="${step.target}"]`);
      let match: DOMRect | null = null;
      for (const el of candidates) {
        const candidateRect = el.getBoundingClientRect();
        if (candidateRect.width > 0 && candidateRect.height > 0) {
          match = candidateRect;
          break;
        }
      }
      setRect(match);
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.target]);

  const isLast = index === steps.length - 1;

  return createPortal(
    <div className="walkthrough" role="dialog" aria-modal="true" aria-label={step.title}>
      {rect ? (
        <div
          className="walkthrough__spotlight"
          style={{ top: rect.top - 8, left: rect.left - 8, width: rect.width + 16, height: rect.height + 16 }}
        />
      ) : (
        <div className="walkthrough__overlay" />
      )}
      <div className="walkthrough__tooltip" style={{ width: TOOLTIP_WIDTH, ...tooltipStyle(rect) }}>
        {steps.length > 1 ? <div className="walkthrough__step-count">{stepCountLabel(index + 1, steps.length)}</div> : null}
        <div className="walkthrough__title">{step.title}</div>
        <p className="walkthrough__body">{step.body}</p>
        <div className="walkthrough__actions">
          <Button variant="ghost" size="sm" onClick={onFinish}>
            {skipLabel}
          </Button>
          <div className="row-actions">
            {index > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setIndex((i) => i - 1)}>
                {backLabel}
              </Button>
            ) : null}
            <Button size="sm" tone="primary" onClick={() => (isLast ? onFinish() : setIndex((i) => i + 1))}>
              {isLast ? doneLabel : nextLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
