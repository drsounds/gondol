# Entity UI

Gondol's entity components give every list and form in an app the same behaviour: create and edit
happen in a sheet driven by the URL, every row's actions live in one menu, related entities are
picked with one picker, and rows can be dragged anywhere that accepts an entity.

## Create and edit sheets

Every create and edit view is a modal sheet on its own sub-route, never a form expanded inline in a
list. For a list at `/notes`:

| Path | Shows |
| --- | --- |
| `/notes` | The list. |
| `/notes/new` | The list with the create sheet over it. |
| `/notes/<key>/edit` | The list with the edit sheet for that row over it. |

So a sheet survives a reload, can be linked to, and closes with the back button.

### Route files

Add one route file per path, each rendering the shell (see [Features](./features.md#sub-pages-inside-a-feature)):

```
src/routes/notes.tsx              → /notes
src/routes/notes.new.tsx          → /notes/new
src/routes/notes.$noteId.edit.tsx → /notes/$noteId/edit
```

### `useEntityModal`

`useEntityModal(listPath, closePath?)` (`gondol/navigation/useEntityModal`) reads the sheet's state
from the URL and navigates to open and close it, keeping the global search params:

```tsx
import { EntitySheet } from "gondol/entities/EntitySheet";
import { FormActions } from "gondol/entities/FormActions";
import { entityKey, findByEntityKey } from "gondol/entities/slugs";
import { toEntityUri } from "gondol/entities/uri";
import { useEntityModal } from "gondol/navigation/useEntityModal";

function NotesPanel() {
  const { data: notes = [] } = useNotes();
  const modal = useEntityModal("/notes");
  const editing = modal.mode === "edit" ? findByEntityKey(notes, modal.id) : undefined;

  return (
    <>
      <button onClick={modal.openNew}>New note</button>
      {notes.map((note) => (
        <button key={note.id} onClick={() => modal.openEdit(entityKey(note))}>{note.title}</button>
      ))}
      {modal.mode !== "closed" ? (
        <NoteSheet note={editing} onClose={modal.close} />
      ) : null}
    </>
  );
}
```

| Returned | Meaning |
| --- | --- |
| `mode` | `"closed"`, `"new"` or `"edit"`. |
| `id` | With `mode: "edit"`: the key from the URL. Find the row with `findByEntityKey`, which also matches identifiers and old uuid links. |
| `openNew()`, `openEdit(key)` | Navigate to the sheet. Open with `entityKey(row)`. |
| `close()` | Navigate back to the list, or to `closePath`. |

`closePath` is for sheets nested under a page with no list of its own, such as
`useEntityModal("/notebooks/work/notes", "/notebooks/work")`. When an edit sheet is opened from
somewhere other than its list (a detail page), call `closeEditBackTo(editPath, backPath)` first so
closing returns there. `useNavigateKeepingSearch()` is a plain navigate that keeps the search params.

Transient dialogs that don't edit an entity (a multi-step import, a picker) can use `EntitySheet`
with local state instead of a route. If a user would reasonably want to reload into it, give it a
route.

### `EntitySheet` and `FormActions`

`EntitySheet` is the modal shell: a header with the title and an actions menu, a body with the form
on the left and an optional preview on the right on wide screens, and a footer.

```tsx
function NoteSheet({ note, onClose }: { note?: Note; onClose: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({ title: note?.title ?? "", body: note?.body ?? "" });
  const save = useSaveNote();
  const remove = useDeleteNote();

  return (
    <EntitySheet
      title={note ? note.title : t("notes.new")}
      uri={note ? toEntityUri("note", note.id) : undefined}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ id: note?.id, ...draft }, { onSuccess: onClose });
      }}
      footer={
        <FormActions
          onDelete={note ? () => remove.mutate(note.id, { onSuccess: onClose }) : undefined}
          deleteLabel={t("notes.delete")}
          deleting={remove.isPending}
          onCancel={note ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={note ? t("form.save") : t("notes.create")}
          saving={save.isPending}
          submitDisabled={!draft.title.trim()}
        />
      }
      preview={<div className="entity-preview">{draft.title || "Untitled"}</div>}
    >
      <Input label={t("notes.title")} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
    </EntitySheet>
  );
}
```

| `EntitySheet` prop | Meaning |
| --- | --- |
| `title`, `subtitle` | The header. |
| `onClose`, `closeLabel` | The close button and backdrop click. |
| `onSubmit` | Wraps the body and footer in a `<form>`, so the footer's submit button works. |
| `footer` | Usually `FormActions`. |
| `preview` | The right-hand panel, always in a fixed dark theme. |
| `uri` | The entity's URI: the header gets the entity's actions menu with "Copy URI" and the rest. |
| `actions` | Extra items for the header's menu. Save and delete stay in the footer. |

`FormActions` puts delete and cancel on the left and the primary submit on the right.

## Row actions: `ActionMenu`

Every row that has actions puts all of them in one `ActionMenu` (`gondol/entities/ActionMenu`):
a "⋯" button that opens a dropdown, and the same dropdown on right-click anywhere in the row.

```tsx
<tr className="action-row">
  <td>{note.title}</td>
  <td className="action-row-cell">
    <ActionMenu
      name={note.title}
      uri={toEntityUri("note", note.id)}
      actions={[
        { key: "edit", label: t("actions.edit"), onSelect: () => modal.openEdit(entityKey(note)) },
        { key: "delete", label: t("actions.delete"), tone: "danger", onSelect: () => confirmDelete(note) },
      ]}
    />
  </td>
</tr>
```

- Give the row element the `action-row` class. The trigger shows while the row is hovered or
  focused (always on touch screens).
- `name` is the entity's accessible name ("More actions for *name*").
- `MenuAction` is `{ key, label, onSelect, tone?: "danger", disabled? }`. Danger items are listed last.
- `row={false}` makes a standalone, always-visible trigger (as in a sheet header).

Passing `uri` adds, automatically:

- the app's entity-wide actions (see [below](#entity-wide-actions)),
- "Schedule soft deletion", "Cancel scheduled deletion" or "Restore" (see [Lifecycle](#lifecycle)),
- "Copy URI" and "Copy URL", which copy the slug form,

and makes the row draggable, hides it when the [global filter](./search-and-filters.md#the-global-filter)
excludes it, and dims it when it is soft-deleted or starts in the future.

## Entity-wide actions

`EntityActionsProvider` adds items to every `ActionMenu` and `EntitySheet` with a URI, so a list gets
them just by passing `uri`. Spacify adds "Save to library", "Pin", "Add to playlist…", "Tags…",
"Covers…" and "Change address…" this way.

```tsx
import { EntityActionsProvider } from "gondol/entities/extensions";
import { EntitySlugSheet } from "gondol/entities/EntitySlugSheet";

function EntityActions({ children }: { children: ReactNode }) {
  const [renaming, setRenaming] = useState<{ uri: string; label: string } | null>(null);
  return (
    <EntityActionsProvider
      actionsFor={(uri, name) => [
        { key: "change-address", label: "Change address…", onSelect: () => setRenaming({ uri, label: name }) },
      ]}
    >
      {children}
      {renaming ? <EntitySlugSheet entity={renaming} onClose={() => setRenaming(null)} /> : null}
    </EntityActionsProvider>
  );
}
```

`EntitySlugSheet` edits any entity's slug (blank resets it to the identifier) and updates the address
bar if it showed the old one.

## Picking related entities: `EntityPicker`

Use `EntityPicker` (`gondol/entities/EntityPicker`) for every field that points at another entity,
instead of a `<select>`. It is a typeahead over the same search as @ mentions, restricted to the
types you allow, and accepts entities dropped on it.

```tsx
<EntityPicker
  label="Notebook"
  types={["notebook"]}
  value={draft.notebook_id}             // one type: values are row ids
  onChange={(id) => setDraft({ ...draft, notebook_id: id })}
/>

<EntityPicker
  multiple
  label="Related"
  value={draft.related}                 // several types: values are URIs
  onChange={(uris) => setDraft({ ...draft, related: uris })}
/>
```

| Prop | Meaning |
| --- | --- |
| `types` | The types that can be picked. Omit for every type. |
| `multiple` | Pick several; `value` and `onChange` work with arrays. |
| `valueKind` | `"id"` (the default with exactly one type, to bind a foreign key) or `"uri"`. |
| `options` | Pick among these instead of searching (calendars you can edit, a tree). `depth` indents them. |
| `suggested`, `suggestedLabel` | Shown first while nothing is typed, under their own heading. |
| `exclude` | Ids or URIs that can't be picked (a project itself, when picking its parent). |
| `onCreate(name)` | Adds a "Create …" item for an entity that doesn't exist yet. |
| `required`, `disabled`, `placeholder`, `hint`, `ariaLabel`, `limit` | As usual. |

## Drag and drop

Every `.action-row` whose `ActionMenu` has a URI is draggable. A drag carries
`application/x-entity` (the URI and label) and a `text/plain` URI, so it can also be dropped into
other apps. To accept drops, spread `useEntityDropTarget`'s props on an element:

```tsx
import { useEntityDropTarget } from "gondol/entities/dragEntity";

function NotebookDropZone({ notebook }: { notebook: Notebook }) {
  const moveNote = useMoveNote();
  const { over, props } = useEntityDropTarget((data) => {
    const ref = parseEntityUri(data.uri);
    if (ref?.entityType === "note") moveNote.mutate({ key: ref.entityId, notebookId: notebook.id });
  });
  return <div className={over ? "drop-zone drop-zone--over" : "drop-zone"} {...props}>{notebook.name}</div>;
}
```

`useDragEntity()` reads what is being dragged right now (under `DragEntityProvider`), for showing a
dock of drop targets while a drag is in progress. `writeEntityDrag`, `hasEntityDrag` and
`readEntityDrop` are the lower-level helpers.

## Lifecycle

Entities can be soft-deleted on a schedule and can start in the future. `useEntityLifecycle()`
(`gondol/entities/lifecycle`) reads `entity_lifecycle_states()` and offers:

| Member | Meaning |
| --- | --- |
| `stateFor(uri)` | The row's `soft_deleted_at`, `future_start` and keys. |
| `isDimmed(uri)` | Soft-deleted or not started yet. |
| `isHidden(uri)` | Dimmed and the user chose to hide such rows (`hideSoftDeletedEntities`, `hideFutureEntities` in the appearance settings). |
| `schedule(uri, at)` | Schedule soft deletion at `at`, or cancel/restore with `null`. Calls `set_entity_soft_deleted_at()`. |

`ActionMenu` and `EntityPicker` already use it; use it directly in custom lists.

## Public entities

A user can make an entity public, so [sites](./sites.md) that allow anonymous visitors show it.
`usePublicEntities().isPublic(uri)` reads the user's public entities (`public_entities`) and
`useSetEntityPublic().mutate({ uri, isPublic })` changes one.

## Entity extensions

Some entity features belong to one of your apps but are used by gondol's own UI. The app provides
them as hooks through `configureGondol({ entities: { extensions } })`:

| Hook | Used by |
| --- | --- |
| `useCoverImage(uri)` | `EntityArt` shows the returned image instead of the generated tile. |
| `useTags()` | Tag conditions in the global filter and in sites offer the user's tags. |
| `useTagNamesByUri(enabled)` | Tag conditions read each entity's tag names (only fetched while `enabled`). |

They are called as React hooks, so register them once and never swap them. Without them, entities
have no covers and tag conditions have no tags to offer.

```ts
configureGondol({
  // …
  entities: {
    extensions: {
      useCoverImage: (uri) => useEntityCovers(uri).square_cover_image?.src,
      useTags,
      useTagNamesByUri,
    },
  },
});
```

## Empty lists

`EmptyState` (`gondol/shell/EmptyState`) is the placeholder for an empty list:

```tsx
<EmptyState items="notes" actionLabel="New note" onAction={modal.openNew} />
```

It says "We couldn't find any notes" and "When you create notes they will show up here." unless you
pass `title` and `description`.
