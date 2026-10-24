import { useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
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
import { entityTypeLabel, labelFor, useEntityLabels } from "../../../../../../entities/lookup";
import { useI18n } from "../../../../../../i18n/i18n";
import { useLinkPreview } from "../../../../../../media/linkPreview";
import { EntityRow } from "../../../../../../entities/EntityRow";
import { useLibraryPickerOptions } from "../../../../../library/models/library";
import { mediaHost, type EntityCovers } from "../../../../../../media/host";
import {
  isPlaylistItemUri,
  isWebLink,
  playlistByKeyQueryOptions,
  playlistItemsQueryOptions,
  playlistsQueryOptions,
  useAddToPlaylist,
  usePlaylistCovers,
  useRenamePlaylistItem,
  useReorderPlaylist,
  type Playlist,
  type PlaylistItem,
} from "../../../../models/playlists";
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
  const detailMatch = /^\/playlists\/([^/]+)(?:\/items\/new)?\/?$/.exec(pathname);
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
function openItem(uri: string, onOpenUri: (uri: string) => void) {
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

function PlaylistDetail({ playlistKey, onOpenUri }: { playlistKey: string; onOpenUri: (uri: string) => void }) {
  const { t } = useI18n();
  const go = useGo();
  const queryClient = useQueryClient();
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
  const add = useAddToPlaylist();
  const rename = useRenamePlaylistItem();
  const reorder = useReorderPlaylist();
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("playlist_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["playlist_items"] }),
  });

  function move(from: number, to: number) {
    if (readOnly || from === to || to < 0 || to > items.length) return;
    const ids = items.map((i) => i.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to > from ? to - 1 : to, 0, moved);
    // Hidden items keep their places; the shown ones fill the other places in their new order.
    const shown = new Set(ids);
    let next = 0;
    reorder.mutate(fullItems.map((i) => (shown.has(i.id) ? ids[next++] : i.id)));
  }

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
    add.mutate({ playlistId, uri: data?.uri ?? link!, position: at });
  }

  if (!playlist) {
    return (
      <Card>
        <p className="stat-label">{shared.isPending ? t("app.loading") : t("playlists.notFound")}</p>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <div className="stack">
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

          <ol
            className="playlist-list"
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
              const actions: MenuAction[] = [
                ...(openable ? [{ key: "open", label: link ? t("playlists.openLink") : t("actions.open"), onSelect: () => openItem(uri, onOpenUri) }] : []),
                ...(link
                  ? [
                      {
                        key: "copy-link",
                        label: t("playlists.copyLink"),
                        onSelect: () => copyText(uri, t("playlists.linkCopied"), t("playlists.linkCopyFailed")),
                      },
                    ]
                  : []),
                ...(readOnly
                  ? []
                  : [
                      {
                        key: "rename",
                        label: t("playlists.renameItem"),
                        onSelect: () => {
                          const next = window.prompt(t("playlists.itemTitle"), item.title ?? "");
                          if (next !== null) rename.mutate({ id: item.id, title: next });
                        },
                      },
                      { key: "up", label: t("playlists.moveUp"), disabled: index === 0, onSelect: () => move(index, index - 1) },
                      { key: "down", label: t("playlists.moveDown"), disabled: index === items.length - 1, onSelect: () => move(index, index + 2) },
                      { key: "remove", label: t("playlists.removeItem"), tone: "danger" as const, onSelect: () => removeItem.mutate(item.id) },
                    ]),
              ];
              const common = {
                item,
                index,
                draggable: !readOnly,
                dropBefore: dropIndex === index,
                dropAfter: dropIndex === items.length && index === items.length - 1,
                onOpen: () => openItem(uri, onOpenUri),
                onDragOver: (e: DragEvent<HTMLLIElement>) => onDragOverRow(e, index),
                onDrop: (e: DragEvent<HTMLLIElement>) => onDropAt(e, indexFromEvent(e, index)),
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
          {readOnly ? null : <p className="drop-zone__hint">{t("playlists.dropHint")}</p>}
        </div>
      </Card>

      {itemModal.mode === "new" && !readOnly ? (
        <AddItemSheet
          playlist={playlist}
          onClose={itemModal.close}
          saving={add.isPending}
          error={add.error?.message}
          onAdd={(items) => {
            // One at a time, so each lands after the previous one.
            void (async () => {
              for (const item of items) await add.mutateAsync({ playlistId: playlist.id, ...item });
              itemModal.close();
            })().catch(() => {});
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
  onOpen: () => void;
  onDragOver: (e: DragEvent<HTMLLIElement>) => void;
  onDrop: (e: DragEvent<HTMLLIElement>) => void;
  actions: MenuAction[];
}

function rowClass(dropBefore: boolean, dropAfter: boolean) {
  return ["playlist-row", dropBefore ? "playlist-row--drop-before" : "", dropAfter ? "playlist-row--drop-after" : ""].filter(Boolean).join(" ");
}

function EntityItemRow({ item, index, dropBefore, dropAfter, onOpen, onDragOver, onDrop, actions, name, openable }: ItemRowProps & { name: string; openable: boolean }) {
  const { t } = useI18n();
  return (
    <EntityRow
      className={rowClass(dropBefore, dropAfter)}
      // The row is also draggable as an entity (see ActionMenu); this adds the reorder payload.
      onDragStart={(e) => {
        e.dataTransfer.setData(PLAYLIST_ITEM_MIME, item.id);
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      number={index + 1}
      name={name}
      meta={entityTypeLabel(t, item.uri)}
      uri={item.uri}
      openable={openable}
      onOpen={onOpen}
      actions={actions}
    />
  );
}

/** A web link in a playlist: its own title, else the page's Open Graph title, else the URL. */
function LinkItemRow({ item, index, draggable, dropBefore, dropAfter, onOpen, onDragOver, onDrop, actions }: ItemRowProps) {
  const { t } = useI18n();
  const preview = useLinkPreview(item.title ? null : item.uri).data;
  const host = hostOf(item.uri);
  const name = item.title ?? (preview?.ok ? preview.title : null) ?? item.uri;
  const image = preview?.ok ? preview.image_url : null;
  return (
    <EntityRow
      className={rowClass(dropBefore, dropAfter)}
      // Links have no entity URI, so ActionMenu doesn't make them draggable; reordering still works.
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(PLAYLIST_ITEM_MIME, item.id);
        e.dataTransfer.setData("text/uri-list", item.uri);
        e.dataTransfer.setData("text/plain", item.uri);
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      number={index + 1}
      name={name}
      meta={host ? `${t("playlists.link")} · ${host}` : t("playlists.link")}
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
