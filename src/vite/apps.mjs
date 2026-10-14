// Build-time app selection: the virtual module `virtual:gondol/apps` default-exports the app
// bundles to build in, in menu order, and imports nothing else, so every app left out (and all of
// its code) is never part of the build. Pass the result to configureGondol({ apps }).
//
//   // vite.config.ts
//   import { gondolApps } from "gondol/vite/apps";
//   plugins: [gondolApps({ dir: "apps", order: ["finances", "wiki"] })]
//
// Each app is a folder of `dir` with a manifest.json and an index.ts(x) that default-exports its
// bundle (defineApp). Which apps: `include` (or the GONDOL_APPS environment variable, a
// comma-separated list of app ids; unset or "all" means every app), minus `exclude` (or
// GONDOL_EXCLUDE_APPS). The apps they depend on (manifest `dependencies`) always come along.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnv } from "vite";

const VIRTUAL = "virtual:gondol/apps";
const RESOLVED = `\0${VIRTUAL}`;

function list(value) {
  if (value == null) return null;
  const items = (Array.isArray(value) ? value : String(value).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length === 0 || (items.length === 1 && items[0] === "all") ? null : items;
}

/** Every app under `dir`: { id, dir, entry, dependencies }. */
export function discoverApps(dir) {
  const apps = [];
  for (const name of readdirSync(dir).sort()) {
    const appDir = join(dir, name);
    if (!statSync(appDir).isDirectory()) continue;
    const manifestPath = join(appDir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const entry = ["index.ts", "index.tsx"].map((file) => join(appDir, file)).find(existsSync);
    if (!entry) throw new Error(`gondol: ${appDir} has a manifest.json but no index.ts`);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`gondol: ${manifestPath} is not valid JSON: ${error.message}`);
    }
    if (typeof manifest.id !== "string" || !manifest.id) throw new Error(`gondol: ${manifestPath} has no id`);
    apps.push({ id: manifest.id, dir: appDir, entry, dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies : [] });
  }
  const seen = new Map();
  for (const app of apps) {
    if (seen.has(app.id)) throw new Error(`gondol: two apps with the id "${app.id}" (${seen.get(app.id)}, ${app.dir})`);
    seen.set(app.id, app.dir);
  }
  for (const app of apps) {
    for (const dependency of app.dependencies) {
      if (!seen.has(dependency)) throw new Error(`gondol: app "${app.id}" depends on "${dependency}", which doesn't exist`);
    }
  }
  return apps;
}

/**
 * The apps to build: `include` (null: all) and the apps they depend on, minus `exclude`, in
 * `order` (apps it doesn't name follow, by id). Throws when an excluded app is needed.
 */
export function selectApps(apps, { include = null, exclude = null, order = [] } = {}) {
  const byId = new Map(apps.map((app) => [app.id, app]));
  for (const id of [...(include ?? []), ...(exclude ?? []), ...order]) {
    if (!byId.has(id)) throw new Error(`gondol: no app "${id}" (apps: ${[...byId.keys()].join(", ")})`);
  }
  const selected = new Set();
  const add = (id) => {
    if (selected.has(id)) return;
    selected.add(id);
    for (const dependency of byId.get(id).dependencies) add(dependency);
  };
  for (const id of include ?? [...byId.keys()]) add(id);
  for (const id of exclude ?? []) selected.delete(id);
  for (const app of apps) {
    if (!selected.has(app.id)) continue;
    const missing = app.dependencies.filter((dependency) => !selected.has(dependency));
    if (missing.length) throw new Error(`gondol: can't leave out ${missing.map((m) => `"${m}"`).join(", ")}: "${app.id}" depends on it`);
  }
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  return apps.filter((app) => selected.has(app.id)).sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** The Vite plugin; see the top of this file. */
export function gondolApps(options = {}) {
  const { dir = "apps", order = [], include, exclude } = options;
  let selected = [];
  return {
    name: "gondol:apps",
    enforce: "pre",
    configResolved(config) {
      const env = { ...loadEnv(config.mode, config.envDir ?? config.root, "GONDOL_"), ...process.env };
      const appsDir = resolve(config.root, dir);
      const apps = discoverApps(appsDir);
      selected = selectApps(apps, {
        include: list(include) ?? list(env.GONDOL_APPS),
        exclude: list(exclude) ?? list(env.GONDOL_EXCLUDE_APPS),
        order,
      });
      if (selected.length < apps.length) {
        config.logger.info(`gondol: building ${selected.length} of ${apps.length} apps: ${selected.map((app) => app.id).join(", ")}`);
      }
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      const imports = selected.map((app, index) => `import app${index} from ${JSON.stringify(app.entry)};`);
      return [
        ...imports,
        `export const appIds = ${JSON.stringify(selected.map((app) => app.id))};`,
        `export default [${selected.map((_, index) => `app${index}`).join(", ")}];`,
        "",
      ].join("\n");
    },
  };
}
