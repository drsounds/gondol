import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntityArt } from "../../../../../../entities/EntityArt";
import { showToast } from "../../../../../../shell/clipboard";
import type { DateRangeSearch } from "../../../../../../navigation/dateRangeSearch";
import { useEntityDropTarget } from "../../../../../../entities/dragEntity";
import { entityTypeLabel, labelFor, useEntityLabels } from "../../../../../../entities/lookup";
import { useI18n } from "../../../../../../i18n/i18n";
import { useLibrary } from "../../../../models/library";
import { playlistItemsQueryOptions, playlistsQueryOptions, useAddToPlaylist } from "../../../../../playlists/models/playlists";
import { parseEntityUri, resolveEntityUri, toEntityUri, type EntityType } from "../../../../../../entities/uri";
import { useActiveBundles } from "../../../../../../apps/hooks";
import { SavedIcon } from "../../../../../../theme/savedIcon";

interface Props {
  /** Opens an entity by its URI (the host's entity resolver, which also handles entries). */
  onOpenUri: (uri: string) => void;
  /** Icon-only rail: just the cover art, names as tooltips. */
  collapsed: boolean;
}

type Filter = "all" | "playlists" | "saved";

interface LibraryEntry {
  uri: string;
  type: EntityType;
  title: string;
  subtitle: string;
  pinned: boolean;
  /** Set for playlists, which also accept dropped entities. */
  playlistId?: string;
}

/**
 * "Your Library" at the bottom of the desktop sidebar, like Spotify's left pane: pinned entities
 * first, then the user's playlists and everything saved, filterable with chips. Dropping a row on
 * the section saves it to the library; dropping it on a playlist adds it to that playlist.
 * Hidden below 64rem, where the bottom nav's Library tab is the way in.
 */
export function SidebarLibrary({ onOpenUri, collapsed }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const library = useLibrary();
  // The user's playlists are listed (and can be made) only while the playlists app is on.
  const playlistsOn = useActiveBundles().some((bundle) => bundle.id === "playlists");
  const playlists = useQuery({ ...playlistsQueryOptions, enabled: playlistsOn }).data ?? [];
  const playlistItems = useQuery({ ...playlistItemsQueryOptions, enabled: playlistsOn }).data ?? [];
  const [filter, setFilter] = useState<Filter>("all");
  const [scrolled, setScrolled] = useState(false);
  const { data: labels } = useEntityLabels([...library.pinned, ...library.saved].map((i) => i.spacify_uri));
  const drop = useEntityDropTarget((d) => void library.setSaved(d.uri, true, d.label).then(() => showToast(t("library.saved"))));

  const go = (to: string) => navigate({ to, search: (prev: DateRangeSearch) => prev } as Parameters<typeof navigate>[0]);

  const playlistEntry = (id: string, pinned: boolean): LibraryEntry | null => {
    const p = playlists.find((pl) => pl.id === id);
    if (!p) return null;
    const count = playlistItems.filter((i) => i.playlist_id === p.id).length;
    return {
      uri: toEntityUri("playlist", p.id),
      type: "playlist",
      title: p.name,
      subtitle: `${t("entity.playlist")} · ${t("playlists.itemCountValue", { count })}`,
      pinned,
      playlistId: p.id,
    };
  };
  const libraryEntry = (uri: string, label: string | null, pinned: boolean): LibraryEntry | null => {
    const parsed = parseEntityUri(uri);
    if (!parsed) return null;
    if (parsed.entityType === "playlist") {
      const own = playlistEntry(parsed.entityId, pinned);
      if (own) return own;
    }
    return {
      uri,
      type: parsed.entityType,
      title: labelFor(labels, uri) ?? label ?? uri,
      subtitle: entityTypeLabel(t, uri),
      pinned,
    };
  };

  const pinnedUris = new Set(library.pinned.map((p) => p.spacify_uri));
  const pinned = library.pinned.map((p) => libraryEntry(p.spacify_uri, p.label, true)).filter((e): e is LibraryEntry => e !== null);
  const ownPlaylists = playlists
    .filter((p) => !pinnedUris.has(toEntityUri("playlist", p.id)))
    .map((p) => playlistEntry(p.id, false))
    .filter((e): e is LibraryEntry => e !== null);
  const listed = new Set([...pinned, ...ownPlaylists].map((e) => e.uri));
  const saved = library.saved
    .filter((s) => !listed.has(s.spacify_uri))
    .map((s) => libraryEntry(s.spacify_uri, s.label, false))
    .filter((e): e is LibraryEntry => e !== null);

  const entries =
    filter === "playlists"
      ? [...pinned.filter((e) => e.type === "playlist"), ...ownPlaylists]
      : filter === "saved"
        ? [...pinned.filter((e) => e.type !== "playlist"), ...saved]
        : [...pinned, ...ownPlaylists, ...saved];

  return (
    <section
      className={[
        "sidebar-library",
        collapsed ? "sidebar-library--collapsed" : "",
        drop.over ? "sidebar-library--over" : "",
        scrolled ? "sidebar-library--scrolled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={t("sidebarLibrary.title")}
      {...drop.props}
    >
      <div className="sidebar-library__top">
      <div className="sidebar-library__head">
        <button
          type="button"
          className="sidebar-library__title"
          title={t("sidebarLibrary.title")}
          aria-current={pathname.startsWith("/library") ? "page" : undefined}
          onClick={() => go("/library")}
        >
          <SavedIcon saved className="nav-item__icon" />
          <span className="sidebar-library__title-text">{t("sidebarLibrary.title")}</span>
        </button>
        {collapsed || !playlistsOn ? null : (
          <button type="button" className="sidebar-library__add" aria-label={t("playlists.add")} title={t("playlists.add")} onClick={() => go("/playlists/new")}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {collapsed || !playlistsOn ? null : (
        <div className="sidebar-library__chips" role="group" aria-label={t("library.filter")}>
          {(["all", "playlists", "saved"] as const).map((f) => (
            <button key={f} type="button" className="search-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? t("library.filterAll") : f === "playlists" ? t("playlists.title") : t("library.savedSection")}
            </button>
          ))}
        </div>
      )}
      </div>

      {/* Only the list scrolls; the header above stays put, with a shadow once scrolled. */}
      <div className="sidebar-library__scroll" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
      {entries.length === 0 ? (
        collapsed ? null : <p className="sidebar-library__empty">{t("sidebarLibrary.empty")}</p>
      ) : (
        <ul className="sidebar-library__list">
          {entries.map((entry) => (
            <SidebarLibraryRow
              key={entry.uri}
              entry={entry}
              active={isActive(entry.uri, pathname)}
              collapsed={collapsed}
              onOpen={() => onOpenUri(entry.uri)}
            />
          ))}
        </ul>
      )}
      </div>
    </section>
  );
}

function isActive(uri: string, pathname: string) {
  const target = resolveEntityUri(uri);
  return target?.kind === "path" && (pathname === target.path || pathname.startsWith(`${target.path}/`));
}

function SidebarLibraryRow({
  entry,
  active,
  collapsed,
  onOpen,
}: {
  entry: LibraryEntry;
  active: boolean;
  collapsed: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const add = useAddToPlaylist();
  const openable = resolveEntityUri(entry.uri) !== null;
  // Dropping an entity on a playlist appends it there (and doesn't also save it to the library).
  const drop = useEntityDropTarget((d) => {
    if (!entry.playlistId || d.uri === entry.uri) return;
    add.mutate({ playlistId: entry.playlistId, uri: d.uri }, { onSuccess: () => showToast(t("playlists.added", { name: entry.title })) });
  });
  const dropProps = entry.playlistId ? drop.props : {};
  return (
    <li
      className={["sidebar-library__row", "action-row", active ? "sidebar-library__row--active" : "", drop.over ? "sidebar-library__row--over" : ""]
        .filter(Boolean)
        .join(" ")}
      {...dropProps}
    >
      <button
        type="button"
        className="sidebar-library__main"
        disabled={!openable}
        onClick={onOpen}
        title={collapsed ? entry.title : undefined}
        aria-current={active ? "page" : undefined}
      >
        <EntityArt type={entry.type} title={entry.title} size="sm" uri={entry.uri} />
        <span className="sidebar-library__text">
          <span className="sidebar-library__name">{entry.title}</span>
          <span className="sidebar-library__sub">
            {entry.pinned ? <PinGlyph label={t("library.pinned")} /> : null}
            {entry.subtitle}
          </span>
        </span>
      </button>
      {collapsed ? null : (
        <ActionMenu name={entry.title} uri={entry.uri} actions={openable ? [{ key: "open", label: t("actions.open"), onSelect: onOpen }] : []} />
      )}
    </li>
  );
}

function PinGlyph({ label }: { label: string }) {
  return (
    <svg className="sidebar-library__pin" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" role="img" aria-label={label}>
      <path d="M6 1.5h4l-.5 4 2.5 2.5v1H4v-1l2.5-2.5-.5-4Z M7.3 9h1.4v5.5H7.3Z" />
    </svg>
  );
}
