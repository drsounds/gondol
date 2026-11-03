import type { Plugin } from "vite";

/** The packages every gondol host shares with remote apps. */
export const SHARED_PACKAGES: string[];

export interface GondolRemoteAppOptions {
  /** Modules the host shares on top of gondol's (registerSharedModules), with their export names. */
  shared?: Record<string, string[]>;
  /** Where the app's package.json is (default: Vite's root). */
  root?: string;
}

export function isSharedSpecifier(specifier: string, extra?: string[]): boolean;
export function stripCommentsAndStrings(source: string): string;
export function scanExports(file: string, seen?: Set<string>): Set<string>;
export function gondolModuleFile(gondolDir: string, specifier: string): string | null;
export function shimSource(specifier: string, names: Set<string>): string;
export function gondolRemoteApp(options?: GondolRemoteAppOptions): Plugin;
