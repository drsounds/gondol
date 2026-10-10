import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { DateRangeSearch } from "./dateRangeSearch";
import { useSiteOffers } from "../sites/capabilities";

/**
 * Where closing an edit sheet goes back to when it was opened from somewhere other than its list,
 * e.g. the entity's view (/supplier/acme -> /supplier/acme/edit -> back to /supplier/acme).
 */
let returnTo: { editPath: string; backPath: string } | null = null;

/** Records that the sheet at `editPath` (an in-app path) should close back to `backPath`. */
export function closeEditBackTo(editPath: string, backPath: string) {
  returnTo = { editPath, backPath };
}

export type EntityModalState = { mode: "closed" } | { mode: "new" } | { mode: "edit"; id: string };

/**
 * Drives a create/edit EntitySheet from the URL instead of local component state, per the
 * standing convention in CLAUDE.md ("Create/edit views"): `${listPath}/new` opens the create
 * modal, `${listPath}/$slug/edit` opens the edit modal for that row, and navigating back to
 * `listPath` closes it. `id` is the key from the URL — open with `openEdit(entityKey(row))` and
 * find the row with `findByEntityKey(rows, modal.id)` (src/lib/slugs.ts), which also matches old
 * uuid links. `search` is preserved across all three navigations (e.g. the date range).
 *
 * `closePath` overrides where closing goes, for modals nested under an entity that has no list
 * route of its own at `listPath` (e.g. `/streams/$id/entries/…` closes back to `/streams`).
 *
 * The two paths must exist as real route files (see CLAUDE.md for the file-naming convention) —
 * this hook only reads/writes the URL, it doesn't register routes.
 *
 * `closePath` is where closing navigates to, when that differs from `listPath` — e.g. task modals
 * opened from a board live under `/boards/$boardId/tasks/...` but close back to the board.
 */
export function useEntityModal(listPath: string, closePath: string = listPath): EntityModalState & {
  openNew: () => void;
  openEdit: (id: string) => void;
  close: () => void;
} {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const newPath = `${listPath}/new`;
  const editPrefix = `${listPath}/`;
  const editSuffix = "/edit";
  // A site that doesn't offer creating (its aspects, sites/capabilities.ts) never opens a create sheet.
  const canCreate = useSiteOffers()({ aspects: ["create"] });

  let state: EntityModalState = { mode: "closed" };
  if (pathname === newPath) {
    if (canCreate) state = { mode: "new" };
  } else if (pathname.startsWith(editPrefix) && pathname.endsWith(editSuffix)) {
    const id = pathname.slice(editPrefix.length, pathname.length - editSuffix.length);
    if (id && !id.includes("/")) state = { mode: "edit", id };
  }

  // These sub-routes are dynamic per entity, so `to` can't be a literal from the router's
  // registered union; the whole options object is cast instead of `to` alone so `search`
  // keeps its real (DateRangeSearch) => DateRangeSearch type.
  function go(to: string) {
    navigate({ to, search: (prev: DateRangeSearch) => prev } as Parameters<typeof navigate>[0]);
  }

  return {
    ...state,
    openNew: () => go(newPath),
    openEdit: (id: string) => go(`${listPath}/${id}/edit`),
    close: () => {
      const back = returnTo?.editPath === pathname ? returnTo.backPath : null;
      returnTo = null;
      go(back ?? closePath);
    },
  };
}

/** Navigate to a dynamic path (e.g. `/boards/${id}`) keeping the current search params. */
export function useNavigateKeepingSearch(): (to: string) => void {
  const navigate = useNavigate();
  return (to: string) => navigate({ to, search: (prev: DateRangeSearch) => prev } as Parameters<typeof navigate>[0]);
}
