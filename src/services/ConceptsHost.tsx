import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useActiveBundles } from "../apps/hooks";
import { conceptManager } from "./concept";
import { hasAspect, serviceManager, type Service, type ServiceAspect } from "./service";

/**
 * Keeps the concept manager in step with the apps that are on (activation, the site): apps that
 * come on are activated (their services registered and started), apps that go are deactivated.
 * The shell renders it once (AppShell).
 */
export function ConceptsHost() {
  const bundles = useActiveBundles();
  useEffect(() => {
    conceptManager.sync(bundles);
    serviceManager.startAll();
  }, [bundles]);
  useEffect(() => () => serviceManager.stopAll(), []);
  return null;
}

/** Every registered service, re-rendering when one comes, goes or tells the manager it changed. */
export function useServicesList(): readonly Service[] {
  return useSyncExternalStore(serviceManager.subscribe, serviceManager.all, serviceManager.all);
}

/** Every registered service with `aspect`. */
export function useServices<T>(aspect: ServiceAspect<T>): (Service & T)[] {
  const all = useServicesList();
  return useMemo(() => all.filter((service): service is Service & T => hasAspect(service, aspect)), [all, aspect]);
}
