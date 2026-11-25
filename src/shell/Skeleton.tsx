import type { CSSProperties } from "react";

export interface SkeletonProps {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
}

/** An animated placeholder for content that is still loading. */
export function Skeleton({ width, height, className }: SkeletonProps) {
  return <span className={["skeleton", className].filter(Boolean).join(" ")} style={{ width, height }} aria-hidden="true" />;
}

/** A page-shaped skeleton: a title and a few rows. Shown while a page's code or data hasn't arrived. */
export function PageSkeleton({ rows = 5, label }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-page" role="status" aria-busy="true" aria-live="polite">
      {label ? <span className="sr-only">{label}</span> : null}
      <Skeleton className="skeleton--title" width="40%" height="1.75rem" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="skeleton--row" height="2.5rem" />
      ))}
    </div>
  );
}
