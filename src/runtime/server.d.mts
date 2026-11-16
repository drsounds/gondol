import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { ViteDevServer } from "vite";

export const INDEX_PATH: string;

/** An app package as the runtime reads it (package.json `gondol` + manifest.json). */
export interface AppPackage {
  id: string;
  dir: string;
  pkg: Record<string, unknown>;
  name?: string;
  version?: string;
  manifestPath: string;
  manifest: Record<string, unknown> & { id: string };
  client: string;
  server: string | null;
  styles: string[];
  source: { client: string | null; server: string | null };
  /** Backend functions: manifest `functions` with `server` (the export answering them). */
  functions: { name: string; export: string }[];
}

/** What a backend function gets besides its input. */
export interface AppFunctionContext {
  app: string;
  function: string;
  /** The caller's user id in the host (null when signed out). */
  userId: string | null;
  /** The OAuth client calling for the user, if any. */
  clientId: string | null;
  /** The entity URI of an AI conversation or agent acting for the user, if any. */
  actor: string | null;
  dev: boolean;
  env: Record<string, string | undefined>;
}

export function loadAppPackage(dir: string): AppPackage;
export function findAppPackages(paths: string[]): AppPackage[];
export function secretFor(appId: string, env?: Record<string, string | undefined>): string | null;
export function createAppsRuntime(options: {
  apps: AppPackage[];
  dev?: Map<string, ViteDevServer> | null;
  env?: Record<string, string | undefined>;
  log?: Pick<Console, "error">;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export function createDevServers(apps: AppPackage[], options: { httpServer: Server; port: number; logLevel?: "info" | "warn" | "error" | "silent" }): Promise<Map<string, ViteDevServer>>;
export function startAppsRuntime(options: {
  paths: string[];
  port?: number;
  host?: string;
  dev?: boolean;
  env?: Record<string, string | undefined>;
  log?: Pick<Console, "error">;
}): Promise<{ server: Server; url: string; apps: AppPackage[]; close: () => Promise<void> }>;
