# Platform services

Smaller pieces of gondol that make an app feel native: desktop shells, developer mode, storage
namespacing and navigation feedback.

## Storage namespace

`configureGondol({ storageNamespace: "myapp" })` prefixes the `localStorage` keys and window events
gondol owns (`myapp:app:active:notes`, `myapp:app-activation-change`, site caches and previews), so
several apps on one origin don't collide and an app moving onto gondol keeps what its users already
stored. Use `namespaced(name)` from `gondol/shell/storage` for your own keys.

::: info
Some older keys are still fixed rather than namespaced, such as the theme (`cashflow-theme`,
`cashflow-user-theme`), the locale and the collapsed sidebar. They carry Spacify's history and will
move under the namespace in a later version.
:::

## Desktop apps

Gondol runs inside Tauri and Electron shells as well as the browser. Tell it where the web app lives
publicly and what the Electron preload script exposes:

```ts
configureGondol({
  // …
  desktop: { publicOrigin: "https://app.example.com", bridge: "myAppDesktop" },
});
```

`gondol/shell/desktopApp` then offers:

| Export | Use |
| --- | --- |
| `isDesktopApp()` | True inside Tauri or Electron. |
| `publicOrigin()` | The origin for links that leave the app (shared URLs, e-mails): the public origin when running from bundled `sp://` assets, else the page's own origin. |
| `getAppSource()`, `setAppSource(source)` | Whether the window loads the `bundled` build or the `live` site. |
| `setDeveloperMode(enabled)` | The desktop app's developer mode. |

A desktop shell deep-links into the app by posting `{ type: "navigate", uri }` to the window; the
chrome search field opens the URI.

## Developer mode

Outside developer mode the app behaves like a native app: the browser's own context menu and text
selection only work in text fields and code blocks, while the app's own menus (`ActionMenu`) work
everywhere. Call `installDeveloperMode()` (`gondol/shell/developerMode`) once from the root route.

In the desktop app, developer mode is the app's own setting. In a browser it is a per-device switch:
`DeveloperModeToggle` (`gondol/shell/DeveloperModeToggle`) renders it, and
`useBrowserDeveloperMode()` reads and sets it.

## Navigation progress

`NavigationProgress` (`gondol/navigation/NavigationProgress`), rendered once in the root route,
keeps the current page on screen with a thin progress bar until the next page's queries and images
have loaded, then shows it in one go. Opening or closing a routed sheet and search-param-only
changes stay live, since the sheet itself is the feedback. With the user's view transitions on, the
new page is revealed through one.

## Clipboard and toasts

`copyText(text, successMessage, failureMessage)` copies and confirms with a toast;
`showToast(message)` shows a short status message (`gondol/shell/clipboard`).
