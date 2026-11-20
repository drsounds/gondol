import type { InternalAppBundle, AppFeature, ManifestCapability } from "./types";
import { isSiteAspect, isSiteRole, mergeCapability, type Capability } from "../sites/capabilities";

/**
 * The app's internal app bundles, preregistered in its source code (registerApps). They can't be
 * deleted, but the user can switch each one on and off (see ./hooks).
 */
let staticApps: InternalAppBundle[] = [];
/** Bundles made at run time (from data: apps users build), by who registered them. */
const dynamicApps = new Map<string, InternalAppBundle[]>();
let internalApps: InternalAppBundle[] = [];
let internalAppsMap = new Map<string, InternalAppBundle>();
const listeners = new Set<() => void>();

function rebuild() {
  const dynamic = [...dynamicApps.values()].flat().filter((app) => !staticApps.some((s) => s.id === app.id));
  internalApps = [...staticApps, ...dynamic];
  internalAppsMap = new Map(internalApps.map((app) => [app.id, app]));
  for (const listener of listeners) listener();
}

/** Registers the app's bundles, in menu order. Call it once, before rendering. */
export function registerApps(apps: InternalAppBundle[]): void {
  staticApps = [...staticApps.filter((app) => !apps.some((a) => a.id === app.id)), ...apps];
  rebuild();
}

/**
 * Registers bundles made at run time, after the built-in ones (an app of user-built apps, e.g. the
 * studio app's): `owner` names the set, and each call replaces the owner's earlier set. They show
 * in the menu, the palette and routing like any app; ids of built-in apps are ignored.
 */
export function registerDynamicApps(owner: string, apps: InternalAppBundle[]): void {
  const previous = dynamicApps.get(owner) ?? [];
  if (previous.length === apps.length && previous.every((app, index) => app === apps[index])) return;
  if (apps.length) dynamicApps.set(owner, apps);
  else dynamicApps.delete(owner);
  rebuild();
}

/** Calls `listener` whenever the registered bundles change; returns the unsubscribe. */
export function subscribeApps(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Retrieve all registered app bundles: the built-in ones, then those made at run time. */
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
