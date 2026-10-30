// The gondol apps runtime: serves apps that gondol hosts load at run time (remote apps,
// src/apps/remote) from their packages, and runs their backend functions.
//
//   GET  /gondol-apps.json                  the index: every app served here
//   GET  /apps/<id>/manifest.json           an app's manifest
//   GET  /apps/<id>/<file>                  its client modules (.mjs), chunks and styles
//   POST /apps/<id>/functions/<name>        a backend function: the export the manifest's
//                                           `functions.<name>.server` names, of its server module
//
// An app is a package whose package.json says where its parts are:
//
//   {
//     "name": "@acme/hello", "version": "1.0.0", "type": "module",
//     "gondol": {
//       "manifest": "./manifest.json",
//       "client": "./dist/client.mjs",          // export default defineApp({ manifest, pages })
//       "server": "./dist/server.mjs",          // export async function greet(input, ctx) { … }
//       "styles": ["./dist/client.css"],
//       "source": { "client": "./src/index.ts", "server": "./src/server.ts" }   // for dev and build
//     }
//   }
//
// (`client`/`server` fall back to the package's `exports["./client"]`/`exports["./server"]`.)
//
// Backend functions are called by a host's app router once an admin there approved the app's
// backend, with `Authorization: Bearer <secret>` (GONDOL_APP_SECRET_<ID>, else GONDOL_APPS_SECRET;
// without one they're refused) and the caller in `x-gondol-user`. In dev mode (`gondol-apps dev`)
// the client modules come from Vite's dev server, with the source files, and functions are called
// straight from the developer's browser, without a secret.
import { existsSync, readFileSync, readdirSync, statSync, createReadStream } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const INDEX_PATH = "/gondol-apps.json";
const MAX_BODY = 1024 * 1024;
const TYPES = {
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

const isId = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(value);
const exportPath = (target) => (typeof target === "string" ? target : target?.import ?? target?.default ?? null);

/** Reads an app package: its package.json `gondol` field and its manifest. Throws when it isn't one. */
export function loadAppPackage(dir) {
  dir = resolve(dir);
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) throw new Error(`${dir} has no package.json`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const conf = pkg.gondol ?? {};
  const at = (path) => (path ? resolve(dir, path) : null);
  const manifestPath = at(conf.manifest ?? "./manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`${dir}: no manifest (package.json "gondol.manifest", default ./manifest.json)`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isId(manifest.id)) throw new Error(`${manifestPath}: "id" must be a lower-case id`);
  const client = at(conf.client ?? exportPath(pkg.exports?.["./client"]));
  if (!client) throw new Error(`${dir}: package.json names no client module ("gondol.client")`);
  const server = at(conf.server ?? exportPath(pkg.exports?.["./server"]));
  const source = { client: at(conf.source?.client), server: at(conf.source?.server) };
  const functions = Object.entries(manifest.functions ?? {})
    .filter(([, fn]) => fn && typeof fn.server === "string")
    .map(([name, fn]) => ({ name, export: fn.server }));
  return {
    id: manifest.id,
    dir,
    pkg,
    name: typeof manifest.name === "object" ? manifest.name.en : manifest.name,
    version: pkg.version,
    manifestPath,
    manifest,
    client,
    server,
    styles: (conf.styles ?? []).map((style) => resolve(dir, style)),
    source,
    functions,
  };
}

/** The app packages under `paths`: each path an app package, or a folder of them. */
export function findAppPackages(paths) {
  const apps = [];
  for (const path of paths) {
    const dir = resolve(path);
    if (existsSync(join(dir, "package.json")) && JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).gondol) {
      apps.push(loadAppPackage(dir));
      continue;
    }
    for (const name of readdirSync(dir).sort()) {
      const child = join(dir, name);
      if (statSync(child).isDirectory() && existsSync(join(child, "package.json"))) {
        const pkg = JSON.parse(readFileSync(join(child, "package.json"), "utf8"));
        if (pkg.gondol) apps.push(loadAppPackage(child));
      }
    }
  }
  const seen = new Set();
  for (const app of apps) {
    if (seen.has(app.id)) throw new Error(`gondol-apps: two apps with the id "${app.id}"`);
    seen.add(app.id);
  }
  return apps;
}

/** The secret the app's functions expect: GONDOL_APP_SECRET_<ID> (upper case, - as _), else GONDOL_APPS_SECRET. */
export function secretFor(appId, env = process.env) {
  return env[`GONDOL_APP_SECRET_${appId.toUpperCase().replace(/-/g, "_")}`] || env.GONDOL_APPS_SECRET || null;
}

const toUrlPath = (path) => path.split(sep).join("/");

/** A problem detail (RFC 9457) answer. */
function problem(res, status, title, detail) {
  res.writeHead(status, { "Content-Type": "application/problem+json" });
  res.end(JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}) }));
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("The body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("The body isn't valid JSON"), { status: 400 });
  }
}

/** Whether a secret matches, in constant time for equal lengths. */
function sameSecret(given, expected) {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * The runtime's request handler for `apps` (loadAppPackage). `dev`: Vite dev servers by app id
 * (createDevServers), which then serve the client modules from source and run the server module's
 * source. `env`: where secrets are read (default process.env).
 */
export function createAppsRuntime({ apps, dev = null, env = process.env, log = console } = {}) {
  const byId = new Map(apps.map((app) => [app.id, app]));
  const serverModules = new Map();

  function index() {
    return {
      format: "gondol-apps",
      version: 1,
      ...(dev ? { dev: true } : {}),
      apps: apps.map((app) => {
        const clientFile = dev && app.source.client ? app.source.client : app.client;
        const styles = dev ? [] : app.styles.filter((style) => existsSync(style));
        return {
          id: app.id,
          ...(app.version ? { version: app.version } : {}),
          ...(app.name ? { name: app.name } : {}),
          manifest: `apps/${app.id}/manifest.json`,
          client: `apps/${app.id}/${toUrlPath(relative(app.dir, clientFile))}`,
          styles: styles.map((style) => `apps/${app.id}/${toUrlPath(relative(app.dir, style))}`),
          functions: currentFunctions(app).map((fn) => fn.name),
          functionsUrl: `apps/${app.id}/functions`,
        };
      }),
    };
  }

  /** The manifest as it is now (dev reads it fresh, so editing it needs no restart). */
  function currentManifest(app) {
    return dev ? JSON.parse(readFileSync(app.manifestPath, "utf8")) : app.manifest;
  }

  function currentFunctions(app) {
    if (!dev) return app.functions;
    return Object.entries(currentManifest(app).functions ?? {})
      .filter(([, fn]) => fn && typeof fn.server === "string")
      .map(([name, fn]) => ({ name, export: fn.server }));
  }

  async function serverModule(app) {
    if (dev && app.source.server) return await dev.get(app.id).ssrLoadModule(app.source.server);
    if (!app.server || !existsSync(app.server)) throw Object.assign(new Error(`The app "${app.id}" has no server module`), { status: 501 });
    const version = statSync(app.server).mtimeMs;
    const cached = serverModules.get(app.id);
    if (cached && cached.version === version) return cached.module;
    const module = await import(`${pathToFileURL(app.server).href}?v=${version}`);
    serverModules.set(app.id, { version, module });
    return module;
  }

  async function runFunction(req, res, app, name) {
    if (req.method !== "POST") return problem(res, 405, "Method Not Allowed");
    const fn = currentFunctions(app).find((f) => f.name === name);
    if (!fn) return problem(res, 404, "Not Found", `No function ${app.id}/${name}`);
    if (!dev) {
      const secret = secretFor(app.id, env);
      if (!secret) return problem(res, 503, "Service Unavailable", `No secret is set for ${app.id} (GONDOL_APP_SECRET_${app.id.toUpperCase().replace(/-/g, "_")} or GONDOL_APPS_SECRET)`);
      const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
      if (!bearer || !sameSecret(bearer[1], secret)) return problem(res, 401, "Unauthorized");
    }
    let input;
    try {
      input = await readBody(req);
    } catch (error) {
      return problem(res, error.status ?? 400, "Bad Request", error.message);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return problem(res, 422, "Unprocessable Content", "The input must be a JSON object");
    const header = (name) => (typeof req.headers[name] === "string" && req.headers[name] ? req.headers[name] : null);
    const ctx = {
      app: app.id,
      function: name,
      userId: header("x-gondol-user"),
      clientId: header("x-gondol-client"),
      actor: header("x-gondol-actor"),
      dev: !!dev,
      env,
    };
    try {
      const module = await serverModule(app);
      const handler = module[fn.export] ?? module.default?.[fn.export];
      if (typeof handler !== "function") return problem(res, 501, "Not Implemented", `The server module of ${app.id} exports no function "${fn.export}"`);
      const result = await handler(input, ctx);
      return sendJson(res, 200, result === undefined ? null : result);
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
      if (status >= 500) log.error(`gondol-apps: ${app.id}/${name}:`, error);
      return problem(res, status, status >= 500 ? "Internal Server Error" : "Request Failed", status >= 500 && !dev ? undefined : error?.message);
    }
  }

  /** Serves a file of the app's client: only from the client module's folder and its styles, never the server module. */
  function serveFile(req, res, app, rest) {
    if (req.method !== "GET" && req.method !== "HEAD") return problem(res, 405, "Method Not Allowed");
    const file = resolve(app.dir, decodeURIComponent(rest));
    const root = dirname(app.client) + sep;
    const allowed =
      (file.startsWith(root) || app.styles.includes(file)) &&
      file !== app.server &&
      !file.split(sep).some((part) => part.startsWith(".") || part === "node_modules");
    if (!allowed || !existsSync(file) || !statSync(file).isFile()) return problem(res, 404, "Not Found");
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      "Content-Length": statSync(file).size,
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  }

  return async function handle(req, res) {
    // Hosts import the modules cross-origin (and in dev, call functions from the browser).
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", dev ? "Content-Type, Authorization, x-gondol-user, x-gondol-app, x-gondol-function, x-gondol-actor" : "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", dev ? "GET, HEAD, POST, OPTIONS" : "GET, HEAD, OPTIONS");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url ?? "/", "http://runtime");
    const path = url.pathname;
    try {
      if (path === INDEX_PATH || path === "/") return sendJson(res, 200, index());
      const match = /^\/apps\/([^/]+)\/(.*)$/.exec(path);
      const app = match ? byId.get(decodeURIComponent(match[1])) : null;
      if (!match || !app) return problem(res, 404, "Not Found");
      const rest = match[2];
      if (rest === "manifest.json") return sendJson(res, 200, currentManifest(app));
      const fn = /^functions\/([^/]+)$/.exec(rest);
      if (fn) return await runFunction(req, res, app, decodeURIComponent(fn[1]));
      if (dev) {
        // Vite serves everything else under the app's base (/apps/<id>/), source files included.
        return dev.get(app.id).middlewares(req, res, () => problem(res, 404, "Not Found"));
      }
      return serveFile(req, res, app, rest);
    } catch (error) {
      log.error("gondol-apps:", error);
      if (!res.headersSent) problem(res, 500, "Internal Server Error");
    }
  };
}

/**
 * One Vite dev server per app (middleware mode, base /apps/<id>/), with gondol/vite/remoteApp so
 * the app imports the host's React and gondol. Their HMR sockets share `httpServer`.
 */
export async function createDevServers(apps, { httpServer, port, logLevel = "info" }) {
  const { createServer } = await import("vite");
  const { gondolRemoteApp } = await import("../vite/remoteApp.mjs");
  const servers = new Map();
  for (const app of apps) {
    if (!app.source.client) throw new Error(`${app.dir}: dev mode needs the client's source (package.json "gondol.source.client")`);
    const server = await createServer({
      root: app.dir,
      base: `/apps/${app.id}/`,
      configFile: false,
      logLevel,
      appType: "custom",
      plugins: [gondolRemoteApp({ root: app.dir })],
      server: {
        middlewareMode: true,
        hmr: { server: httpServer, path: `/apps/${app.id}/__hmr`, host: "localhost", clientPort: port, protocol: "ws" },
        cors: false,
      },
    });
    servers.set(app.id, server);
  }
  return servers;
}

/** Starts the runtime on `port` (dev: with Vite). Resolves to `{ server, url, close }`. */
export async function startAppsRuntime({ paths, port = 8787, host = "localhost", dev = false, env = process.env, log = console }) {
  const apps = findAppPackages(paths);
  if (!apps.length) throw new Error(`gondol-apps: no app packages (a package.json with a "gondol" field) in ${paths.join(", ")}`);
  const httpServer = createHttpServer();
  const devServers = dev ? await createDevServers(apps, { httpServer, port }) : null;
  const handle = createAppsRuntime({ apps, dev: devServers, env, log });
  httpServer.on("request", (req, res) => void handle(req, res));
  await new Promise((done, fail) => {
    httpServer.once("error", fail);
    httpServer.listen(port, host, done);
  });
  const address = httpServer.address();
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${typeof address === "object" && address ? address.port : port}`;
  return {
    server: httpServer,
    url,
    apps,
    close: async () => {
      for (const server of devServers?.values() ?? []) await server.close();
      await new Promise((done) => httpServer.close(() => done()));
    },
  };
}
