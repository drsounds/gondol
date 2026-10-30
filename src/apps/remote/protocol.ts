/**
 * What a gondol apps runtime (gondol/runtime/server.mjs) serves, as the browser loader reads it.
 *
 *   GET  <runtime>/gondol-apps.json              the index: every app it serves (RemoteAppsIndex)
 *   GET  <runtime>/apps/<id>/manifest.json       an app's manifest
 *   GET  <runtime>/apps/<id>/<file>              its client modules (.mjs) and styles
 *   POST <runtime>/apps/<id>/functions/<name>    a backend function (manifest `functions.<name>.server`)
 *
 * A source the user adds is a runtime's address (its index is `<url>/gondol-apps.json`) or the index's
 * own URL. Entry URLs in the index may be relative to the index.
 */

export const REMOTE_APPS_FORMAT = "gondol-apps";
export const REMOTE_APPS_VERSION = 1;
export const REMOTE_APPS_INDEX = "gondol-apps.json";

/** One app of a runtime's index. */
export interface RemoteAppEntry {
  id: string;
  /** The package's version (package.json). */
  version?: string;
  name?: string;
  /** Its manifest.json. */
  manifest: string;
  /** Its client entry, an ES module whose default export is `defineApp(…)` (or what defineApp takes, without `manifest`). */
  client: string;
  /** Stylesheets to add to the page with it. */
  styles?: string[];
  /** The names of its backend functions (manifest `functions` answered by the runtime's `server` module). */
  functions?: string[];
  /** Where those functions are served: `<base>/<name>`. */
  functionsUrl?: string;
}

export interface RemoteAppsIndex {
  format: typeof REMOTE_APPS_FORMAT;
  version: number;
  /** Served by `gondol-apps dev`: client modules come straight from Vite, backend functions are called directly. */
  dev?: boolean;
  apps: RemoteAppEntry[];
}

/** The index URL of a source: the address itself when it names a .json file, else `<address>/gondol-apps.json`. */
export function remoteIndexUrl(source: string): string {
  const url = new URL(source.trim());
  if (/\.json$/i.test(url.pathname)) return url.toString();
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${REMOTE_APPS_INDEX}`;
  return url.toString();
}

/** Checks a fetched index and makes its URLs absolute (against the index's own URL). */
export function parseRemoteIndex(json: unknown, indexUrl: string): RemoteAppsIndex {
  const fail = (message: string): never => {
    throw new Error(`${indexUrl} is not a gondol apps index: ${message}`);
  };
  if (!json || typeof json !== "object") fail("not a JSON object");
  const index = json as Partial<RemoteAppsIndex>;
  if (index.format !== REMOTE_APPS_FORMAT) fail(`"format" must be "${REMOTE_APPS_FORMAT}"`);
  if (typeof index.version !== "number" || index.version > REMOTE_APPS_VERSION) fail(`unsupported version ${String(index.version)}`);
  if (!Array.isArray(index.apps)) fail(`"apps" must be a list`);
  const absolute = (value: unknown, what: string) => {
    if (typeof value !== "string" || !value) fail(`${what} is missing`);
    const url = new URL(value as string, indexUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") fail(`${what} must be an http(s) URL`);
    return url.toString();
  };
  const apps = index.apps!.map((entry, i): RemoteAppEntry => {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(entry.id)) fail(`apps[${i}].id must be a lower-case id`);
    return {
      id: entry.id,
      ...(typeof entry.version === "string" ? { version: entry.version } : {}),
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      manifest: absolute(entry.manifest, `apps[${i}].manifest`),
      client: absolute(entry.client, `apps[${i}].client`),
      styles: (Array.isArray(entry.styles) ? entry.styles : []).map((style, s) => absolute(style, `apps[${i}].styles[${s}]`)),
      functions: (Array.isArray(entry.functions) ? entry.functions : []).filter((name): name is string => typeof name === "string"),
      ...(entry.functionsUrl ? { functionsUrl: absolute(entry.functionsUrl, `apps[${i}].functionsUrl`) } : {}),
    };
  });
  return { format: REMOTE_APPS_FORMAT, version: index.version!, dev: index.dev === true, apps };
}

/**
 * A stable fingerprint of what an app's backend may do (its manifest's `functions` and `mcp`), so an
 * approval holds for exactly what an admin saw: a changed function list, input schema or tool needs
 * approving again. Key order doesn't matter.
 */
export function backendFingerprint(manifest: { functions?: unknown; mcp?: unknown }): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical({ functions: manifest.functions ?? {}, mcp: manifest.mcp ?? null }));
}
