# Build your first app

This tutorial adds a complete **Notes** app to an app that already runs on gondol (see [Getting
started](../guide/getting-started.md)). By the end, notes have their own sidebar section, a list with
row actions, a create and edit sheet on their own routes, entity URIs and public addresses, search
results, palette actions with a shortcut, and a sidebar widget.

The app's name below is `myapp` and its URI scheme is `myapp`. Paths assume Spacify's layout (app bundles live in a top-level `apps/` folder, outside `src/`, because they are separate components that are linked in and can be lazy loaded):
`apps/<id>/`, `src/lib/`, `src/routes/`.

## 1. The table

Create a migration for the table, with row-level security and the slug columns:

```sql
-- supabase/migrations/20261101120000_notes.sql
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "Owners manage their notes" on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- slug and identifier, kept in sync by triggers (see the Supabase guide)
select public.add_entity_slug('public.notes');
```

Then add `note` to `search_entities()` so notes show up in search, mentions and pickers. Follow the
wrap-and-rename pattern from [Search](../guide/search-and-filters.md#making-a-type-searchable): the
new branch selects `'note'`, `id::text`, `title`, `null` as subtitle, `true` as `is_own`, `false` as
`is_public`, a rank and `updated_at`, for the caller's own rows.

Regenerate your Supabase types afterwards so `notes` is typed.

## 2. The entity type

Register `note` everywhere gondol needs to know about it:

```ts
// src/lib/entities.ts
import { sheet, type EntityRoute } from "gondol/entities/uri";

export type EntityType = /* …existing types… */ | "note";

export const ENTITY_ROUTES: Record<EntityType, EntityRoute> = {
  // …
  // /note/<key> is the generic entity view; /note/<key>/edit opens the sheet over /notes.
  note: { slug: "note", edit: sheet("/notes") },
};
```

```ts
// src/lib/entitySources.ts
export const ENTITY_SOURCES: Record<EntityType, EntitySource> = {
  // …
  note: { table: "notes", columns: "id, title", label: (r) => str(r.title) },
};
```

```ts
// src/lib/entityArt.ts
export const ENTITY_ART: Record<EntityType, EntityArtStyle> = {
  // …
  note: { icon: "document", hue: 212 },
};
```

These maps are already passed to `configureGondol()` in `src/gondol.ts`, so nothing else changes
there.

## 3. Strings

```ts
// src/lib/i18n.tsx, in MESSAGES
en: {
  // …
  "entity.note": "Note",
  "notes.title": "Notes",
  "notes.new": "New note",
  "notes.create": "Create note",
  "notes.delete": "Delete note",
  "notes.field.title": "Title",
  "notes.field.body": "Text",
  "notes.untitled": "Untitled note",
  "notes.confirmDelete": "Delete \"{name}\"?",
},
sv: {
  // …
  "entity.note": "Anteckning",
  "notes.title": "Anteckningar",
  "notes.new": "Ny anteckning",
  "notes.create": "Skapa anteckning",
  "notes.delete": "Ta bort anteckning",
  "notes.field.title": "Rubrik",
  "notes.field.body": "Text",
  "notes.untitled": "Namnlös anteckning",
  "notes.confirmDelete": "Ta bort \"{name}\"?",
},
```

## 4. The model

Queries and mutations live in the app's `models/`, so other apps can reuse them:

```ts
// apps/notes/models/notes.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "gondol/supabase/client";
import { sessionUserId } from "gondol/supabase/session";
import type { Database } from "@/integrations/supabase/types";

const db = () => getSupabaseClient<Database>();

export interface Note {
  id: string;
  slug: string;
  identifier: string;
  title: string;
  body: string;
  updated_at: string;
}

export type NoteDraft = Pick<Note, "title" | "body">;

const NOTES_KEY = ["notes"];

export function useNotes() {
  return useQuery({
    queryKey: NOTES_KEY,
    queryFn: async () => {
      const userId = await sessionUserId();
      const { data, error } = await db()
        .from("notes")
        .select("id, slug, identifier, title, body, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Note[];
    },
  });
}

export function useSaveNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...draft }: NoteDraft & { id?: string }) => {
      const userId = await sessionUserId();
      const { error } = id
        ? await db().from("notes").update({ ...draft, updated_at: new Date().toISOString() }).eq("id", id)
        : await db().from("notes").insert({ ...draft, user_id: userId });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTES_KEY }),
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db().from("notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTES_KEY }),
  });
}
```

```ts
// apps/notes/models/index.ts
export * from "./notes";
```

## 5. The panel

The list follows gondol's conventions: rows are `.action-row`s with one `ActionMenu` carrying the
entity's URI, an empty list shows `EmptyState`, and create and edit open an `EntitySheet` driven by
the URL through `useEntityModal`.

```tsx
// apps/notes/features/notes/src/components/NotesPanel.tsx
import { useState } from "react";
import { Button, Card, Input } from "gondol/design-system/bungalow-79d923";
import { ActionMenu } from "gondol/entities/ActionMenu";
import { EntitySheet } from "gondol/entities/EntitySheet";
import { FormActions } from "gondol/entities/FormActions";
import { entityKey, findByEntityKey } from "gondol/entities/slugs";
import { entityViewPath, toEntityUri } from "gondol/entities/uri";
import { useNavigateKeepingSearch, useEntityModal } from "gondol/navigation/useEntityModal";
import { EmptyState } from "gondol/shell/EmptyState";
import { useI18n } from "@/lib/i18n";
import { useDeleteNote, useNotes, useSaveNote, type Note } from "../../../../models";

export function NotesPanel() {
  const { t } = useI18n();
  const { data: notes = [], isLoading } = useNotes();
  const remove = useDeleteNote();
  const modal = useEntityModal("/notes");
  const go = useNavigateKeepingSearch();
  const editing = modal.mode === "edit" ? findByEntityKey(notes, modal.id) : undefined;

  function confirmDelete(note: Note) {
    if (window.confirm(t("notes.confirmDelete", { name: note.title }))) remove.mutate(note.id);
  }

  return (
    <div className="stack">
      <div className="panel-head">
        <h2 className="panel-title">{t("notes.title")}</h2>
        <Button tone="primary" onClick={modal.openNew}>{t("notes.new")}</Button>
      </div>

      {!isLoading && notes.length === 0 ? (
        <EmptyState items="notes" actionLabel={t("notes.new")} onAction={modal.openNew} />
      ) : (
        <Card>
          <table className="data-table">
            <tbody>
              {notes.map((note) => (
                <tr key={note.id} className="action-row">
                  <td className="data-table__title">
                    <button type="button" className="link" onClick={() => go(entityViewPath("note", entityKey(note)))}>
                      {note.title}
                    </button>
                  </td>
                  <td>{new Date(note.updated_at).toLocaleDateString()}</td>
                  <td className="action-row-cell">
                    <ActionMenu
                      name={note.title}
                      uri={toEntityUri("note", note.id)}
                      actions={[
                        { key: "edit", label: t("actions.edit"), onSelect: () => modal.openEdit(entityKey(note)) },
                        { key: "delete", label: t("notes.delete"), tone: "danger", onSelect: () => confirmDelete(note) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {modal.mode === "new" || editing ? (
        <NoteSheet key={editing?.id ?? "new"} note={editing} onClose={modal.close} onDelete={confirmDelete} />
      ) : null}
    </div>
  );
}

function NoteSheet({ note, onClose, onDelete }: { note?: Note; onClose: () => void; onDelete: (note: Note) => void }) {
  const { t } = useI18n();
  const save = useSaveNote();
  const [draft, setDraft] = useState({ title: note?.title ?? "", body: note?.body ?? "" });

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
          onDelete={note ? () => onDelete(note) : undefined}
          deleteLabel={t("notes.delete")}
          onCancel={note ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={note ? t("form.save") : t("notes.create")}
          saving={save.isPending}
          submitDisabled={!draft.title.trim()}
        />
      }
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{t("entity.note")}</div>
          <div className="entity-preview__label">{draft.title.trim() || t("notes.untitled")}</div>
        </div>
      }
    >
      <Input label={t("notes.field.title")} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
      <label className="field">
        <span>{t("notes.field.body")}</span>
        <textarea rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
      </label>
    </EntitySheet>
  );
}
```

`actions.edit`, `sheet.close`, `form.cancel` and `form.save` are keys of your app's catalogue
(Spacify has them); add them if yours doesn't.

## 6. The feature, manifest and bundle

```tsx
// apps/notes/features/notes/src/pages/NotesPage.tsx
import type { AppFeaturePageProps } from "gondol/apps/types";
import { NotesPanel } from "../components/NotesPanel";

export function NotesPage(_props: AppFeaturePageProps) {
  return <NotesPanel />;
}
```

```jsonc
// apps/notes/manifest.json
{
  "id": "notes",
  "slug": "notes",
  "name": { "en": "Notes", "sv": "Anteckningar" },
  "description": { "en": "Quick notes you can link to from anywhere.", "sv": "Snabba anteckningar du kan länka till var som helst." },
  "iconName": "document",
  "defaultFeatureId": "notes",
  "dependencies": [],
  "features": [
    {
      "id": "notes",
      "name": { "en": "Notes", "sv": "Anteckningar" },
      "description": { "en": "Quick notes", "sv": "Snabba anteckningar" },
      "path": "notes",
      "iconName": "document",
      "actions": [
        { "id": "notes.open", "title": "Go to Notes", "category": "Notes", "iconName": "document", "keywords": ["notes", "memo"], "navigate": "/notes" },
        { "id": "notes.new", "title": "New Note", "category": "Notes", "iconName": "plus", "shortcut": "Mod+Alt+O", "keywords": ["note", "new", "create", "write"], "navigate": "/notes/new", "aspects": ["create"] }
      ],
      "create": [{ "key": "note", "label": "entity.note", "section": "nav.notes", "iconName": "document", "path": "/notes/new" }]
    }
  ],
  "entities": {
    "note": { "slug": "note", "edit": "/notes/{key}/edit", "art": { "iconName": "document", "hue": 45 }, "source": { "table": "notes", "columns": "id, title", "label": "title" } }
  }
}
```

```ts
// apps/notes/index.ts
import { defineApp, lazyWidget } from "gondol/apps/defineApp";
import manifest from "./manifest.json";

export default defineApp({
  manifest,
  // Loaded when the page first opens, so the app's code stays out of the first load.
  pages: { notes: () => import("./features/notes/src/pages/NotesPage").then((m) => m.NotesPage) },
  widgets: {
    sidebarNavWidgets: [lazyWidget(() => import("./widgets/RecentNotesWidget").then((m) => m.RecentNotesWidget))],
  },
});
```

`defineApp` validates the manifest and turns it into the bundle: the palette actions, the create
picker item and the `note` entity type all come from it. The build finds the app by its folder
(`gondolApps` in `vite.config.ts`); add `"notes"` to the plugin's `order` where it should appear in
the sidebar.

## 7. A sidebar widget

```tsx
// apps/notes/widgets/RecentNotesWidget.tsx
import type { AppSidebarWidgetProps } from "gondol/apps/types";
import { toEntityUri } from "gondol/entities/uri";
import { useNotes } from "../models";

export function RecentNotesWidget({ onOpenUri, collapsed, className }: AppSidebarWidgetProps) {
  const { data: notes = [] } = useNotes();
  if (collapsed || notes.length === 0) return null;
  return (
    <div className={`nav-group ${className ?? ""}`}>
      <div className="nav-group__label">Recent notes</div>
      {notes.slice(0, 5).map((note) => (
        <button key={note.id} type="button" className="nav-item" onClick={() => onOpenUri?.(toEntityUri("note", note.id))}>
          <span className="nav-item__label">{note.title}</span>
        </button>
      ))}
    </div>
  );
}
```

## 8. Routes

With a catch-all route rendering the shell, `/notes`, `/notes/new` and `/notes/<key>/edit` already
work. Add route files to give them titles and typed links:

```tsx
// src/routes/notes.tsx
import { createFileRoute } from "@tanstack/react-router";
import { validateDateRangeSearch } from "gondol/navigation/dateRangeSearch";
import { Home } from "@/routes/index";

export const Route = createFileRoute("/notes")({
  validateSearch: validateDateRangeSearch,
  head: () => ({ meta: [{ title: "Notes" }] }),
  component: Home,
});
```

Repeat for `src/routes/notes.new.tsx` (`"/notes/new"`, "New note") and
`src/routes/notes.$noteId.edit.tsx` (`"/notes/$noteId/edit"`, "Edit note").

## 9. Try it

Start the app and check each piece:

- **Navigation.** A "Notes" section appears in the sidebar and the phone menu drawer, with the
  recent notes widget. Switching the app off (from your app catalogue, or
  `setAppActivation("notes", false)`) removes both at once.
- **Create and edit.** "New note" opens `/notes/new`; saving closes the sheet. A row's "⋯" menu
  (or right-click) opens `/notes/<slug>/edit`, shown as `/note/<slug>/edit` in the address bar.
  Reloading keeps the sheet open, and Back closes it.
- **URIs.** "Share" opens the share sheet, whose "Copy URI" copies `myapp:note:<slug>`. Paste it into the chrome search field and press
  Enter to open the note. "Copy link" copies `https://<your host>/note/<slug>`.
- **Palette.** `Mod+K` lists "Go to Notes" and "New Note"; `Mod+Alt+O` creates a note from anywhere.
- **Search.** Typing a note's title on `/search` finds it, and an `EntityPicker` with
  `types={["note"]}` can pick it.
- **Drag and drop.** Drag a row onto any entity drop target, such as an `EntityPicker`.

## Where to go next

- Give notes a page of their own with ``view: (key) => `/notes/${key}` `` in their `EntityRoute`, and
  render it from `NotesPanel` when the path has a key (see [Features](../guide/features.md#sub-pages-inside-a-feature)).
- Relate notes to other entities with `EntityPicker`, storing URIs.
- Add the type to `global_filter_excluded()` so the global filter applies to it.
- Contribute an overview widget for the home view (see [Widgets](../guide/widgets.md)).
