import type { InternalAppBundle, AppFeature, ManifestCapability } from "./types";
import { isSiteAspect, isSiteRole, mergeCapability, type Capability } from "../sites/capabilities";

/**
 * The app's internal app bundles, preregistered in its source code (registerApps). They can't be
 * deleted, but the user can switch each one on and off (see ./hooks).
 */
let internalApps: InternalAppBundle[] = [];
let internalAppsMap = new Map<string, InternalAppBundle>();

/** Registers the app's bundles, in menu order. Call it once, before rendering. */
export function registerApps(apps: InternalAppBundle[]): void {
  internalApps = [...internalApps.filter((app) => !apps.some((a) => a.id === app.id)), ...apps];
  internalAppsMap = new Map(internalApps.map((app) => [app.id, app]));
}

/** Retrieve all preregistered internal app bundles */
export function getInternalApps(): InternalAppBundle[] {
  return internalApps;
}

/** Retrieve an internal app bundle by its ID */
export function getInternalApp(id: string): InternalAppBundle | undefined {
  return internalAppsMap.get(id);
}

/** Check if an app ID corresponds to a preregistered internal bundle */
export function isInternalApp(id: string): boolean {
  return internalAppsMap.has(id);
}

/** Find a specific feature inside an app */
export function findFeature(appId: string, featureId: string): AppFeature | undefined {
  const app = getInternalApp(appId);
  return app?.features.find((f) => f.id === featureId);
}

const fromManifest = (declared: ManifestCapability | undefined): Capability => ({
  roles: declared?.roles?.filter(isSiteRole),
  aspects: declared?.aspects?.filter(isSiteAspect),
});

/**
 * A feature's roles and aspects (sites/capabilities.ts): the AppFeature's own, else its entry in
 * the manifest, else the manifest's app-wide ones, per dimension.
 */
export function featureCapability(app: InternalAppBundle, feature: AppFeature): Capability {
  return mergeCapability(feature, fromManifest(app.manifest.features.find((f) => f.id === feature.id)), fromManifest(app.manifest));
}
