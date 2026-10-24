import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, Card } from "../../../../../../design-system/bungalow-79d923";
import type { DateRangeSearch } from "../../../../../../navigation/dateRangeSearch";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { useEntityDropTarget } from "../../../../../../entities/dragEntity";
import { entityTypeLabel, labelFor, useEntityLabels } from "../../../../../../entities/lookup";
import { useLibrary, type LibraryItem } from "../../../../models/library";
import { parseEntityUri, resolveEntityUri, type EntityType } from "../../../../../../entities/uri";
import { showToast } from "../../../../../../shell/clipboard";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import { useActiveBundles } from "../../../../../../apps/hooks";
import { EntityRow } from "../../../../../../entities/EntityRow";

interface Props {
  /** Opens an entity by its URI (the host's entity resolver, which also handles entries). */
  onOpenUri: (uri: string) => void;
}

/**
 * The user's library (ported from gantt-resume-pro's LibraryPage): one list, pinned entities as its
 * first rows, then everything saved, filterable by entity type. Entities land here via "Save to
 * library"/"Pin" in any row's action menu, or by dragging a row onto this panel.
 */
export function LibraryPanel({ onOpenUri }: Props) {
  const { t, intlLocale } = useI18n();
  const library = useLibrary();
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(intlLocale, { dateStyle: "medium" });
  const navigate = useNavigate();
  const [filter, setFilter] = useState<EntityType | null>(null);
  const { data: labels } = useEntityLabels([...library.pinned, ...library.saved].map((i) => i.spacify_uri));
  const drop = useEntityDropTarget((d) => void library.setSaved(d.uri, true, d.label).then(() => showToast(t("library.saved"))));
  // "New playlist" only while the playlists app is on.
  const playlistsOn = useActiveBundles().some((bundle) => bundle.id === "playlists");
  const newPlaylist = () => navigate({ to: "/playlists/new", search: (prev: DateRangeSearch) => prev } as Parameters<typeof navigate>[0]);

  // Pinned rows lead the list; a saved entity that is also pinned shows only there.
  const items = [
    ...library.pinned.map((item) => ({ item, kind: "pinned" as const })),
    ...library.saved.filter((s) => !library.isPinned(s.spacify_uri)).map((item) => ({ item, kind: "saved" as const })),
  ];
  const typeOf = (uri: string) => parseEntityUri(uri)?.entityType;
  const types = [...new Set(items.map(({ item }) => typeOf(item.spacify_uri)).filter(Boolean))] as EntityType[];
  const shown = filter ? items.filter(({ item }) => typeOf(item.spacify_uri) === filter) : items;

  const displayName = (item: LibraryItem) => labelFor(labels, item.spacify_uri) ?? item.label ?? item.spacify_uri;

  // Like every other entity list (and the search results): art, the name over its type and
  // details, and the saved glyph (from the row's ActionMenu) on saved rows; pressing it opens
  // "Add to playlist" with "Saved" first.
  function row(item: LibraryItem, kind: "pinned" | "saved") {
    const name = displayName(item);
    const openable = resolveEntityUri(item.spacify_uri) !== null;
    const meta = [
      entityTypeLabel(t, item.spacify_uri),
      kind === "pinned" ? t("library.pinned") : t("library.savedOn", { date: formatDate(item.created_at) }),
    ];
    return (
      <EntityRow
        key={item.id}
        name={name}
        uri={item.spacify_uri}
        meta={
          <>
            {kind === "pinned" ? <PinGlyph /> : null}
            {meta.join(" · ")}
          </>
        }
        openable={openable}
        onOpen={() => onOpenUri(item.spacify_uri)}
        actions={openable ? [{ key: "open", label: t("actions.open"), onSelect: () => onOpenUri(item.spacify_uri) }] : []}
      />
    );
  }

  return (
    <Card>
      <div className={drop.over ? "stack drop-zone drop-zone--over" : "stack drop-zone"} {...drop.props}>
        <div className="panel-head">
          <div className="panel-title">{t("library.title")}</div>
          {playlistsOn ? (
            <Button size="sm" tone="primary" onClick={newPlaylist}>
              {t("playlists.add")}
            </Button>
          ) : null}
        </div>

        {types.length > 1 ? (
          <div className="search-chips" role="group" aria-label={t("library.filter")}>
            <button type="button" className="search-chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
              {t("library.filterAll")}
            </button>
            {types.map((type) => (
              <button
                key={type}
                type="button"
                className="search-chip"
                aria-pressed={filter === type}
                onClick={() => setFilter(filter === type ? null : type)}
              >
                {t(`entity.${type}` as MessageKey)}
              </button>
            ))}
          </div>
        ) : null}

        {library.isLoading ? (
          <p className="muted">{t("app.loading")}</p>
        ) : items.length === 0 ? (
          <EmptyState
            items={t("library.items")}
            description={t("library.empty")}
            {...(playlistsOn ? { actionLabel: t("playlists.add"), onAction: newPlaylist } : {})}
          />
        ) : (
          <ul className="library-list">{shown.map(({ item, kind }) => row(item, kind))}</ul>
        )}

        <p className="drop-zone__hint">{t("library.dropHint")}</p>
      </div>
    </Card>
  );
}

function PinGlyph() {
  return (
    <svg className="library-row__pin" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 1.5h4l-.5 4 2.5 2.5v1H4v-1l2.5-2.5-.5-4Z M8 9v5.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
