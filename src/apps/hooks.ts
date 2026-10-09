import { useEffect, useState, useCallback, useMemo } from "react";
import type { InternalAppBundle, UnifiedApp } from "./types";
import { getInternalApp, getInternalApps } from "./registry";
import { siteAllowsApp, useSite } from "../sites/sites";
import { namespaced } from "../shell/storage";

/** The apps an internal app depends on, for the site's app list (src/lib/sites.tsx). */
const appDependencies = (id: string) => getInternalApp(id)?.dependencies ?? [];

const activationKey = (appId: string) => namespaced(`app:active:${appId}`);
const activationEvent = () => namespaced("app-activation-change");

/** Read the stored activation state of an app bundle */
export function getAppActivation(appId: string, defaultActive = true): boolean {
  if (typeof window === "undefined") return defaultActive;
  try {
    const raw = window.localStorage.getItem(activationKey(appId));
    if (raw === null) return defaultActive;
    return raw === "true";
  } catch {
    return defaultActive;
  }
}

/** Set the activation state of an app bundle and notify listeners */
export function setAppActivation(appId: string, active: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(activationKey(appId), String(active));
    window.dispatchEvent(
      new CustomEvent(activationEvent(), { detail: { appId, active } })
    );
  } catch {
    // ignore local storage errors
  }
}

/**
 * Hook to read and control the activation state of an internal app bundle.
 * Reacts across components and browser windows in real-time.
 */
export function useAppActivation(appId: string, defaultActive = true) {
  const [isActive, setIsActive] = useState<boolean>(() =>
    getAppActivation(appId, defaultActive)
  );

  useEffect(() => {
    setIsActive(getAppActivation(appId, defaultActive));

    const handleCustomEvent = (e: Event) => {
      const custom = e as CustomEvent<{ appId: string; active: boolean }>;
      if (!custom.detail || custom.detail.appId === appId) {
        setIsActive(getAppActivation(appId, defaultActive));
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === activationKey(appId) || e.key === null) {
        setIsActive(getAppActivation(appId, defaultActive));
      }
    };

    window.addEventListener(activationEvent(), handleCustomEvent);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(activationEvent(), handleCustomEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, [appId, defaultActive]);

  const activate = useCallback(() => setAppActivation(appId, true), [appId]);
  const deactivate = useCallback(() => setAppActivation(appId, false), [appId]);
  const toggle = useCallback(() => setAppActivation(appId, !isActive), [appId, isActive]);

  return { isActive, activate, deactivate, toggle };
}

/**
 * Hook to retrieve an internal app bundle by ID along with its activation controls.
 */
export function useAppBundle(appId: string) {
  const bundle = useMemo(() => getInternalApp(appId), [appId]);
  const activation = useAppActivation(appId, bundle?.defaultActive ?? true);
  const { site } = useSite();
  const siteDisabled = !siteAllowsApp(site, appId, appDependencies);

  return {
    bundle,
    isInternal: !!bundle,
    ...activation,
    isActive: activation.isActive && !siteDisabled,
    /** Turned off by the site served on this domain; the user can't switch it on here. */
    siteDisabled,
  };
}

/**
 * Hook to retrieve all registered internal app bundles and their live activation states.
 */
export function useRegisteredBundles() {
  const bundles = useMemo(() => getInternalApps(), []);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleUpdate = () => setVersion((v) => v + 1);
    window.addEventListener(activationEvent(), handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(activationEvent(), handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const { site } = useSite();
  const bundlesWithState = useMemo(() => {
    return bundles.map((bundle) => {
      // Apps the site on this domain leaves out are off, whatever the user's own switch says.
      const siteDisabled = !siteAllowsApp(site, bundle.id, appDependencies);
      return {
        ...bundle,
        isActive: !siteDisabled && getAppActivation(bundle.id, bundle.defaultActive ?? true),
        siteDisabled,
      };
    });
  }, [bundles, version, site]);

  return bundlesWithState;
}

/**
 * Hook to get only active internal app bundles.
 */
export function useActiveBundles() {
  const bundles = useRegisteredBundles();
  return useMemo(() => bundles.filter((b) => b.isActive), [bundles]);
}

/**
 * Hook to look up a feature within an app bundle.
 */
export function useAppFeature(appId: string, featureId?: string) {
  const { bundle, isActive, activate, deactivate, toggle } = useAppBundle(appId);

  const feature = useMemo(() => {
    if (!bundle) return undefined;
    if (featureId) {
      return bundle.features.find((f) => f.id === featureId);
    }
    return bundle.features.find((f) => f.id === bundle.defaultFeatureId) ?? bundle.features[0];
  }, [bundle, featureId]);

  return {
    bundle,
    feature,
    isActive,
    activate,
    deactivate,
    toggle,
  };
}

