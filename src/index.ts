import { registerApps } from "./apps/registry";
import { registerResolutions, resolutionsOf, type Resolution } from "./apps/contributions";
import { entityExtensionsHook, entityTypesHook, routingHook } from "./apps/shellHooks";
import { registerActionAspects } from "./sites/capabilities";
import { registerUuidPaths } from "./entities/useSlugRedirect";
import type { InternalAppBundle } from "./apps/types";
import { registerEntityArt, type EntityArtStyle } from "./entities/EntityArt";
import { registerEntityExtensions, type EntityExtensions } from "./entities/extensions";
import { registerEntitySources, type EntitySource } from "./entities/lookup";
import { configureEntityUris, registerEntityRoutes, registerShellSheetTypes, type EntityRoute } from "./entities/uri";
import type { EntityType } from "./register";
import { configureDesktopApp } from "./shell/desktopApp";
import { configureStorageNamespace } from "./shell/storage";
import { configureSettingsScopes } from "./settings/settings";
import { configureAppName } from "./sites/siteHead";

export type { Register, EntityType, MessageKey } from "./register";

/** Everything an app tells gondol about itself, in one place (see configureGondol). */
export interface GondolConfig {
  /** The app's name as its routes write it in page titles; a site's name replaces it there (sites/siteHead). */
  appName?: string;
  /** The entity URI scheme (`spacify` for spacify:supplier:acme), plus old namespaces still accepted. */
  uriScheme: string;
  legacyUriNamespaces?: string[];
  /** Prefix of gondol's localStorage keys and window events. */
  storageNamespace?: string;
  /** The desktop shells' public web origin and Electron bridge (see shell/desktopApp). */
  desktop?: { publicOrigin: string; bridge?: string };
  /**
   * The app's internal app bundles, in menu order (`virtual:gondol/apps` from gondol/vite/apps.mjs,
   * which builds in only the apps selected for the build). Their manifests and resolutions add
   * entity types, sources, art, sheet types, extensions and routing facts to `entities` below.
   */
  apps?: InternalAppBundle[];
  /**
   * App settings (gondol/settings/settings): `useWorkspaceId` is a hook returning the open
   * workspace's id (or null), for settings stored per workspace. Gondol has no workspaces of its own.
   */
  settings?: { useWorkspaceId?: () => string | null };
  /** The host's own answers to hooks (core navigation items, browse tiles, …), always there. */
  resolutions?: Resolution[];
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
  if (config.appName) configureAppName(config.appName);
  if (config.storageNamespace) configureStorageNamespace(config.storageNamespace);
  if (config.desktop) configureDesktopApp(config.desktop);
  if (config.settings) configureSettingsScopes(config.settings);
  if (config.apps) registerApps(config.apps);
  if (config.resolutions) registerResolutions(config.resolutions);
  const entities = config.entities ?? {};
  if (entities.routes) registerEntityRoutes(entities.routes, { staticPaths: entities.staticPaths });
  if (entities.sources) registerEntitySources(entities.sources);
  if (entities.art) registerEntityArt(entities.art);
  if (entities.shellSheetTypes) registerShellSheetTypes(entities.shellSheetTypes);
  if (entities.extensions) registerEntityExtensions(entities.extensions);
  registerAppContributions();
}

/**
 * What the apps (and the host's resolutions) declare about entities and routing. configureGondol
 * registers it; call it again after registering apps at run time (remote apps), which adds theirs.
 */
export function registerAppContributions(): void {
  const routes: Partial<Record<EntityType, EntityRoute>> = {};
  const sources: Partial<Record<EntityType, EntitySource>> = {};
  const art: Partial<Record<EntityType, EntityArtStyle>> = {};
  const sheetTypes: EntityType[] = [];
  for (const { value } of resolutionsOf(entityTypesHook)) {
    if (value.route) routes[value.type] = value.route;
    if (value.source) sources[value.type] = value.source;
    if (value.art) art[value.type] = value.art;
    if (value.sheet) sheetTypes.push(value.type);
  }
  const staticPaths: string[] = [];
  for (const { value } of resolutionsOf(routingHook)) {
    staticPaths.push(...(value.staticPaths ?? []));
    if (value.uuidPaths) registerUuidPaths(value.uuidPaths);
    if (value.menuAspects) registerActionAspects(value.menuAspects);
  }
  registerEntityRoutes(routes, { staticPaths });
  registerEntitySources(sources);
  registerEntityArt(art);
  registerShellSheetTypes(sheetTypes);
  for (const { value } of resolutionsOf(entityExtensionsHook)) registerEntityExtensions(value);
}
