# Widgets

Widgets let an app put something on screen outside its own pages: a card on the home view, a panel
in the sidebar, a player along the bottom, or a context provider around the whole shell. They are
declared on the bundle and only mounted while the app is active.

```ts
// apps/planning/index.ts
export const planningApp: InternalAppBundle = {
  // …
  widgets: {
    overviewHeadWidgets: [NowPlayingTasksWidget],
    bottomWidgets: [TaskPlayerWidget],
    Providers: [TaskPlayerProvider],
  },
};
```

## Slots

| Slot | Where it renders | Props |
| --- | --- | --- |
| `overviewHeadWidgets` | Top of the home view, above every app's `overviewWidgets`. | `AppOverviewWidgetProps` |
| `overviewWidgets` | The home view. | `AppOverviewWidgetProps` |
| `sidebarNavWidgets` | Inside the navigation, after your own nav items (also in the phone menu drawer). | `AppSidebarWidgetProps` |
| `sidebarPanelWidgets` | Below the navigation, filling the sidebar column (desktop only). | `AppSidebarWidgetProps` |
| `sidebarWidgets` | Collected for shells that render them; `AppShell` doesn't. | `AppSidebarWidgetProps` |
| `bottomWidgets` | After the content, for fixed bars along the bottom. | `AppBottomWidgetProps` |
| `contentHeadWidgets` | Above the page content (notices, load errors). | none |
| `overlayWidgets` | After the shell's own overlays, for sheets an app opens from anywhere. | none |
| `Providers` | Around everything inside `ActiveAppsProvider`. | `{ children }` |

Make widgets with `lazyWidget(() => import("./Widget").then((m) => m.Widget))` (`gondol/apps/defineApp`)
so their code loads only when they render; the shell renders every slot with `<Widgets/>`
(`gondol/apps/navigation`), which wraps each widget in `Suspense`. Providers can't be lazy: keep them
small and load the heavy parts inside them.

`AppShell` renders the sidebar and bottom slots itself. The home view is yours, so render the
overview widgets where you want them:

```tsx
import { useActiveAppWidgets } from "gondol/apps/navigation";

function Overview(props: MyOverviewWidgetProps) {
  const { overviewWidgets } = useActiveAppWidgets(); // head widgets first
  return (
    <div className="stack">
      {overviewWidgets.map((Widget, i) => (
        <Widget key={i} {...props} />
      ))}
    </div>
  );
}
```

## Widget props

**Sidebar widgets** get `onOpenUri(uri)` to open an entity, `collapsed` while the sidebar is
collapsed to icons, and (in the navigation) a `className`. A widget should render a compact form when
`collapsed` is true.

```tsx
import type { AppSidebarWidgetProps } from "gondol/apps/types";
import { toEntityUri } from "gondol/entities/uri";
import { useRecentNotes } from "../models";

export function RecentNotesWidget({ onOpenUri, collapsed }: AppSidebarWidgetProps) {
  const { data: notes = [] } = useRecentNotes();
  if (collapsed) return null;
  return (
    <div className="nav-group">
      <div className="nav-group__label">Recent notes</div>
      {notes.map((note) => (
        <button key={note.id} className="nav-item" onClick={() => onOpenUri?.(toEntityUri("note", note.id))}>
          {note.title}
        </button>
      ))}
    </div>
  );
}
```

**Bottom widgets** get `alwaysShow` and `className`.

**Overview widgets** get whatever your home view passes. Type it once on `Register`, and every app's
overview widgets are checked against it:

```ts
declare module "gondol" {
  interface Register {
    overviewWidgetProps: { today: Date; onOpenUri: (uri: string) => void };
  }
}
```

## Providers

`Providers` wrap the shell in an app's own context, so its widgets and pages share state (Spacify's
task player is a provider, a bottom bar widget and a home view card). Render
`ActiveAppsProvider` once around the shell; it nests every active app's providers in registration
order and drops an app's provider when the app is switched off.

```tsx
<GlobalFilterProvider>
  <ActiveAppsProvider>
    <ActionsProvider /* … */>
      <AppShell /* … */ />
    </ActionsProvider>
  </ActiveAppsProvider>
</GlobalFilterProvider>
```

Because a provider disappears with its app, anything outside the app that calls the app's context
hook must cope with no provider (return a default rather than throw).
