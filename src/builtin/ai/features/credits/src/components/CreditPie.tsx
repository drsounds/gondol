import { creditShare } from "../../../../models";

/**
 * A pie of the credits left, counting down clockwise from the top: the accent while there's
 * plenty, warning under a quarter, danger under a tenth or when spent.
 */
export function CreditPie({ remaining, total, size = 22, label }: { remaining: number | null; total: number | null; size?: number; label?: string }) {
  const share = creditShare(remaining, total);
  const tone = share <= 0.1 ? "danger" : share <= 0.25 ? "warning" : "ok";
  const r = 8;
  const circumference = 2 * Math.PI * r;
  return (
    <svg
      className={`ai-credit-pie ai-credit-pie--${tone}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle className="ai-credit-pie__track" cx="10" cy="10" r="9" />
      {/* A stroke as wide as the radius draws a filled wedge. */}
      <circle
        className="ai-credit-pie__fill"
        cx="10"
        cy="10"
        r={r / 2}
        strokeWidth={r}
        strokeDasharray={`${(share * circumference) / 2} ${circumference}`}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}
