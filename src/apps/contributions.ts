import { useMemo } from "react";
import { getInternalApps } from "./registry";
import { useActiveBundles } from "./hooks";
import { featureCapability } from "./registry";
import { useSiteOffers } from "../sites/capabilities";
import type { InternalAppBundle } from "./types";

/**
 * Hooks and resolutions: how the shell asks apps for things without knowing any of them.
 *
 * A **hook** is a named, typed question the shell (gondol, or the app built on it) asks: "which
 * items go in the navigation?", "what can be created?", "how is this entity type addressed?". An app
 * **answers** it with resolutions: values of the hook's type, declared in its manifest.json (which
 * defineApp turns into resolutions) or attached in code (`defineApp({ resolutions })`). The shell
 * only ever reads `resolutionsOf(hook)` / `useResolutions(hook)`, so an app that isn't built in, is
 * switched off, or isn't offered by the site simply contributes nothing.
 *
 * Define your own hooks with `defineHook<T>(id)` for extension points of your own shell.
 */
export interface Hook<T> {
  readonly id: string;
  /** Phantom: carries the answer type. */
  readonly __answer?: T;
}

/** A named extension point whose answers are `T`. Ids must be unique; gondol's own start with `gondol.`. */
export function defineHook<T>(id: string): Hook<T> {
  return { id };
}

/** One answer to a hook. `featureId` ties it to a feature, so it goes when a site doesn't offer that feature. */
export interface Resolution<T = unknown> {
  hook: Hook<T>;
  value: T;
  featureId?: string;
}

/** An answer to `hook`, for an app's `resolutions` (or registerResolutions). */
export function answer<T>(hook: Hook<T>, value: T, options: { featureId?: string } = {}): Resolution<T> {
  return { hook, value, featureId: options.featureId };
}

/** An answer with the app (and feature) it came from; `appId` is null for the host's own. */
export interface ResolvedAnswer<T> {
  value: T;
  appId: string | null;
  featureId?: string;
}

let hostResolutions: Resolution[] = [];

/** Answers from the host itself (not from an app): its own core items, which are always there. */
export function registerResolutions(resolutions: Resolution[]): void {
  hostResolutions = [...hostResolutions, ...resolutions];
}

function collect<T>(hook: Hook<T>, bundles: readonly InternalAppBundle[]): ResolvedAnswer<T>[] {
  const answers: ResolvedAnswer<T>[] = [];
  for (const resolution of hostResolutions) {
    if (resolution.hook.id === hook.id) answers.push({ value: resolution.value as T, appId: null, featureId: resolution.featureId });
  }
  for (const bundle of bundles) {
    for (const resolution of bundle.resolutions ?? []) {
      if (resolution.hook.id === hook.id) answers.push({ value: resolution.value as T, appId: bundle.id, featureId: resolution.featureId });
    }
  }
  return answers;
}

/**
 * Every answer to `hook` from the host and every registered app, whatever its state. For static
 * questions read once (entity addresses, sources, art): they hold for the life of the page.
 */
export function resolutionsOf<T>(hook: Hook<T>): ResolvedAnswer<T>[] {
  return collect(hook, getInternalApps());
}

/**
 * The answers to `hook` that apply now: the host's, and those of apps that are switched on and
 * allowed on this site, leaving out answers tied to a feature the site doesn't offer (its roles and
 * aspects, sites/capabilities.ts).
 */
export function useResolutions<T>(hook: Hook<T>): ResolvedAnswer<T>[] {
  const bundles = useActiveBundles();
  const offers = useSiteOffers();
  return useMemo(() => {
    const byId = new Map(bundles.map((bundle) => [bundle.id, bundle]));
    return collect(hook, bundles).filter((answer) => {
      if (!answer.appId || !answer.featureId) return true;
      const bundle = byId.get(answer.appId);
      const feature = bundle?.features.find((f) => f.id === answer.featureId);
      return !!bundle && !!feature && offers(featureCapability(bundle, feature));
    });
  }, [bundles, offers, hook]);
}
