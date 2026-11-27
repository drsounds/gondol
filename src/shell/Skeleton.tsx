import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../i18n/i18n";

/**
 * Skeletons: what a view shows where its data hasn't arrived yet. Views render at once on
 * navigation (src/navigation/NavigationProgress.tsx); data a query already has, from this visit
 * or an earlier one (src/navigation/queryCache.ts), shows straight away while it refreshes, and
 * only data never loaded on this device is drawn as these animated placeholders, shaped like what
 * will replace them:
 *
 * - `SkeletonTable` for a `.data-table` (a table on desktop, Spotify-style list rows on phones,
 *   matching how tables render there),
 * - `SkeletonRows` for a `.library-list` of `EntityRow`s or any other list,
 * - `SkeletonTiles` for a grid of cards or covers, `SkeletonMessages` for a chat,
 * - `SkeletonHeader` for an entity page's art and title, `SkeletonText` for paragraphs,
 * - `PageSkeleton` for a whole page (a lazy page's code is loading).
 *
 * Each group is one `role="status"` announcing "Loading…" to screen readers.
 */

export interface SkeletonProps {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  /** Round (an avatar or a round cover). */
  circle?: boolean;
  className?: string;
}

/** An animated placeholder for one piece of content that is still loading. */
export function Skeleton({ width, height, circle, className }: SkeletonProps) {
  return (
    <span
      className={["skeleton", circle ? "skeleton--circle" : null, className].filter(Boolean).join(" ")}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** Text-bar widths, varied so rows don't look like a striped wall; the same every render. */
const WIDTHS = [72, 54, 86, 63, 47, 79, 58, 68];
const width = (i: number, scale = 1) => `${Math.round(WIDTHS[i % WIDTHS.length] * scale)}%`;

/** The live region around a group of skeletons. */
function Loading({ className, children, label }: { className: string; children: ReactNode; label?: string }) {
  const { t } = useI18n();
  return (
    <div className={`skeleton-group ${className}`} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label ?? t("app.loading")}</span>
      {children}
    </div>
  );
}

export interface SkeletonRowsProps {
  /** How many rows. */
  rows?: number;
  /** Cover art on the left (default), `round` for people, or none. */
  art?: boolean | "round";
  /** Numbered rows (a playlist, a tracklist). */
  numbered?: boolean;
  label?: string;
  className?: string;
}

/** List rows like the search results and `EntityRow`s: art, a name and a muted line under it. */
export function SkeletonRows({ rows = 6, art = true, numbered, label, className }: SkeletonRowsProps) {
  return (
    <Loading className={["skeleton-rows", className].filter(Boolean).join(" ")} label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-rows__row">
          {numbered ? <Skeleton className="skeleton-rows__number" /> : null}
          {art ? <Skeleton className="skeleton-rows__art" circle={art === "round"} /> : null}
          <span className="skeleton-rows__text">
            <Skeleton className="skeleton--line" width={width(i, 0.7)} />
            <Skeleton className="skeleton--line skeleton--small" width={width(i + 3, 0.5)} />
          </span>
        </div>
      ))}
    </Loading>
  );
}

export interface SkeletonTableProps {
  rows?: number;
  /** Columns on desktop, the name's included. */
  columns?: number;
  label?: string;
}

/**
 * A `.data-table` still loading: header and rows of bars on desktop and, below 40rem, where every
 * data table renders as list rows, the same list rows as `SkeletonRows`.
 */
export function SkeletonTable({ rows = 6, columns = 4, label }: SkeletonTableProps) {
  const cols = Math.max(1, columns);
  return (
    <Loading className="skeleton-table" label={label}>
      <div className="data-table-wrap skeleton-table__wide" aria-hidden="true">
        <table className="data-table">
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c}>
                  <Skeleton className="skeleton--line skeleton--small" width={c === 0 ? "40%" : "55%"} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c}>
                    <Skeleton className="skeleton--line" width={width(r + c * 2, c === 0 ? 0.9 : 0.6)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="skeleton-table__narrow" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton-rows__row">
            <Skeleton className="skeleton-rows__art" />
            <span className="skeleton-rows__text">
              <Skeleton className="skeleton--line" width={width(i, 0.7)} />
              <Skeleton className="skeleton--line skeleton--small" width={width(i + 3, 0.5)} />
            </span>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** A grid of cards or covers, each with a caption. */
export function SkeletonTiles({ tiles = 6, wide, label }: { tiles?: number; wide?: boolean; label?: string }) {
  return (
    <Loading className={["skeleton-tiles", wide ? "skeleton-tiles--wide" : null].filter(Boolean).join(" ")} label={label}>
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="skeleton-tiles__tile">
          <Skeleton className="skeleton-tiles__art" />
          <Skeleton className="skeleton--line" width={width(i, 0.8)} />
          <Skeleton className="skeleton--line skeleton--small" width={width(i + 2, 0.5)} />
        </div>
      ))}
    </Loading>
  );
}

/** Chat bubbles, alternating sides. */
export function SkeletonMessages({ messages = 4, label }: { messages?: number; label?: string }) {
  return (
    <Loading className="skeleton-messages" label={label}>
      {Array.from({ length: messages }, (_, i) => (
        <div key={i} className={["skeleton-messages__message", i % 2 ? "skeleton-messages__message--own" : null].filter(Boolean).join(" ")}>
          {i % 2 ? null : <Skeleton className="skeleton-messages__avatar" circle />}
          <span className="skeleton-messages__bubble">
            <Skeleton className="skeleton--line" width={width(i, 0.9)} />
            {i % 3 === 0 ? <Skeleton className="skeleton--line" width={width(i + 1, 0.6)} /> : null}
          </span>
        </div>
      ))}
    </Loading>
  );
}

/** Lines of text. */
export function SkeletonText({ lines = 3, label }: { lines?: number; label?: string }) {
  return (
    <Loading className="skeleton-text" label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="skeleton--line" width={i === lines - 1 ? "45%" : width(i, 1.15)} />
      ))}
    </Loading>
  );
}

/** An entity page's header (cover art, type, name, a line of details), optionally with rows under it. */
export function SkeletonHeader({ rows = 0, round, label }: { rows?: number; round?: boolean; label?: string }) {
  return (
    <Loading className="skeleton-header-page" label={label}>
      <div className="skeleton-header">
        <Skeleton className="skeleton-header__art" circle={round} />
        <span className="skeleton-header__text">
          <Skeleton className="skeleton--line skeleton--small" width="5rem" />
          <Skeleton className="skeleton--title" width="60%" />
          <Skeleton className="skeleton--line skeleton--small" width="35%" />
        </span>
      </div>
      {rows > 0
        ? Array.from({ length: rows }, (_, i) => (
            <div key={i} className="skeleton-rows__row">
              <Skeleton className="skeleton-rows__art" />
              <span className="skeleton-rows__text">
                <Skeleton className="skeleton--line" width={width(i, 0.7)} />
                <Skeleton className="skeleton--line skeleton--small" width={width(i + 3, 0.5)} />
              </span>
            </div>
          ))
        : null}
    </Loading>
  );
}

/** A page-shaped skeleton: a title, an intro line and a list. Shown while a page's code hasn't arrived. */
export function PageSkeleton({ rows = 6, label }: { rows?: number; label?: string }) {
  return (
    <Loading className="skeleton-page" label={label}>
      <div className="skeleton-page__head">
        <span className="skeleton-page__title">
          <Skeleton className="skeleton--title" width="40%" />
          <Skeleton className="skeleton--line skeleton--small" width="60%" />
        </span>
        <Skeleton className="skeleton-page__button" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-rows__row">
          <Skeleton className="skeleton-rows__art" />
          <span className="skeleton-rows__text">
            <Skeleton className="skeleton--line" width={width(i, 0.7)} />
            <Skeleton className="skeleton--line skeleton--small" width={width(i + 3, 0.5)} />
          </span>
        </div>
      ))}
    </Loading>
  );
}
