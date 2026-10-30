import { gondolSpecifier, type SharedModuleLoader } from "./system";

/**
 * Gondol's public modules, as remote apps import them (`gondol/entities/EntitySheet`, …), each a
 * lazy loader so none is fetched before an app asks for it. Built by Vite's `import.meta.glob`, so
 * this module only works in a Vite build (the loader imports it on first use). Left out: build and
 * server code (vite, the api CLI), tests, and gondol's built-in apps except their models, since a
 * host builds in only some of them.
 */
const modules = import.meta.glob([
  "../../**/*.{ts,tsx}",
  "!../../**/*.test.{ts,tsx}",
  "!../../**/*.d.ts",
  "!../../vite/**",
  "!../../api/cli.ts",
  "!../../builtin/**",
  "../../builtin/*/models/**/*.ts",
  "!../../builtin/*/models/**/*.test.ts",
]) as Record<string, SharedModuleLoader>;

export const GONDOL_MODULES: Record<string, SharedModuleLoader> = Object.fromEntries(
  Object.entries(modules).flatMap(([key, load]) => {
    const specifier = gondolSpecifier(key);
    return specifier ? [[specifier, load]] : [];
  }),
);
