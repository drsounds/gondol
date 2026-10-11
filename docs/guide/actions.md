# Actions and shortcuts

Actions are commands. They show up in the command palette, can carry a keyboard shortcut, and are
collected from three places: gondol's own global actions, the active apps and their features, and
components that are on screen right now.

## Declaring an action

```ts
import type { AppAction } from "gondol/apps/types";

const newNote: AppAction = {
  id: "notes.new",                  // unique across the app; duplicates are dropped
  title: "New Note",
  subtitle: "Notes",                // shown next to the title
  description: "Write a new note",
  category: "Notes",                // groups the palette
  iconName: "plus",
  shortcut: "Mod+Alt+O",
  keywords: ["note", "new", "create", "write"],
  perform: ({ navigate }) => navigate("/notes/new"),
};
```

`perform` receives an `AppActionContext`:

| Field | Meaning |
| --- | --- |
| `navigate(path)` | Navigate inside the app (the shell's navigate, which keeps the global search params). |
| `pathname`, `activeTab` | Where the user is. |
| `openActionsMenu()`, `closeActionsMenu()` | The palette. |
| `openShortcutsHelp()` | The keyboard shortcuts dialog. |
| `toggleSidebar()`, `toggleTheme()` | When the shell passed them to `ActionsProvider`. |
| `openCreate()` | The shell's create picker, when passed. |

Set `disabled: true` to keep an action out of the palette and its shortcut inactive.

## Where actions come from

**App-wide actions** go on the bundle (`InternalAppBundle.actions`). **Feature actions** are
declared on the feature in `manifest.json`: with `navigate` they go to that path, otherwise the app's
`defineApp({ actions })` implements them by id. A feature that leaves `actions` out gets a default
"Open *name*" action that navigates to its path. Both only exist while their app is active.

**Contextual actions** belong to whatever is on screen. Register them from any component inside
`ActionsProvider`; they are removed when it unmounts:

```tsx
import { useMemo } from "react";
import { useRegisterActions } from "gondol/apps/actions";

function NoteDetail({ note, onDelete }: { note: Note; onDelete: () => void }) {
  const actions = useMemo(
    () => [
      {
        id: "notes.current.delete",
        title: `Delete "${note.title}"`,
        category: "Notes",
        iconName: "recycle-bin",
        perform: onDelete,
      },
    ],
    [note.title, onDelete],
  );
  useRegisterActions(actions);
  // …
}
```

Memoize the array: a new array on every render re-registers the actions every render.

**Global actions** come from gondol itself:

| Action | Shortcut |
| --- | --- |
| Actions Menu / Command Palette | `Mod+Shift+P` (also `Mod+P`, `Mod+K`) |
| Keyboard Shortcuts | `?` |
| Toggle Sidebar (when `toggleSidebar` is passed) | `Mod+B` |
| Toggle Color Theme (when `toggleTheme` is passed) | `Mod+Shift+T` |
| Create New… (when `openCreate` is passed) | `Mod+Shift+A` |
| Go to … (the root tabs) | `Mod+1` to `Mod+9`, by position |
| Previous Tab, Next Tab | `Mod+[`, `Mod+]` |

::: info
The root tabs are Overview, Search, App Finder and Account (`DEFAULT_ROOT_TABS`, override with
`ActionsProvider`'s `rootTabs`), plus every app navigation item with `"tab": true` in its manifest,
merged by `order`.
:::

## The provider

`ActionsProvider` (`gondol/apps/actions`) collects the actions, listens for shortcuts and owns the
palette's open state. Render it inside `ActiveAppsProvider` and around `AppShell`, which renders the
palette (`ActionsPalette`) and the shortcuts dialog (`KeyboardShortcutsDialog`):

```tsx
<ActionsProvider
  navigate={navigateTo}
  openCreate={() => setCreateOpen(true)}
  toggleSidebar={toggleNavCollapsed}
  toggleTheme={toggleTheme}
  pathname={pathname}
  activeTab={tab}
>
  <AppShell /* … */ />
</ActionsProvider>
```

`useActions()` exposes the same state to any component: `allActions`, `executeAction(action)`,
`openActionsMenu()`, `toggleActionsMenu()`, `openShortcutsHelp()` and so on. A button that opens
the palette is just:

```tsx
const { openActionsMenu } = useActions();
return <button onClick={openActionsMenu}>Actions</button>;
```

## Shortcut syntax

Shortcuts are `+`-joined strings: modifiers, then one key.

| Token | Meaning |
| --- | --- |
| `Mod` | ⌘ on Apple platforms, Ctrl elsewhere. Prefer it over `Ctrl` or `Meta`. |
| `Ctrl` / `Control`, `Meta` / `Cmd`, `Alt` / `Option`, `Shift` | The literal modifier. |
| A letter or digit | Matched by physical key (`event.code`), so layouts and Alt don't break it. |
| `[`, `]`, `/`, `-`, … | Matched by key or physical key. |
| A lone symbol such as `?` | Matched by the typed character, whatever Shift it needs. |

Shortcuts without `Mod`, Ctrl or Meta don't fire while the user types in a field. While the palette
or the shortcuts dialog is open, only Escape (and the palette toggle) reach the provider.

`gondol/navigation/shortcuts` exports the helpers the provider uses: `matchesShortcut(event,
shortcut)`, `formatShortcut(shortcut)` (`⌘⇧P` on a Mac, `Ctrl+Shift+P` elsewhere), `isMac()` and
`isEditableElement(target)`.
