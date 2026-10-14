# Core concepts

Gondol splits an application into a framework part, which every app on it shares, and the app's own
part, which is a bundle of smaller apps. This page names the pieces; the rest of the guide covers
each one.

## The layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ Your app (e.g. Spacify)                                              │
│   src/gondol.ts      configureGondol(), Register                     │
│   apps/*         the bundle of apps: features, actions, widgets  │
│   src/routes/*       thin route files that render the shell          │
│   supabase/          the app's tables, plus gondol's base schema     │
├──────────────────────────────────────────────────────────────────────┤
│ gondol                                                               │
│   apps/        registry, activation, navigation, actions palette    │
│   shell/       AppShell, chrome search, nav, drawer, empty states    │
│   entities/    URIs, addresses, slugs, sources, sheets, menus, DnD   │
│   search/      entity search, search page, global filter            │
│   theme/       light/dark, accent, palettes, Aero and TUI engines    │
│   navigation/  progress, shortcuts, URL-driven modals, search params │
│   sites/       per-domain configuration                              │
│   i18n/        messages and locale                                   │
│   supabase/    clients, auth middleware, base schema types           │
│   design-system/bungalow, styles/                                    │
├──────────────────────────────────────────────────────────────────────┤
│ TanStack Start · TanStack Router · TanStack Query · React · Supabase  │
└──────────────────────────────────────────────────────────────────────┘
```

Gondol never imports from your app. Everything app-specific reaches it through registration
(`configureGondol()`), type augmentation (`Register`), props (`AppShell`, `SearchPanel`) or hooks your
apps provide (entity extensions).

## Apps

An **app** (an `InternalAppBundle`) is a self-contained area of your product: Finances, Wiki, Tags.
It has an id, a name, an icon, a list of features, and optionally actions and widgets. It is described
by a `manifest.json` next to its code. Apps are registered once, in menu order, and each one shows
up as a section of the sidebar.

Apps are *internal*: they ship in your source code and can't be deleted, but every user can switch
each one on and off, and a [site](./sites.md) can switch them off for a whole domain. An app may
depend on others (Wiki depends on Media), so turning a site's apps on pulls in their dependencies.

See [Building apps](./apps.md).

## Features

A **feature** (an `AppFeature`) is one page of an app, reachable at its own path (`/wiki`), at its
aliases, and at `/app/<appId>/<featureId>`. It is a React component that receives
`AppFeaturePageProps`. A feature appears in its app's sidebar section unless it is
`hiddenFromNav`.

See [Features](./features.md).

## Actions and widgets

**Actions** are commands in the command palette (`Mod+Shift+P`, `Mod+K`), optionally with a keyboard
shortcut. Apps and features declare them, and mounted components can add their own while they are
on screen. See [Actions and shortcuts](./actions.md).

**Widgets** are components an app contributes to the shell outside its own pages: the home view, the
sidebar, the bottom of the screen, and context providers around everything. They are only mounted
while their app is active. See [Widgets](./widgets.md).

## Entities

An **entity** is any row a user can open, link to, search for or drag around. Every entity has:

- a type (`note`) and a key (its uuid, its base62 `identifier`, or its readable `slug`),
- a **URI**, `<scheme>:<type>:<key>` (`myapp:note:shopping-list`), the one way to point at it from
  anywhere: other rows, links, the search field, a desktop shell,
- a **public address**, `/note/shopping-list`, and an edit address, `/note/shopping-list/edit`,
- a **source**: the table it lives in and how to label a row,
- **art**: a glyph and a hue for its generated cover tile.

With those registered, gondol gives every entity "Copy URI" and "Copy URL", search results, a place
in entity pickers, drag and drop, soft deletion and "Change address…". See
[Entities](./entities.md) and [Entity UI](./entity-ui.md).

## The shell

The **shell** is the frame around every page: the chrome bar with back, forward and search, the
navigation built from the active apps, the menu drawer on phones, the command palette and the
keyboard shortcuts help. Your app renders `AppShell` from one component that every route uses, and
decides what goes in its content area from the current path. See [The application
shell](./app-shell.md).

## URL-first state

Gondol keeps state that a user would want to share, reload or go back to in the URL:

- create and edit sheets are routes (`/notes/new`, `/notes/shopping-list/edit`),
- the search page's query and type filter are `?q=` and `?type=`,
- the global date period and entity filter are `?fromDate=`, `?toDate=`, `?types=`, `?where=` and
  `?match=`, kept on every navigation.

Per-device preferences (theme, collapsed sidebar, app activation) live in `localStorage`; the
appearance settings also sync to the user's account.
