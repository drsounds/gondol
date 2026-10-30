import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EntityPicker } from "../../../../../../entities/EntityPicker";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ActionMenu, type MenuAction } from "../../../../../../entities/ActionMenu";
import { EntityArt } from "../../../../../../entities/EntityArt";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { Button, Card, Icon, Input } from "../../../../../../design-system/bungalow-79d923";
import { supabase } from "../../../../models/db";
import { copyText, showToast } from "../../../../../../shell/clipboard";
import type { DateRangeSearch } from "../../../../../../navigation/dateRangeSearch";
import { readEntityDrop, useEntityDropTarget } from "../../../../../../entities/dragEntity";
import { canonicalEntityUri, entityTypeLabel, labelFor, useEntityLabels } from "../../../../../../entities/lookup";
import { entityRefFromText } from "../../../../../../entities/shareUri";
import { formatShortcut, isEditableElement, isMac } from "../../../../../../navigation/shortcuts";
import { useI18n } from "../../../../../../i18n/i18n";
import { useLinkPreview } from "../../../../../../media/linkPreview";
import { EntityRow } from "../../../../../../entities/EntityRow";
import { useLibraryPickerOptions } from "../../../../../library/models/library";
import { mediaHost, type EntityCovers } from "../../../../../../media/host";
import {
  isPlaylistItemUri,
  isWebLink,
  normalizePlaylistItemUri,
  playlistByKeyQueryOptions,
  playlistItemAddedOn,
  playlistItemsQueryOptions,
  playlistsQueryOptions,
  useAddToPlaylist,
  usePlaylistCovers,
  type Playlist,
  type PlaylistItem,
} from "../../../../models/playlists";
import { usePlaylistHistory } from "../../../../models/history";
import { moveBlock, placeShown } from "../../../../models/itemOrder";
import { pastedTokens, recallCopied, rememberCopied } from "../../../../models/clipboard";
import { playlistsHost } from "../../../../models/host";
import { isEntityUri, resolveEntityUri, toEntityUri } from "../../../../../../entities/uri";
import { useEntityModal } from "../../../../../../navigation/useEntityModal";
import { entityKey, findByEntityKey } from "../../../../../../entities/slugs";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { useSiteShows } from "../../../../../../sites/sites";

/** Drag payload for reordering within a playlist (alongside the usual entity payload). */
const PLAYLIST_ITEM_MIME = "application/x-playlist-item";

interface Props {
  onOpenUri: (uri: string) => void;
}

interface PlaylistDraft {
  name: string;
  description: string;
  is_public: boolean;
  /** Media ids of the header image and image (null: none). */
  header_image: string | null;
  square_cover_image: string | null;
}

type ImageSlot = "header_image" | "square_cover_image";

/**
 * Playlists (ported from gantt-resume-pro): ordered collections of any entity, by its entity
 * URI, and of web links. `/playlists` lists them, `/playlists/$id` shows one playlist with its
 * header image, image, title and description, and its items, which can be reordered by dragging
 * and grow by dropping any entity row or link onto the list (or via "Add to playlist…").
 */
export function PlaylistsPanel({ onOpenUri }: Props) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const detailMatch = /^\/playlists\/([^/]+)(?:\/items\/(?:new|[^/]+\/edit))?\/?$/.exec(pathname);
  const detailKey = detailMatch && detailMatch[1] !== "new" ? detailMatch[1] : null;
  return detailKey ? <PlaylistDetail playlistKey={detailKey} onOpenUri={onOpenUri} /> : <PlaylistList />;
}

/**
 * The user's playlists and their items. `items` leaves out entities the site served here doesn't
 * show (their type, app, roles or aspects, gondol's siteShowsType); `allItems` keeps them, for
 * reordering around them.
 */
function usePlaylistData() {
  const siteShows = useSiteShows();
  const playlists = useQuery(playlistsQueryOptions).data ?? [];
  const allItems = useQuery(playlistItemsQueryOptions).data ?? [];
  return { playlists, items: allItems.filter((i) => siteShows.uri(i.uri)), allItems };
}

function useGo() {
  const navigate = useNavigate();
  return (to: string) => navigate({ to, search: (prev: DateRangeSearch) => prev } as Parameters<typeof navigate>[0]);
}

/** Opens a playlist item: entities through the entity resolver, links in a new tab. */
function openItemUri(uri: string, onOpenUri: (uri: string) => void) {
  if (isWebLink(uri)) window.open(uri, "_blank", "noopener,noreferrer");
  else onOpenUri(uri);
}

function PlaylistList() {
  const { t } = useI18n();
  const go = useGo();
  const modal = useEntityModal("/playlists");
  const { playlists, items } = usePlaylistData();
  const deletePlaylist = useDeletePlaylist(modal.close);
  const editing = modal.mode === "edit" ? findByEntityKey(playlists, modal.id) : undefined;

  return (
    <>
      <Card>
        <div className="stack">
          <div className="panel-head">
            <div className="panel-title">{t("playlists.title")}</div>
            <Button size="sm" tone="primary" onClick={modal.openNew}>
              {t("playlists.add")}
            </Button>
          </div>
          <p className="stat-label">{t("playlists.intro")}</p>
          {playlists.length === 0 ? (
            <EmptyState items={t("playlists.plural")} actionLabel={t("playlists.add")} onAction={modal.openNew} />
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("playlists.name")}</th>
                    <th className="num">{t("playlists.itemCount")}</th>
                    <th>{t("playlists.description")}</th>
                    <th className="action-row-cell" aria-label={t("actions.label")} />
                  </tr>
                </thead>
                <tbody>
                  {playlists.map((p) => (
                    <PlaylistRow
                      key={p.id}
                      playlist={p}
                      count={items.filter((i) => i.playlist_id === p.id).length}
                      onOpen={() => go(`/playlists/${entityKey(p)}`)}
                      onEdit={() => modal.openEdit(entityKey(p))}
                      onDelete={() => {
                        if (window.confirm(t("playlists.confirmDelete", { name: p.name }))) deletePlaylist.mutate(p.id);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {modal.mode !== "closed" && (modal.mode === "new" || editing) ? (
        <PlaylistSheet
          playlist={editing}
          itemCount={editing ? items.filter((i) => i.playlist_id === editing.id).length : 0}
          onClose={modal.close}
          onDelete={
            editing
              ? () => {
                  if (window.confirm(t("playlists.confirmDelete", { name: editing.name }))) deletePlaylist.mutate(editing.id);
                }
              : undefined
          }
          deleting={deletePlaylist.isPending}
        />
      ) : null}
    </>
  );
}

function PlaylistRow({
  playlist,
  count,
  onOpen,
  onEdit,
  onDelete,
}: {
  playlist: Playlist;
  count: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const add = useAddToPlaylist();
  // Dropping any entity on a playlist's row appends it to that playlist.
  const drop = useEntityDropTarget((d) => {
    if (d.uri === toEntityUri("playlist", playlist.id)) return;
    add.mutate({ playlistId: playlist.id, uri: d.uri }, { onSuccess: () => showToast(t("playlists.added", { name: playlist.name })) });
  });
  return (
    <tr className={drop.over ? "action-row clickable-row drop-row--over" : "action-row clickable-row"} onClick={onOpen} {...drop.props}>
      <td className="wrap">{playlist.name}</td>
      <td className="num">{count}</td>
      <td className="wrap">{playlist.description ?? "—"}</td>
      <td className="action-row-cell" onClick={(e) => e.stopPropagation()}>
        <ActionMenu
          name={playlist.name}
          uri={toEntityUri("playlist", playlist.id)}
          actions={[
            { key: "open", label: t("actions.open"), onSelect: onOpen },
            { key: "edit", label: t("actions.edit"), onSelect: onEdit },
            { key: "delete", label: t("actions.delete"), tone: "danger", onSelect: onDelete },
          ]}
        />
      </td>
    </tr>
  );
}

function useDeletePlaylist(onDone: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("playlists").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      onDone();
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlist_items"] });
    },
  });
}

/** The banner at the top of a playlist (and of its sheet's preview): header image, image, texts. */
function PlaylistHero({
  title,
  description,
  count,
  covers,
  uri,
  badge,
  actions,
}: {
  title: string;
  description: string | null;
  count: number;
  covers: { header: string | null; image: string | null };
  uri?: string;
  badge?: string;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className={covers.header ? "playlist-hero playlist-hero--header" : "playlist-hero"}>
      {covers.header ? (
        <div className="playlist-hero__header" aria-hidden="true">
          <img src={covers.header} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </div>
      ) : null}
      <div className="playlist-hero__body">
        {covers.image ? (
          <span className="search-art search-art--lg search-art--cover playlist-hero__art" aria-hidden="true">
            <img src={covers.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
          </span>
        ) : (
          <span className="playlist-hero__art">
            <EntityArt type="playlist" title={title || "?"} size="lg" uri={uri} />
          </span>
        )}
        <div className="playlist-hero__text">
          <span className="playlist-hero__kind">
            {t("entity.playlist")}
            {badge ? <span className="search-badge">{badge}</span> : null}
          </span>
          <h2 className="playlist-hero__title">{title || t("form.namePlaceholder")}</h2>
          {description ? <p className="playlist-hero__description">{description}</p> : null}
          <span className="playlist-hero__meta">{t("playlists.itemCountValue", { count })}</span>
        </div>
        {actions ? <div className="playlist-hero__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

const coverSrc = (covers: EntityCovers) => ({
  header: covers.header_image?.src ?? null,
  image: covers.square_cover_image?.src ?? null,
});

function PlaylistSheet({
  playlist,
  itemCount,
  onClose,
  onDelete,
  deleting,
}: {
  playlist?: Playlist;
  itemCount: number;
  onClose: () => void;
  onDelete?: () => void;
  deleting: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const covers = usePlaylistCovers(playlist, true);
  const media = mediaHost();
  const { CoverFrame, ImagePicker } = media;
  const images = media.useImages().data ?? [];
  const setCovers = media.useSetEntityCovers();
  const [edited, setEdited] = useState<Partial<PlaylistDraft>>({});
  const [openSlot, setOpenSlot] = useState<ImageSlot | null>(null);
  // Covers load asynchronously, so untouched image slots read through to them.
  const draft: PlaylistDraft = {
    name: playlist?.name ?? "",
    description: playlist?.description ?? "",
    is_public: playlist?.is_public ?? false,
    header_image: covers.header_image?.mediaId ?? null,
    square_cover_image: covers.square_cover_image?.mediaId ?? null,
    ...edited,
  };
  const set = <K extends keyof PlaylistDraft>(key: K, value: PlaylistDraft[K]) => setEdited((e) => ({ ...e, [key]: value }));

  const srcFor = (slot: ImageSlot) => {
    const id = draft[slot];
    if (!id) return null;
    return images.find((m) => m.id === id)?.src ?? covers[slot]?.src ?? null;
  };

  const save = useMutation({
    mutationFn: async (d: PlaylistDraft) => {
      const payload = { name: d.name.trim(), description: d.description.trim() || null, is_public: d.is_public };
      let id = playlist?.id;
      if (id) {
        const { error } = await supabase.from("playlists").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error("Not signed in");
        const { data, error } = await supabase.from("playlists").insert({ user_id: userData.user.id, ...payload }).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      const changedImages = "header_image" in edited || "square_cover_image" in edited;
      if (id && changedImages) {
        await setCovers.mutateAsync({
          uri: toEntityUri("playlist", id),
          covers: { header_image: d.header_image, square_cover_image: d.square_cover_image },
        });
      }
    },
    onSuccess: () => {
      onClose();
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlist-covers"] });
    },
  });

  const imageSlots: { slot: ImageSlot; label: string }[] = [
    { slot: "header_image", label: t("playlists.headerImage") },
    { slot: "square_cover_image", label: t("playlists.image") },
  ];

  return (
    <EntitySheet
      title={playlist ? playlist.name : t("playlists.add")}
      uri={playlist ? toEntityUri("playlist", playlist.id) : undefined}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(draft);
      }}
      footer={
        <FormActions
          onDelete={onDelete}
          deleteLabel={t("playlists.delete")}
          deleting={deleting}
          onCancel={playlist ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={playlist ? t("form.save") : t("playlists.create")}
          saving={save.isPending}
          submitDisabled={!draft.name.trim()}
        />
      }
      preview={
        <div className="entity-preview">
          <PlaylistHero
            title={draft.name}
            description={draft.description.trim() || null}
            count={itemCount}
            covers={{ header: srcFor("header_image"), image: srcFor("square_cover_image") }}
            uri={playlist ? toEntityUri("playlist", playlist.id) : undefined}
          />
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("visibility.label")}</dt>
              <dd>{draft.is_public ? t("visibility.public") : t("visibility.private")}</dd>
            </div>
          </dl>
        </div>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Input label={t("playlists.name")} required value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="bungalow-field">
          <label className="bungalow-label" htmlFor="playlist-description">
            {t("playlists.description")}
          </label>
          <textarea
            id="playlist-description"
            className="bungalow-input form-textarea"
            rows={3}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        {/* Images come from the host's media library; without one there is nothing to pick. */}
        {ImagePicker ? imageSlots.map(({ slot, label }) => {
          const id = draft[slot];
          const name = images.find((m) => m.id === id)?.name ?? covers[slot]?.name;
          return (
            <div key={slot} className="cover-slot">
              <div className="cover-slot__head">
                {CoverFrame ? <CoverFrame slot={slot} src={srcFor(slot)} label={label} small /> : null}
                <div className="cover-slot__text">
                  <span className="choice-list__label">{label}</span>
                  <span className="choice-list__hint">{id ? name : t("covers.none")}</span>
                </div>
                <div className="cover-slot__actions">
                  {id ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => set(slot, null)}>
                      {t("covers.clear")}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" aria-expanded={openSlot === slot} onClick={() => setOpenSlot(openSlot === slot ? null : slot)}>
                    {t("covers.choose")}
                  </Button>
                </div>
              </div>
              {openSlot === slot ? (
                <ImagePicker
                  value={id}
                  onChange={(mediaId) => {
                    set(slot, mediaId);
                    setOpenSlot(null);
                  }}
                />
              ) : null}
            </div>
          );
        }) : null}
        <label className="bungalow-check">
          <input type="checkbox" checked={draft.is_public} onChange={(e) => set("is_public", e.target.checked)} />
          <span>{t("visibility.makePublic")}</span>
        </label>
        <p className="stat-label">{t("visibility.hint")}</p>
        {save.error ? <p className="bungalow-help bungalow-help--error">{save.error.message}</p> : null}
      </div>
    </EntitySheet>
  );
}

/** Where keyboard shortcuts and clipboard events belong to a playlist's view. */
interface PlaylistKeys {
  key: (event: KeyboardEvent) => void;
  clipboard: (event: ClipboardEvent) => void;
  active: () => boolean;
}

/** Whether the user has selected text on the page (then copying is the browser's). */
function hasTextSelection() {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim().length > 0;
}

/** "2026-10-29" as a local date (not midnight UTC). */
function localDate(on: string): Date {
  const [y, m, d] = on.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
}

interface Selection {
  ids: string[];
  /** Where a Shift range starts. */
  anchor: string | null;
  /** The row the arrow keys move from. */
  cursor: string | null;
}

const NO_SELECTION: Selection = { ids: [], anchor: null, cursor: null };

function PlaylistDetail({ playlistKey, onOpenUri }: { playlistKey: string; onOpenUri: (uri: string) => void }) {
  const { t, intlLocale } = useI18n();
  const go = useGo();
  const itemModal = useEntityModal(`/playlists/${playlistKey}/items`, `/playlists/${playlistKey}`);
  const siteShows = useSiteShows();
  const { playlists, items: shownItems, allItems } = usePlaylistData();
  const own = findByEntityKey(playlists, playlistKey);
  // Not one of ours: it may be another user's public playlist (reached through search), which is
  // shown read-only.
  const shared = useQuery({ ...playlistByKeyQueryOptions(playlistKey), enabled: playlists.length === 0 || !own });
  const playlist = own ?? shared.data?.playlist ?? undefined;
  const playlistId = playlist?.id ?? "";
  const readOnly = !own;
  const covers = usePlaylistCovers(playlist, !readOnly);
  // Every item, and the ones shown here: entities the site leaves out aren't listed at all.
  const fullItems = own ? allItems.filter((i) => i.playlist_id === playlistId) : (shared.data?.items ?? []);
  const items = own ? shownItems.filter((i) => i.playlist_id === playlistId) : fullItems.filter((i) => siteShows.uri(i.uri));
  const { data: labels } = useEntityLabels(items.map((i) => i.uri).filter(isEntityUri));
  const history = usePlaylistHistory(playlistId, { onError: (error) => showToast(errorText(error)) });
  const saveLink = playlistsHost().useSaveLink();
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [pasting, setPasting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const editing = itemModal.mode === "edit" ? findByEntityKey(items, itemModal.id) : undefined;
  const dateFormat = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" });
  const selected = new Set(selection.ids);

  // Pastes and other async work finish after a render or two; they read the list as it is then.
  const latest = useRef({ items, fullItems, allItems, selection });
  latest.current = { items, fullItems, allItems, selection };

  /**
   * Makes `nextShown` the order of the items shown here, as one undoable step. Items the site
   * hides keep their places; the shown ones fill the other places in their new order.
   */
  function commit(nextShown: PlaylistItem[], label: string) {
    if (readOnly) return;
    const { items: shownNow, fullItems: allNow } = latest.current;
    const target = placeShown(allNow, shownNow, nextShown);
    history.apply(target, label).catch(() => {});
  }

  function freshItem(uri: string, title: string | null = null): PlaylistItem {
    return { id: crypto.randomUUID(), playlist_id: playlistId, uri, title, position: 0, added_at: new Date().toISOString(), custom_added_on: null };
  }

  /** Puts `added` in at `at` (an index among the shown items) and selects them. */
  function insertItems(added: PlaylistItem[], at: number, label: string) {
    const ownUri = toEntityUri("playlist", playlistId);
    const fresh = added.filter((i) => i.uri !== ownUri);
    if (fresh.length === 0) return;
    const next = [...latest.current.items];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, ...fresh);
    commit(next, label);
    select(fresh.map((i) => i.id), fresh[0].id, fresh[fresh.length - 1].id);
  }

  /** Adds entities (entity URIs, by slug or identifier too) and web links at `at`. */
  async function insertUris(entries: { uri: string; title?: string }[], at: number, label: string) {
    const fresh = await Promise.all(
      entries.map(async ({ uri, title }) => freshItem(isEntityUri(uri) ? await canonicalEntityUri(uri) : normalizePlaylistItemUri(uri), title?.trim() || null)),
    );
    insertItems(fresh, at, label);
  }

  function select(ids: string[], anchor: string | null = ids[0] ?? null, cursor: string | null = ids[ids.length - 1] ?? null) {
    setSelection({ ids, anchor, cursor });
  }

  function focusRow(id: string) {
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
      row?.focus();
    });
  }

  /** The selected items in list order (or the row under the cursor when nothing is selected). */
  function chosenItems(): PlaylistItem[] {
    const { items: now, selection: sel } = latest.current;
    const ids = new Set(sel.ids.length > 0 ? sel.ids : sel.cursor ? [sel.cursor] : []);
    return now.filter((i) => ids.has(i.id));
  }

  /** The items a row's menu acts on: the selection when the row is in it, else the row alone. */
  function itemsFor(item: PlaylistItem): PlaylistItem[] {
    return selected.has(item.id) ? items.filter((i) => selected.has(i.id)) : [item];
  }

  /** Where a paste goes: after the last selected row, else after the cursor, else at the end. */
  function insertionIndex(): number {
    const { items: now, selection: sel } = latest.current;
    const indexes = (sel.ids.length > 0 ? sel.ids : sel.cursor ? [sel.cursor] : []).map((id) => now.findIndex((i) => i.id === id)).filter((i) => i >= 0);
    return indexes.length > 0 ? Math.max(...indexes) + 1 : now.length;
  }

  function goTo(index: number, extend: boolean) {
    const item = items[index];
    if (!item) return;
    if (extend && selection.anchor) {
      const from = items.findIndex((i) => i.id === selection.anchor);
      const [lo, hi] = from < 0 ? [index, index] : [Math.min(from, index), Math.max(from, index)];
      setSelection({ ids: items.slice(lo, hi + 1).map((i) => i.id), anchor: selection.anchor, cursor: item.id });
    } else {
      select([item.id]);
    }
    focusRow(item.id);
  }

  function moveCursor(direction: 1 | -1, extend: boolean) {
    const at = items.findIndex((i) => i.id === selection.cursor);
    goTo(at < 0 ? (direction > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, at + direction)), extend);
  }

  function remove(chosen: PlaylistItem[]) {
    if (readOnly || chosen.length === 0) return;
    const ids = new Set(chosen.map((i) => i.id));
    const last = Math.max(...chosen.map((c) => items.findIndex((i) => i.id === c.id)));
    const after = items.slice(last + 1).find((i) => !ids.has(i.id)) ?? [...items].reverse().find((i) => !ids.has(i.id));
    commit(
      items.filter((i) => !ids.has(i.id)),
      t("playlists.historyRemove"),
    );
    if (after) {
      select([after.id]);
      focusRow(after.id);
    } else select([]);
  }

  /** Moves the selected rows one place up or down, as a block where they touch. */
  function moveSelected(direction: 1 | -1) {
    const chosen = new Set(chosenItems().map((i) => i.id));
    if (readOnly || chosen.size === 0) return;
    const next = moveBlock(items, chosen, direction);
    if (next.every((item, i) => item.id === items[i].id)) return;
    commit(next, t("playlists.historyMove"));
    if (selection.cursor) focusRow(selection.cursor);
  }

  function move(from: number, to: number) {
    if (readOnly || from === to || from < 0 || to < 0 || to > items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, moved);
    commit(next, t("playlists.historyMove"));
  }

  /** Copies (or cuts) items: their URIs on the system clipboard, one per line. */
  function copyItems(chosen: PlaylistItem[], cut: boolean, event?: ClipboardEvent) {
    if (chosen.length === 0 || (cut && readOnly)) return;
    const text = rememberCopied(chosen, cut ? playlistId : null);
    const message = t(cut ? "playlists.cutCount" : "playlists.copiedCount", { count: chosen.length });
    if (event?.clipboardData) {
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
      const links = chosen.map((i) => i.uri).filter(isWebLink);
      if (links.length > 0) event.clipboardData.setData("text/uri-list", links.join("\r\n"));
      showToast(message);
    } else {
      copyText(text, message, t("playlists.copyFailed"));
    }
    if (cut) remove(chosen);
  }

  /**
   * Pastes clipboard text after the selection: items copied from a playlist come back as they were
   * (a cut keeps its added dates, and its ids within the same playlist); otherwise every entity URI
   * or app address is added, and every web link is saved as a bookmark first where the host keeps
   * bookmarks (else added as a link).
   */
  async function paste(text: string) {
    if (readOnly || !text.trim()) return;
    const at = insertionIndex();
    const label = t("playlists.historyPaste");
    const recalled = recallCopied(text);
    if (recalled) {
      const taken = new Set(latest.current.allItems.map((i) => i.id));
      const moved = !!recalled.cutFrom;
      insertItems(
        recalled.items.map((i) =>
          moved && recalled.cutFrom === playlistId && !taken.has(i.id)
            ? { ...i }
            : { ...freshItem(i.uri, i.title), ...(moved ? { added_at: i.added_at, custom_added_on: i.custom_added_on } : {}) },
        ),
        at,
        label,
      );
      return;
    }
    setPasting(true);
    try {
      const uris = (await Promise.all(pastedTokens(text).map(resolvePasted))).filter((u): u is string => !!u);
      if (uris.length === 0) {
        showToast(t("playlists.pasteNothing"));
        return;
      }
      await insertUris(
        uris.map((uri) => ({ uri })),
        at,
        label,
      );
    } finally {
      setPasting(false);
    }
  }

  async function resolvePasted(token: string): Promise<string | null> {
    const ref = entityRefFromText(token);
    if (ref) return canonicalEntityUri(toEntityUri(ref.entityType, ref.entityId));
    if (!isWebLink(token) || !isPlaylistItemUri(token)) return null;
    if (!saveLink) return token;
    try {
      return await saveLink(token);
    } catch {
      return token;
    }
  }

  /** "Paste" in a row's menu: the system clipboard, where the browser lets the page read it. */
  async function pasteFromMenu(after: PlaylistItem) {
    select([after.id]);
    latest.current = { ...latest.current, selection: { ids: [after.id], anchor: after.id, cursor: after.id } };
    try {
      const text = await navigator.clipboard.readText();
      await paste(text);
    } catch {
      showToast(t("playlists.pasteBlocked", { keys: formatShortcut("Mod+V") }));
    }
  }

  async function travel(direction: "undo" | "redo") {
    const label = await (direction === "undo" ? history.undo() : history.redo()).catch(() => null);
    if (label) showToast(t(direction === "undo" ? "playlists.undone" : "playlists.redone", { action: label }));
  }

  function openItem(item: PlaylistItem) {
    openItemUri(item.uri, onOpenUri);
  }

  // Keyboard shortcuts and the clipboard, while focus is on the playlist (or nowhere in particular).
  const keys = useRef<PlaylistKeys | null>(null);
  keys.current = {
    active: () => !!playlist && itemModal.mode === "closed" && !pasting,
    key: (event) => {
      const mod = isMac() ? event.metaKey : event.ctrlKey;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handled = () => event.preventDefault();
      if (mod && !event.altKey && (key === "z" || (key === "y" && !event.shiftKey))) {
        if (readOnly) return;
        handled();
        void travel(key === "y" || event.shiftKey ? "redo" : "undo");
      } else if (mod && !event.altKey && !event.shiftKey && key === "a") {
        if (items.length === 0) return;
        handled();
        select(
          items.map((i) => i.id),
          items[0].id,
          selection.cursor ?? items[0].id,
        );
      } else if (key === "ArrowUp" || key === "ArrowDown") {
        const direction = key === "ArrowUp" ? -1 : 1;
        if (event.altKey || (mod && event.shiftKey)) {
          if (readOnly) return;
          handled();
          moveSelected(direction);
        } else if (!mod) {
          handled();
          moveCursor(direction, event.shiftKey);
        }
      } else if ((key === "Home" || key === "End") && !mod && !event.altKey && items.length > 0) {
        handled();
        goTo(key === "Home" ? 0 : items.length - 1, event.shiftKey);
      } else if (key === "Escape" && selection.ids.length > 0) {
        handled();
        select([], null, selection.cursor);
      } else if ((key === "Delete" || key === "Backspace") && !event.altKey && !event.shiftKey) {
        if (readOnly) return;
        const chosen = chosenItems();
        if (chosen.length === 0) return;
        handled();
        remove(chosen);
      } else if (key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        const item = items.find((i) => i.id === selection.cursor);
        if (!item) return;
        handled();
        openItem(item);
      }
    },
    clipboard: (event) => {
      if (event.type === "paste") {
        if (readOnly) return;
        const text = event.clipboardData?.getData("text/plain") || event.clipboardData?.getData("text/uri-list") || "";
        if (!text.trim()) return;
        event.preventDefault();
        void paste(text);
        return;
      }
      if (hasTextSelection()) return;
      const chosen = chosenItems();
      if (chosen.length === 0) return;
      copyItems(chosen, event.type === "cut", event);
    },
  };

  useEffect(() => {
    /** Events aimed at the playlist's view, or at the page itself (nothing focused). */
    const ours = (target: EventTarget | null) => {
      if (!keys.current?.active() || isEditableElement(target)) return false;
      const root = rootRef.current;
      return !!root && (target === document.body || (target instanceof Node && root.contains(target)));
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && ours(event.target)) keys.current?.key(event);
    };
    const onClipboard = (event: ClipboardEvent) => {
      if (ours(event.target)) keys.current?.clipboard(event);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
    };
  }, []);

  /** Index to insert at when dropping over row `index`: before it on its top half, else after. */
  function indexFromEvent(event: DragEvent<HTMLElement>, index: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  function onDragOverRow(event: DragEvent<HTMLElement>, index: number) {
    if (readOnly) return;
    const types = event.dataTransfer.types;
    if (!types.includes(PLAYLIST_ITEM_MIME) && !types.includes("application/x-entity") && !types.includes("text/plain") && !types.includes("text/uri-list"))
      return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = types.includes(PLAYLIST_ITEM_MIME) ? "move" : "copy";
    setDropIndex(indexFromEvent(event, index));
  }

  function onDropAt(event: DragEvent<HTMLElement>, at: number) {
    setDropIndex(null);
    if (readOnly) return;
    const movedId = event.dataTransfer.getData(PLAYLIST_ITEM_MIME);
    if (movedId) {
      event.preventDefault();
      event.stopPropagation();
      move(
        items.findIndex((i) => i.id === movedId),
        at,
      );
      return;
    }
    const data = readEntityDrop(event);
    // Links dragged in from a browser tab or another app come as a URI list / plain text.
    const link = data ? null : droppedLink(event);
    if (!data && !link) return;
    event.preventDefault();
    event.stopPropagation();
    if (data?.uri === toEntityUri("playlist", playlistId)) return;
    void insertUris([{ uri: data?.uri ?? link! }], at, t("playlists.historyAdd"));
  }

  /** Clicks with Ctrl/⌘ toggle a row, with Shift select a range, and on the number select only. */
  function onRowClick(event: MouseEvent<HTMLLIElement>, item: PlaylistItem, index: number) {
    const target = event.target as HTMLElement;
    const toggle = event.metaKey || event.ctrlKey;
    if (event.shiftKey || toggle || target.closest(".entity-row__number")) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) goTo(index, true);
      else if (toggle) {
        const ids = selected.has(item.id) ? selection.ids.filter((id) => id !== item.id) : [...selection.ids, item.id];
        setSelection({ ids, anchor: item.id, cursor: item.id });
      } else select([item.id]);
      focusRow(item.id);
      return;
    }
    if (!target.closest(".action-menu-trigger, .action-row__like")) select([item.id]);
  }

  if (!playlist) {
    return (
      <Card>
        <p className="stat-label">{shared.isPending ? t("app.loading") : t("playlists.notFound")}</p>
      </Card>
    );
  }

  const undoTitle = history.undoLabel ? t("playlists.undoAction", { action: history.undoLabel }) : t("playlists.undo");
  const redoTitle = history.redoLabel ? t("playlists.redoAction", { action: history.redoLabel }) : t("playlists.redo");

  return (
    <>
      <Card>
        <div className="stack" ref={rootRef}>
          <button type="button" className="link-button playlist-back" onClick={() => go("/playlists")}>
            ‹ {t("playlists.title")}
          </button>
          <PlaylistHero
            title={playlist.name}
            description={playlist.description}
            count={items.length}
            covers={coverSrc(covers)}
            uri={readOnly ? undefined : toEntityUri("playlist", playlist.id)}
            badge={readOnly ? t("visibility.public") : undefined}
            actions={
              readOnly ? null : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!history.canUndo}
                    onClick={() => void travel("undo")}
                    title={`${undoTitle} (${formatShortcut("Mod+Z")})`}
                    aria-label={undoTitle}
                  >
                    {t("playlists.undo")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!history.canRedo}
                    onClick={() => void travel("redo")}
                    title={`${redoTitle} (${formatShortcut("Mod+Shift+Z")})`}
                    aria-label={redoTitle}
                  >
                    {t("playlists.redo")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => go(`/playlists/${entityKey(playlist)}/edit`)}>
                    {t("actions.edit")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={itemModal.openNew}>
                    {t("playlists.addItem")}
                  </Button>
                </>
              )
            }
          />

          {items.length > 0 ? (
            <div className="playlist-columns" aria-hidden="true">
              <span className="playlist-columns__number">#</span>
              <span className="playlist-columns__title">{t("playlists.titleColumn")}</span>
              <span className="playlist-columns__added">{t("playlists.addedColumn")}</span>
            </div>
          ) : null}
          <ol
            ref={listRef}
            className={pasting ? "playlist-list playlist-list--busy" : "playlist-list"}
            aria-label={t("playlists.itemsLabel", { name: playlist.name })}
            aria-busy={pasting || undefined}
            onDragOver={(e) => onDragOverRow(e, items.length)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null);
            }}
            onDrop={(e) => onDropAt(e, dropIndex ?? items.length)}
          >
            {items.map((item, index) => {
              const uri = item.uri;
              const link = isWebLink(uri);
              const openable = link || resolveEntityUri(uri) !== null;
              const acting = itemsFor(item);
              const many = acting.length > 1;
              const actions: MenuAction[] = [
                ...(openable ? [{ key: "open", label: link ? t("playlists.openLink") : t("actions.open"), onSelect: () => openItem(item) }] : []),
                ...(link
                  ? [
                      {
                        key: "copy-link",
                        label: t("playlists.copyLink"),
                        onSelect: () => copyText(uri, t("playlists.linkCopied"), t("playlists.linkCopyFailed")),
                      },
                    ]
                  : []),
                {
                  key: "copy",
                  label: many ? t("playlists.copyItems", { count: acting.length }) : t("playlists.copyItem"),
                  onSelect: () => copyItems(acting, false),
                },
                ...(readOnly
                  ? []
                  : [
                      {
                        key: "cut",
                        label: many ? t("playlists.cutItems", { count: acting.length }) : t("playlists.cutItem"),
                        onSelect: () => copyItems(acting, true),
                      },
                      { key: "paste", label: t("playlists.pasteBelow"), onSelect: () => void pasteFromMenu(item) },
                      { key: "edit", label: t("playlists.editItem"), onSelect: () => itemModal.openEdit(entityKey(item)) },
                      { key: "up", label: t("playlists.moveUp"), disabled: index === 0, onSelect: () => move(index, index - 1) },
                      { key: "down", label: t("playlists.moveDown"), disabled: index === items.length - 1, onSelect: () => move(index, index + 2) },
                      {
                        key: "remove",
                        label: many ? t("playlists.removeItems", { count: acting.length }) : t("playlists.removeItem"),
                        tone: "danger" as const,
                        onSelect: () => remove(acting),
                      },
                    ]),
              ];
              const addedOn = playlistItemAddedOn(item);
              const added = dateFormat.format(localDate(addedOn));
              const common: ItemRowProps = {
                item,
                index,
                draggable: !readOnly,
                dropBefore: dropIndex === index,
                dropAfter: dropIndex === items.length && index === items.length - 1,
                selected: selected.has(item.id),
                cursor: selection.cursor === item.id,
                added: {
                  on: addedOn,
                  label: added,
                  custom: !!item.custom_added_on,
                  hint: item.custom_added_on
                    ? t("playlists.addedCustomHint", { date: dateFormat.format(new Date(item.added_at)) })
                    : t("playlists.addedHint", { date: added }),
                },
                onOpen: () => openItem(item),
                onDragOver: (e: DragEvent<HTMLLIElement>) => onDragOverRow(e, index),
                onDrop: (e: DragEvent<HTMLLIElement>) => onDropAt(e, indexFromEvent(e, index)),
                onClickCapture: (e: MouseEvent<HTMLLIElement>) => onRowClick(e, item, index),
                onFocus: () => {
                  if (selection.cursor !== item.id) setSelection((s) => ({ ...s, cursor: item.id, anchor: s.ids.length > 0 ? s.anchor : item.id }));
                },
                actions,
              };
              return link ? (
                <LinkItemRow key={item.id} {...common} />
              ) : (
                <EntityItemRow key={item.id} {...common} name={item.title ?? labelFor(labels, uri) ?? uri} openable={openable} />
              );
            })}
            {items.length === 0 ? <li className="playlist-list__empty">{t("playlists.itemsEmpty")}</li> : null}
          </ol>
          {readOnly ? null : (
            <p className="drop-zone__hint">
              {t("playlists.dropHint")} <span className="playlist-keys-hint">{t("playlists.keysHint", { copy: formatShortcut("Mod+C"), cut: formatShortcut("Mod+X"), paste: formatShortcut("Mod+V"), undo: formatShortcut("Mod+Z") })}</span>
            </p>
          )}
        </div>
      </Card>

      {itemModal.mode === "new" && !readOnly ? (
        <AddItemSheet
          playlist={playlist}
          onClose={itemModal.close}
          saving={false}
          onAdd={(entries) => {
            void insertUris(entries, items.length, t("playlists.historyAdd")).then(itemModal.close);
          }}
        />
      ) : null}
      {editing && !readOnly ? (
        <PlaylistItemSheet
          item={editing}
          playlist={playlist}
          name={isWebLink(editing.uri) ? editing.uri : (labelFor(labels, editing.uri) ?? editing.uri)}
          formatDate={(on) => dateFormat.format(localDate(on))}
          onClose={itemModal.close}
          onSave={(patch) => {
            commit(
              items.map((i) => (i.id === editing.id ? { ...i, ...patch } : i)),
              t("playlists.historyEdit"),
            );
            itemModal.close();
          }}
          onRemove={() => {
            remove([editing]);
            itemModal.close();
          }}
        />
      ) : null}
    </>
  );
}

/** A web link dropped from outside the app (a browser tab, another app), if any. */
function droppedLink(event: DragEvent<HTMLElement>): string | null {
  const candidates = [
    ...event.dataTransfer
      .getData("text/uri-list")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#")),
    event.dataTransfer.getData("text/plain"),
  ].map((s) => s.trim());
  return candidates.find((s) => isWebLink(s)) ?? null;
}

interface ItemRowProps {
  item: PlaylistItem;
  index: number;
  draggable: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  selected: boolean;
  cursor: boolean;
  /** When it was added (`on`, YYYY-MM-DD), as shown, and whether that's the user's own date. */
  added: { on: string; label: string; custom: boolean; hint: string };
  onOpen: () => void;
  onDragOver: (e: DragEvent<HTMLLIElement>) => void;
  onDrop: (e: DragEvent<HTMLLIElement>) => void;
  onClickCapture: (e: MouseEvent<HTMLLIElement>) => void;
  onFocus: () => void;
  actions: MenuAction[];
}

/** What every item row shares: its classes, focus and selection state, and the date added. */
function rowProps({ item, dropBefore, dropAfter, selected, cursor, added, onDragOver, onDrop, onClickCapture, onFocus }: ItemRowProps) {
  const className = [
    "playlist-row",
    dropBefore ? "playlist-row--drop-before" : "",
    dropAfter ? "playlist-row--drop-after" : "",
    selected ? "playlist-row--selected" : "",
    cursor ? "playlist-row--cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    className,
    "data-item-id": item.id,
    "data-selected": selected ? "true" : undefined,
    tabIndex: -1,
    onDragOver,
    onDrop,
    onClickCapture,
    onFocus,
    aside: (
      <time dateTime={added.on} className={added.custom ? "playlist-row__added playlist-row__added--custom" : "playlist-row__added"} title={added.hint}>
        {added.label}
      </time>
    ),
  };
}

/** The row's type line, with the date added on phones (where the date column is hidden). */
function rowMeta(kind: ReactNode, added: ItemRowProps["added"]) {
  return (
    <>
      {kind}
      <span className="playlist-row__added-meta" title={added.hint}>
        · {added.label}
      </span>
    </>
  );
}

function EntityItemRow(props: ItemRowProps & { name: string; openable: boolean }) {
  const { item, index, onOpen, actions, name, openable, added } = props;
  const { t } = useI18n();
  return (
    <EntityRow
      {...rowProps(props)}
      // The row is also draggable as an entity (see ActionMenu); this adds the reorder payload.
      onDragStart={(e) => {
        e.dataTransfer.setData(PLAYLIST_ITEM_MIME, item.id);
      }}
      number={index + 1}
      name={name}
      meta={rowMeta(entityTypeLabel(t, item.uri), added)}
      uri={item.uri}
      openable={openable}
      onOpen={onOpen}
      actions={actions}
    />
  );
}

/** A web link in a playlist: its own title, else the page's Open Graph title, else the URL. */
function LinkItemRow(props: ItemRowProps) {
  const { item, index, draggable, onOpen, actions, added } = props;
  const { t } = useI18n();
  const preview = useLinkPreview(item.uri).data;
  const host = hostOf(item.uri);
  const name = item.title ?? (preview?.ok ? preview.title : null) ?? item.uri;
  // The page's Open Graph image, else its icon.
  const image = preview?.ok ? (preview.image_url ?? preview.icon_url ?? null) : (preview?.icon_url ?? null);
  return (
    <EntityRow
      {...rowProps(props)}
      // Links have no entity URI, so ActionMenu doesn't make them draggable; reordering still works.
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(PLAYLIST_ITEM_MIME, item.id);
        e.dataTransfer.setData("text/uri-list", item.uri);
        e.dataTransfer.setData("text/plain", item.uri);
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      number={index + 1}
      name={name}
      meta={rowMeta(host ? `${t("playlists.link")} · ${host}` : t("playlists.link"), added)}
      hint={item.uri}
      art={
        image ? (
          <span className="search-art search-art--sm search-art--cover" aria-hidden="true">
            <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />
          </span>
        ) : (
          <span className="search-art search-art--sm" style={{ "--tile-hue": 200 } as CSSProperties} aria-hidden="true">
            <Icon name="forward" />
          </span>
        )
      }
      onOpen={onOpen}
      actions={actions}
    />
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function AddItemSheet({
  playlist,
  onClose,
  onAdd,
  saving,
  error,
}: {
  playlist: Playlist;
  onClose: () => void;
  onAdd: (items: { uri: string; title: string }[]) => void;
  saving: boolean;
  error?: string;
}) {
  const { t } = useI18n();
  const suggested = useLibraryPickerOptions();
  const [uris, setUris] = useState<string[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [title, setTitle] = useState("");
  const link = linkInput.trim();
  const linkValid = !!link && isWebLink(link) && isPlaylistItemUri(link);
  const all = [...uris, ...(linkValid ? [link] : [])];
  // A custom title only makes sense for a single item.
  const single = all.length === 1 ? all[0] : null;
  const { data: labels } = useEntityLabels(uris);
  const drop = useEntityDropTarget((d) => {
    if (isWebLink(d.uri)) setLinkInput(d.uri);
  });
  const preview = useLinkPreview(linkValid ? link : null).data;
  const singleIsLink = !!single && isWebLink(single);
  const previewTitle = single ? (singleIsLink ? (preview?.ok ? preview.title : null) : labelFor(labels, single)) : null;
  const first = all[0];

  return (
    <EntitySheet
      title={t("playlists.addItem")}
      subtitle={playlist.name}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (all.length > 0) onAdd(all.map((uri) => ({ uri, title: uri === single ? title : "" })));
      }}
      footer={
        <FormActions onCancel={onClose} cancelLabel={t("form.cancel")} submitLabel={t("playlists.addSubmit")} saving={saving} submitDisabled={all.length === 0 || (!!link && !linkValid)} />
      }
      preview={
        <div className="entity-preview">
          <div>
            <div className="entity-preview__kind">{first ? (isWebLink(first) ? t("playlists.link") : entityTypeLabel(t, first)) : t("entity.playlist")}</div>
            <div className="entity-preview__label">
              {single ? title.trim() || previewTitle || single : first ? `${labelFor(labels, first) ?? first} +${all.length - 1}` : t("playlists.pickHint")}
            </div>
          </div>
          {singleIsLink && preview?.ok && preview.image_url ? (
            <div className="cover-preview">
              <span className="cover-frame" style={{ "--cover-aspect": 16 / 9 } as CSSProperties}>
                <img src={preview.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </span>
            </div>
          ) : null}
          <dl className="entity-preview__meta">
            {linkValid ? (
              <div>
                <dt>{t("playlists.link")}</dt>
                <dd>{hostOf(link)}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("entity.playlist")}</dt>
              <dd>{playlist.name}</dd>
            </div>
          </dl>
          {singleIsLink && preview?.ok && preview.description ? <p className="entity-preview__note">{preview.description}</p> : null}
        </div>
      }
    >
      <div className="stack">
        <EntityPicker
          label={t("playlists.items")}
          hint={t("playlists.itemsHint")}
          multiple
          suggested={suggested}
          suggestedLabel={t("library.title")}
          exclude={[toEntityUri("playlist", playlist.id)]}
          value={uris}
          onChange={setUris}
        />
        <div className={drop.over ? "drop-zone drop-zone--over" : "drop-zone"} {...drop.props}>
          <Input
            label={t("playlists.linkField")}
            type="url"
            placeholder="https://…"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
          />
        </div>
        {single ? (
          <Input
            label={t("playlists.itemTitle")}
            hint={t("playlists.itemTitleHint")}
            placeholder={previewTitle ?? undefined}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        ) : null}
        {error ? <p className="bungalow-help bungalow-help--error">{error}</p> : null}
      </div>
    </EntitySheet>
  );
}

/**
 * An item's sheet (/playlists/<playlist>/items/<item>/edit): its own title and the date it shows
 * as added. The real date added stays as it is; the custom date is shown instead while it's set.
 */
function PlaylistItemSheet({
  item,
  playlist,
  name,
  formatDate,
  onClose,
  onSave,
  onRemove,
}: {
  item: PlaylistItem;
  playlist: Playlist;
  /** What the item is called without a title of its own (the entity's name, the link). */
  name: string;
  formatDate: (on: string) => string;
  onClose: () => void;
  onSave: (patch: Pick<PlaylistItem, "title" | "custom_added_on">) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const link = isWebLink(item.uri);
  const preview = useLinkPreview(link && !item.title ? item.uri : null).data;
  const fallback = link ? ((preview?.ok ? preview.title : null) ?? item.uri) : name;
  const [title, setTitle] = useState(item.title ?? "");
  const [customOn, setCustomOn] = useState(item.custom_added_on ?? "");
  const addedOn = playlistItemAddedOn({ added_at: item.added_at, custom_added_on: null });
  const shownOn = customOn || addedOn;

  return (
    <EntitySheet
      title={t("playlists.editItem").replace(/…$/, "")}
      subtitle={playlist.name}
      uri={isEntityUri(item.uri) ? item.uri : undefined}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ title: title.trim() || null, custom_added_on: customOn || null });
      }}
      footer={
        <FormActions
          onDelete={onRemove}
          deleteLabel={t("playlists.removeItem")}
          onCancel={onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={t("form.save")}
        />
      }
      preview={
        <div className="entity-preview">
          <div>
            <div className="entity-preview__kind">{link ? t("playlists.link") : entityTypeLabel(t, item.uri)}</div>
            <div className="entity-preview__label">{title.trim() || fallback}</div>
          </div>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("playlists.addedColumn")}</dt>
              <dd>{formatDate(shownOn)}</dd>
            </div>
            {customOn ? (
              <div>
                <dt>{t("playlists.addedActual")}</dt>
                <dd>{formatDate(addedOn)}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("entity.playlist")}</dt>
              <dd>{playlist.name}</dd>
            </div>
          </dl>
        </div>
      }
    >
      <div className="stack">
        <Input label={t("playlists.itemTitle")} hint={t("playlists.itemTitleHint")} placeholder={fallback} value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="form-grid">
          <Input
            label={t("playlists.customAdded")}
            hint={t("playlists.customAddedHint", { date: formatDate(addedOn) })}
            type="date"
            value={customOn}
            onChange={(e) => setCustomOn(e.target.value)}
          />
        </div>
        {customOn ? (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCustomOn("")}>
              {t("playlists.customAddedClear")}
            </Button>
          </div>
        ) : null}
      </div>
    </EntitySheet>
  );
}
