import type { FormEvent, MouseEvent, ReactNode } from "react";
import { ActionMenu, type MenuAction } from "./ActionMenu";

interface EntitySheetProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  closeLabel: string;
  /** Right-hand panel shown alongside the form on wide screens: always renders in a fixed dark
   *  theme (see .sheet__preview in styles.css), independent of the app's light/dark setting. */
  preview?: ReactNode;
  /** Footer actions, e.g. <FormActions/>. Spans the full width of the sheet, below both columns. */
  footer?: ReactNode;
  /** When set, the body and footer are wrapped in a <form> so the footer's submit button works. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** spacify: URI of the entity being edited; adds "Share" (and the app's entity actions) to the header's actions menu. */
  uri?: string;
  /** Extra entity actions for the header's "⋯" menu (save/delete stay in the footer). */
  actions?: MenuAction[];
  children: ReactNode;
}

/**
 * Shared create/edit modal shell: every panel's "create" and "edit" view is required to use this
 * (see CLAUDE.md, "Create/edit views") rather than an inline form expanded under a list.
 * Layout: full-width header, a two-column body (scrollable form left, fixed-dark preview right)
 * on wide screens, and a full-width footer with the primary save action bottom-right.
 */
export function EntitySheet({ title, subtitle, onClose, closeLabel, preview, footer, onSubmit, uri, actions = [], children }: EntitySheetProps) {
  function stop(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  const body = (
    <div className="sheet__body">
      <div className="sheet__scroll">{children}</div>
      {preview ? <div className="sheet__preview">{preview}</div> : null}
    </div>
  );
  const footerRow = footer ? <div className="sheet__footer">{footer}</div> : null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={preview ? "sheet sheet--split" : "sheet"} role="dialog" aria-modal="true" onClick={stop}>
        <div className="sheet__header">
          <div>
            <h2 className="panel-title">{title}</h2>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          <div className="sheet__header-actions">
            {uri || actions.length > 0 ? (
              <ActionMenu actions={actions} uri={uri} row={false} name={typeof title === "string" ? title : ""} />
            ) : null}
            <button type="button" className="sheet__close" onClick={onClose} aria-label={closeLabel}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        {onSubmit ? (
          <form className="sheet__form-shell" onSubmit={onSubmit}>
            {body}
            {footerRow}
          </form>
        ) : (
          <>
            {body}
            {footerRow}
          </>
        )}
      </div>
    </div>
  );
}
