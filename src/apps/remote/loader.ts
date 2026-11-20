import { defineApp, type AppDefinition } from "../defineApp";
import { parseManifest } from "../manifest";
import { getInternalApp } from "../registry";
import type { InternalAppBundle } from "../types";
import { parseRemoteIndex, remoteIndexUrl, type RemoteAppEntry, type RemoteAppsIndex } from "./protocol";
import { installGondolSystem } from "./system";

/**
 * Loads apps from a gondol apps runtime (gondol/runtime) at run time, like the ones built into the
 * host: their manifest.json, their client module (native ES modules, `.mjs`, whose imports of React,
 * gondol and the other shared packages resolve to the host's own through GondolSystem, ./system.ts)
 * and their styles. Each becomes an app bundle the shell registers with registerDynamicApps, so its
 * pages route and show in the menu, its actions in the palette, and its widgets render.
 *
 * Remote apps run in the page with the user's session, like any app: add only sources you trust.
 * Their backend functions are another matter: the app router serves those only after an admin
 * approves them (see the remote apps guide).
 */

/** An apps runtime to load from: its address (or its index URL). `dev`: a `gondol-apps dev` server on this device. */
export interface RemoteAppSource {
  url: string;
  dev?: boolean;
}

export type FetchJson = (url: string) => Promise<unknown>;

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-cache" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return await response.json();
}

/** Imports a module by URL, outside the bundler (Vite leaves `@vite-ignore` imports alone). */
const defaultImportModule = (url: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ url);

export interface LoadOptions {
  fetchJson?: FetchJson;
  importModule?: (url: string) => Promise<Record<string, unknown>>;
  /** Shares gondol's own modules before the first app loads (the default loads gondolModules.ts, a Vite-only module). */
  shareGondol?: () => Promise<void>;
}

let gondolShared: Promise<void> | null = null;

async function shareGondolModules(): Promise<void> {
  gondolShared ??= import("./gondolModules").then(({ GONDOL_MODULES }) => {
    installGondolSystem(GONDOL_MODULES);
  });
  return await gondolShared;
}

/** Reads a source's index. */
export async function fetchRemoteIndex(source: RemoteAppSource, options: LoadOptions = {}): Promise<RemoteAppsIndex> {
  const indexUrl = remoteIndexUrl(source.url);
  return parseRemoteIndex(await (options.fetchJson ?? defaultFetchJson)(indexUrl), indexUrl);
}

const isBundle = (value: unknown): value is InternalAppBundle =>
  !!value && typeof value === "object" && (value as InternalAppBundle).isInternal === true && Array.isArray((value as InternalAppBundle).features);

/** Loads one app of an index as an app bundle (registering it is up to the caller). */
export async function loadRemoteApp(source: RemoteAppSource, index: RemoteAppsIndex, entry: RemoteAppEntry, options: LoadOptions = {}): Promise<InternalAppBundle> {
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  installGondolSystem();
  await (options.shareGondol ?? shareGondolModules)();
  const manifest = parseManifest(await fetchJson(entry.manifest));
  if (manifest.id !== entry.id) throw new Error(`${entry.manifest} is the manifest of "${manifest.id}", not "${entry.id}"`);
  const missing = manifest.dependencies.filter((id) => !getInternalApp(id));
  if (missing.length) throw new Error(`app "${manifest.id}" needs ${missing.map((id) => `"${id}"`).join(", ")}, which this host doesn't have`);

  const module = await (options.importModule ?? defaultImportModule)(entry.client);
  const exported = module.default;
  if (!exported || typeof exported !== "object") throw new Error(`${entry.client} has no default export (export default defineApp({ manifest, pages }))`);
  const bundle = isBundle(exported) ? exported : defineApp({ ...(exported as Omit<AppDefinition, "manifest">), manifest });
  if (bundle.id !== manifest.id) throw new Error(`${entry.client} defines the app "${bundle.id}", not "${manifest.id}"`);

  return {
    ...bundle,
    remote: {
      source: source.url,
      indexUrl: remoteIndexUrl(source.url),
      clientUrl: entry.client,
      styles: entry.styles ?? [],
      ...(entry.version ? { version: entry.version } : {}),
      dev: !!(source.dev || index.dev),
      functions: entry.functions ?? [],
      ...(entry.functionsUrl ? { functionsUrl: entry.functionsUrl } : {}),
    },
  };
}

/** What became of one source: its apps, or why it (or one of its apps) failed. */
export interface RemoteSourceStatus {
  source: string;
  state: "loading" | "ready" | "error";
  error?: string;
  apps: { id: string; name?: string; error?: string }[];
}

/** Loads every app of every source; a failing source or app is reported, never thrown. */
export async function loadRemoteApps(
  sources: RemoteAppSource[],
  options: LoadOptions = {},
): Promise<{ bundles: InternalAppBundle[]; statuses: RemoteSourceStatus[] }> {
  const bundles: InternalAppBundle[] = [];
  const statuses = await Promise.all(
    sources.map(async (source): Promise<RemoteSourceStatus> => {
      let index: RemoteAppsIndex;
      try {
        index = await fetchRemoteIndex(source, options);
      } catch (error) {
        return { source: source.url, state: "error", error: message(error), apps: [] };
      }
      const apps = await Promise.all(
        index.apps.map(async (entry) => {
          try {
            const bundle = await loadRemoteApp(source, index, entry, options);
            bundles.push(bundle);
            return { id: entry.id, name: bundle.name };
          } catch (error) {
            console.error(`gondol: remote app "${entry.id}" from ${source.url}:`, error);
            return { id: entry.id, ...(entry.name ? { name: entry.name } : {}), error: message(error) };
          }
        }),
      );
      return { source: source.url, state: "ready", apps };
    }),
  );
  // One id once: the first source listing it wins (built-in ids are ignored by registerDynamicApps).
  const seen = new Set<string>();
  return { bundles: bundles.filter((bundle) => !seen.has(bundle.id) && !!seen.add(bundle.id)), statuses };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Adds an app's stylesheets to the page once; returns their removal. */
export function addRemoteStyles(appId: string, urls: string[]): () => void {
  if (typeof document === "undefined" || !urls.length) return () => undefined;
  const links = urls
    .filter((href) => !document.querySelector(`link[data-gondol-remote-app][href="${CSS.escape(href)}"]`))
    .map((href) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.crossOrigin = "anonymous";
      link.dataset.gondolRemoteApp = appId;
      document.head.appendChild(link);
      return link;
    });
  return () => links.forEach((link) => link.remove());
}
