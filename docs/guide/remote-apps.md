# Remote apps

Apps don't have to be built into the host. A **remote app** is served by a **gondol apps runtime**
somewhere on the web, and the host loads it at run time: its manifest, its pages, actions and
widgets, its styles, and (once an admin approves it) its backend functions. Once loaded it is an app
like the built-in ones: it routes, shows in the menu and the palette, and can be switched off.

```
host (the browser)                             gondol apps runtime (gondol-apps serve)
  RemoteAppsRegistrar ── GET /gondol-apps.json ──▶ the index: every app it serves
                      ── GET /apps/<id>/manifest.json
                      ── import() /apps/<id>/dist/client.mjs (+ chunks, client.css)
        │ the app's imports of react, gondol/… come from GondolSystem: the host's own modules
        ▼
  registerDynamicApps("remote", bundles)

app router (server) ── POST /apps/<id>/functions/<name> ──▶ the app's server module
   only for backends an admin approved; Authorization: Bearer <secret>, x-gondol-user: <id>
```

## How the code is shared

A remote app is built as plain ES modules (`.mjs`). It must not bundle React, gondol or the other
packages the host shares: two Reacts break hooks, and a second copy of gondol's registry would never
show the app. So the build turns every import of a shared module into a small shim that takes the
host's instance from **GondolSystem**, a System.js-style registry the host puts on `globalThis`:

```js
// what `import { useState } from "react"` becomes in the app's build
const m = await globalThis.GondolSystem.import("react");
export const useState = m["useState"];
```

What the host shares:

| | |
| --- | --- |
| Packages | `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, `react-dom/client`, `@tanstack/react-query`, `@tanstack/react-router` |
| gondol | every public module (`gondol/entities/EntitySheet`, `gondol/apps/defineApp`, `gondol/api/client`, …), and the built-in apps' models (`gondol/builtin/<app>/models/…`); not `gondol/vite/*`, `gondol/runtime/*` or the built-in apps themselves |
| The host's own | whatever it adds with `registerSharedModules({ "@myapp/models": () => import("./models") })` (`gondol/apps/remote/system`); apps build against them with `gondolRemoteApp({ shared: { "@myapp/models": ["useTags", …] } })` |

Everything else an app imports is bundled into it. Modules load lazily: the host only fetches a
gondol module when an app imports it.

## Writing one

An app package is a folder with a `package.json`, a `manifest.json` (the same manifest as a built-in
app's, see [Building apps](./apps.md)) and its sources. `package.json` names the parts in a
`gondol` field:

```json
{
  "name": "remote-hello",
  "version": "0.1.0",
  "type": "module",
  "gondol": {
    "manifest": "./manifest.json",
    "client": "./dist/client.mjs",
    "server": "./dist/server.mjs",
    "styles": ["./dist/client.css"],
    "source": { "client": "./src/index.ts", "server": "./src/server.ts" }
  },
  "devDependencies": { "gondol": "…", "react": "^19.2.0", "vite": "^8.0.16" }
}
```

(`client` and `server` fall back to the package's `exports["./client"]` and `exports["./server"]`.)

The client entry default-exports the app, made with the host's own `defineApp`:

```ts
// src/index.ts
import { defineApp } from "gondol/apps/defineApp";
import manifest from "../manifest.json";

export default defineApp({
  manifest,
  pages: { hello: () => import("./HelloPage").then((m) => m.HelloPage) },
});
```

(It may also default-export only what `defineApp` takes besides the manifest, `{ pages, … }`: the
host then uses the manifest it fetched.) Pages, widgets, actions, resolutions and entity types work
as in a built-in app. `dependencies` in the manifest must be apps the host has.

### Backend functions

A function in the manifest with `server` is answered by an export of the app's server module:

```json
"functions": {
  "greet": { "description": "Greets someone by name.", "server": "greet", "readOnly": true,
             "input": { "type": "object", "properties": { "name": { "type": "string" } } } }
},
"mcp": { "tools": [{ "name": "greet", "function": "greet" }] }
```

```ts
// src/server.ts
import type { AppFunctionContext } from "gondol/runtime/server";

export async function greet(input: { name?: string }, ctx: AppFunctionContext) {
  if (!ctx.userId) throw Object.assign(new Error("Sign in first"), { status: 401 });
  return { text: `Hello, ${input.name ?? "there"}!` };
}
```

`ctx` has the caller's `userId` in the host, the OAuth `clientId` and the `actor` (an AI
conversation or agent) when there is one, and `env`. Throw an error with a `status` (4xx) to answer
with that status; anything else is a 500. The runtime never gets the user's token: a backend that
needs the host's data asks for it through the host's [app API](./api.md) with OAuth, like any other
app.

The page calls it with `callAppFunction("hello", "greet", { name })` (`gondol/api/client`), and AI
models get its tools, like any app's. A remote app's functions must all be `server` functions; it
can't name the host's Postgres or edge functions, declare `api` operations, or have the router proxy
an MCP server of its own.

## The runtime

`gondol-apps` (gondol's `bin`) serves, develops and builds app packages. Each path is an app package
or a folder of them:

```sh
gondol-apps build [paths…]                          # dist/client.mjs (+ chunks/), dist/client.css, dist/server.mjs
GONDOL_APPS_SECRET=… gondol-apps serve [paths…] --port 8787
gondol-apps dev [paths…] --port 5180                # from source, with Vite
```

| Route | |
| --- | --- |
| `GET /gondol-apps.json` | The index: `{ format: "gondol-apps", version: 1, apps: [{ id, version, name, manifest, client, styles, functions, functionsUrl }] }`, URLs relative to the index. |
| `GET /apps/<id>/manifest.json` | The manifest. |
| `GET /apps/<id>/<file>` | Files in the client module's folder (`dist/`) and the styles; never the server module, dot files or `node_modules`. CORS: `*`. |
| `POST /apps/<id>/functions/<name>` | Runs the function: the input as the JSON body, `Authorization: Bearer <secret>`, the caller in `x-gondol-user`; answers JSON, or a problem detail. |

The secret is `GONDOL_APP_SECRET_<ID>` (the app id upper-cased, `-` as `_`), else
`GONDOL_APPS_SECRET`; without one, `serve` refuses every function call. Put the runtime behind HTTPS.
`createAppsRuntime()` and `startAppsRuntime()` (`gondol/runtime/server`) embed it in a Node server of
your own; `buildAppPackage()` (`gondol/runtime/build`) and the Vite plugin `gondolRemoteApp()`
(`gondol/vite/remoteApp`) build an app with your own tooling.

## Loading them in the host

Render the registrar once inside the shell's providers, with the sources the user has:

```tsx
import { RemoteAppsRegistrar, useRemoteAppStatuses } from "gondol/apps/remote/RemoteAppsRegistrar";

<RemoteAppsRegistrar sources={[{ url: "https://apps.example.com" }]} />
```

A source is a runtime's address (its index is `<url>/gondol-apps.json`) or an index URL. The
registrar loads every app of every source and registers them under the owner `remote`
(`registerDynamicApps`); a changed list reloads, and apps of a source that went away are
unregistered. A source or app that fails is reported by `useRemoteAppStatuses()` (for an apps
catalogue) and never breaks the others; an id the host already has is ignored. Each bundle carries
`remote` (`InternalAppBundle.remote`): its source, client URL, version, whether it is a dev app,
and its backend functions.

Remote apps run in the page with the user's session, like built-in ones: let users add only sources
they trust, and keep the list per user (or per site or workspace, chosen by an admin).

## Approving backends

The browser can load a remote app's pages on its own, but its backend functions run on the server,
for everyone, through the [app router](./functions.md). So the router serves them only after an
**admin** has approved them, and only exactly what was approved:

1. A user who installs a remote app with functions asks for its backend to be approved; the host
   stores the request with the manifest it saw.
2. An admin reviews it with `reviewRemoteBackend(manifest, functionsUrl)` (`gondol/apps/remote/backend`):
   what each function does, where it is served, whether it only reads or deletes, and any reason it
   can't be approved. Approving stores `review.registry` (the router's entry for the app, every
   function routed to the runtime) and `review.fingerprint`, and gives the runtime a new secret.
3. The router asks the host for the approved backends (`remoteApps`, below) and calls the runtime
   with that secret and the caller's user id.

`backendFingerprint(manifest)` (`gondol/apps/remote/protocol`) covers the manifest's `functions` and
`mcp`: when an app's new version changes them, the host compares fingerprints and asks for approval
again, and until then the router keeps serving only what was approved.

### What the router needs from the host

`createAppRouter({ remoteApps })` takes the approved backends as `{ app, secret }` (`RemoteBackend`)
and asks for them at most every `remoteAppsTtlMs` (30 s). Gondol's `app-router` edge function reads
them from the host's `approved_remote_app_backends()`, a function only the service role may call,
returning `(app_id text, registry jsonb, secret text)`; Spacify keeps them in
`remote_app_backends` (and the secrets, never readable by users, in `remote_app_backend_secrets`).
Runtimes must be public HTTPS hosts unless `REMOTE_APPS_ALLOWED_HOSTS` lists the host or
`REMOTE_APPS_ALLOW_PRIVATE=true`. Built-in apps win over a remote app with the same id.

## Dev mode

`gondol-apps dev` serves the apps from source through Vite's dev server (one per app, at
`/apps/<id>/`): the index points at the source entry (`src/index.ts`), every request is transformed
on the fly with the same shims, so the app renders with the host's React, and saving a file reloads
it. Backend functions run the server source (`ssrLoadModule`), without a secret.

The host loads a dev runtime like any source, but marked `dev`:

```tsx
<RemoteAppsRegistrar sources={[...sources, { url: "http://localhost:5180", dev: true }]} />
```

A dev app's functions are called straight from the developer's browser (`callAppFunction` sees
`remote.dev`), never through the router, so they need no approval and never run for anyone else.
Offer dev sources only to developers (gondol's developer mode) and keep them per device. Run the
host with `vite dev` too (a page served over HTTPS may not load modules from `http://localhost` in
every browser).
