import type { Plugin } from "vite";

export interface GondolAppsOptions {
  /** The folder holding one folder per app (manifest.json + index.ts). Default `apps` (a top-level folder outside `src/`). */
  dir?: string;
  /** Menu order by app id; apps it doesn't name follow, by id. */
  order?: string[];
  /** The apps to build (default: GONDOL_APPS, else all); the apps they depend on come along. */
  include?: string[] | string;
  /** Apps to leave out (default: GONDOL_EXCLUDE_APPS). */
  exclude?: string[] | string;
}

export interface DiscoveredApp {
  id: string;
  dir: string;
  entry: string;
  dependencies: string[];
}

export function discoverApps(dir: string): DiscoveredApp[];
export function selectApps(
  apps: DiscoveredApp[],
  options?: { include?: string[] | null; exclude?: string[] | null; order?: string[] },
): DiscoveredApp[];
export function gondolApps(options?: GondolAppsOptions): Plugin;
