export interface SimpleSpinnerIconProps {
  size?: number;
  className?: string;
}

/**
 * A minimal geometric loading mark: a ring built from three rounded slices,
 * rolling as one rigid shape. Built for places the brand's lottie flower
 * reads as noise — small inline spaces like button loading states — where a
 * couple of flat primitives read instantly at any size.
 */
export function SimpleSpinnerIcon({ size = 16, className }: SimpleSpinnerIconProps) {
  return (
    <svg
      className={["simple-spinner", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        className="simple-spinner__ring"
        cx="16"
        cy="16"
        r="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        pathLength={120}
        strokeDasharray="20 20"
      />
      <circle className="simple-spinner__hub" cx="16" cy="16" r="3" fill="currentColor" />
    </svg>
  );
}
