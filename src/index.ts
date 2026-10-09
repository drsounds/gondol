import { registerApps } from "./apps/registry";
import type { InternalAppBundle } from "./apps/types";
import { registerEntityArt, type EntityArtStyle } from "./entities/EntityArt";
import { registerEntityExtensions, type EntityExtensions } from "./entities/extensions";
import { registerEntitySources, type EntitySource } from "./entities/lookup";
import { configureEntityUris, registerEntityRoutes, registerShellSheetTypes, type EntityRoute } from "./entities/uri";
import type { EntityType } from "./register";
import { configureDesktopApp } from "./shell/desktopApp";
import { configureStorageNamespace } from "./shell/storage";

export type { Register, EntityType, MessageKey } from "./register";

/** Everything an app tells gondol about itself, in one place (see configureGondol). */
export interface GondolConfig {
  /** The entity URI scheme (`spacify` for spacify:supplier:acme), plus old namespaces still accepted. */
  uriScheme: string;
  legacyUriNamespaces?: string[];
  /** Prefix of gondol's localStorage keys and window events. */
  storageNamespace?: string;
  /** The desktop shells' public web origin and Electron bridge (see shell/desktopApp). */
  desktop?: { publicOrigin: string; bridge?: string };
  /** The app's internal app bundles, in menu order. */
  apps?: InternalAppBundle[];
  entities?: {
    /** Each type's public addresses, and static sub-routes that share a path with keys. */
    routes?: Partial<Record<EntityType, EntityRoute>>;
    staticPaths?: Iterable<string>;
    /** Where each type's rows live and how to name one. */
    sources?: Partial<Record<EntityType, EntitySource>>;
    /** Each type's tile glyph and hue. */
    art?: Partial<Record<EntityType, EntityArtStyle>>;
    /** Types that open in a sheet owned by the shell rather than a route. */
    shellSheetTypes?: EntityType[];
    /** Hooks the app's own apps provide (covers, tags). */
    extensions?: Partial<EntityExtensions>;
  };
}

/**
 * Configures gondol for an app. Call it once, from a module the app's router imports first, before
 * anything renders.
 */
export function configureGondol(config: GondolConfig): void {
  configureEntityUris({ scheme: config.uriScheme, legacyNamespaces: config.legacyUriNamespaces });
  if (config.storageNamespace) configureStorageNamespace(config.storageNamespace);
  if (config.desktop) configureDesktopApp(config.desktop);
  if (config.apps) registerApps(config.apps);
  const entities = config.entities ?? {};
  if (entities.routes) registerEntityRoutes(entities.routes, { staticPaths: entities.staticPaths });
  if (entities.sources) registerEntitySources(entities.sources);
  if (entities.art) registerEntityArt(entities.art);
  if (entities.shellSheetTypes) registerShellSheetTypes(entities.shellSheetTypes);
  if (entities.extensions) registerEntityExtensions(entities.extensions);
}
