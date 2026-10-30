# remote-hello

A remote app: a gondol host loads it at run time from a gondol apps runtime (see
[Remote apps](../../docs/guide/remote-apps.md)).

```sh
npm install
npx gondol-apps dev      # http://localhost:5180, add it as a dev source in the host (developer mode)
npx gondol-apps build    # dist/client.mjs, dist/client.css, dist/server.mjs
GONDOL_APPS_SECRET=… npx gondol-apps serve --port 8787
```
