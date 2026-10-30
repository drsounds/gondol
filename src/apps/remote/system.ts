/**
 * GondolSystem: a System.js-style registry of the modules the host shares with apps it loads at run
 * time (remote apps, ./loader.ts). A remote app is plain ES modules (`.mjs`) built without React,
 * gondol or the other shared packages: each import of one became a small shim module that asks this
 * registry for the host's own instance (`await GondolSystem.import("react")`, written by
 * gondol/vite/remoteApp). So the app renders with the host's React, reads the host's query client and
 * router, and registers itself in the host's app registry instead of a copy of its own.
 *
 * The registry lives on `globalThis.GondolSystem`, which is where those shims look for it. Modules
 * are registered as loaders, so sharing gondol's whole public surface costs nothing until an app
 * imports a part of it.
 */

/** Loads one shared module: its namespace object (`import * as m from …`). */
export type SharedModuleLoader = () => Promise<Record<string, unknown>>;

export interface GondolSystemRegistry {
  /** The shared module's namespace; rejects when the host doesn't share `specifier`. */
  import(specifier: string): Promise<Record<string, unknown>>;
  /** Whether the host shares `specifier`. */
  has(specifier: string): boolean;
  /** Shares a module (or replaces its loader). */
  register(specifier: string, load: SharedModuleLoader): void;
  /** Every shared specifier, sorted. */
  specifiers(): string[];
}

declare global {
  var GondolSystem: GondolSystemRegistry | undefined;
}

/** Makes a registry; `installGondolSystem()` puts gondol's on `globalThis`. */
export function createGondolSystem(initial: Record<string, SharedModuleLoader> = {}): GondolSystemRegistry {
  const loaders = new Map<string, SharedModuleLoader>(Object.entries(initial));
  const loaded = new Map<string, Promise<Record<string, unknown>>>();
  return {
    import(specifier) {
      const cached = loaded.get(specifier);
      if (cached) return cached;
      const load = loaders.get(specifier);
      if (!load) {
        return Promise.reject(new Error(`GondolSystem: the host doesn't share "${specifier}" with remote apps (bundle it into the app, or ask the host to register it)`));
      }
      const promise = load().catch((error) => {
        loaded.delete(specifier);
        throw error;
      });
      loaded.set(specifier, promise);
      return promise;
    },
    has: (specifier) => loaders.has(specifier),
    register(specifier, load) {
      loaders.set(specifier, load);
      loaded.delete(specifier);
    },
    specifiers: () => [...loaders.keys()].sort(),
  };
}

/**
 * The packages every gondol host shares, as remote apps import them. A remote app must not bundle
 * its own copy of any of these: two Reacts break hooks, two query clients or routers see nothing of
 * each other. gondol/vite/remoteApp keeps the same list.
 */
const PACKAGES: Record<string, SharedModuleLoader> = {
  react: () => import("react"),
  "react/jsx-runtime": () => import("react/jsx-runtime"),
  "react/jsx-dev-runtime": () => import("react/jsx-dev-runtime"),
  "react-dom": () => import("react-dom"),
  "react-dom/client": () => import("react-dom/client"),
  "@tanstack/react-query": () => import("@tanstack/react-query"),
  "@tanstack/react-router": () => import("@tanstack/react-router"),
};

/** The registry on `globalThis`, made (with gondol's own modules and the shared packages) on first use. */
export function installGondolSystem(gondolModules: Record<string, SharedModuleLoader> = {}): GondolSystemRegistry {
  if (!globalThis.GondolSystem) globalThis.GondolSystem = createGondolSystem(PACKAGES);
  const system = globalThis.GondolSystem;
  for (const [specifier, load] of Object.entries(gondolModules)) if (!system.has(specifier)) system.register(specifier, load);
  return system;
}

/**
 * Shares the host's own modules with remote apps too (`{ "@myapp/models": () => import("./models") }`),
 * next to gondol's and the shared packages. Apps build against them as externals
 * (gondolRemoteApp({ shared: ["@myapp/models"] })).
 */
export function registerSharedModules(modules: Record<string, SharedModuleLoader>): void {
  const system = installGondolSystem();
  for (const [specifier, load] of Object.entries(modules)) system.register(specifier, load);
}

/**
 * `gondol/<path>` for a module file as `import.meta.glob` keys it from src/apps/remote/gondolModules.ts:
 * relative to that file ("../defineApp.ts" → "gondol/apps/defineApp", "../../index.ts" → "gondol"),
 * or absolute ("/node_modules/gondol/src/entities/EntitySheet.tsx"); the same subpaths as
 * package.json's exports.
 */
export function gondolSpecifier(globKey: string): string | null {
  if (!/\.tsx?$/.test(globKey)) return null;
  let path: string;
  if (globKey.startsWith(".")) {
    path = new URL(globKey, "file:///gondol/src/apps/remote/gondolModules.ts").pathname.replace(/^\/gondol\/src\//, "");
  } else {
    const at = globKey.indexOf("/src/");
    if (at === -1) return null;
    path = globKey.slice(at + "/src/".length);
  }
  path = path.replace(/\.tsx?$/, "").replace(/(^|\/)index$/, "");
  return path ? `gondol/${path}` : "gondol";
}
