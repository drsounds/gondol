import { useEffect, useMemo, useSyncExternalStore } from "react";
import { registerAppContributions } from "../../index";
import { registerDynamicApps } from "../registry";
import { addRemoteStyles, loadRemoteApps, type LoadOptions, type RemoteAppSource, type RemoteSourceStatus } from "./loader";

/** The registry owner remote apps are registered under (registerDynamicApps). */
export const REMOTE_APPS_OWNER = "remote";

let statuses: RemoteSourceStatus[] = [];
const listeners = new Set<() => void>();

function setStatuses(next: RemoteSourceStatus[]) {
  statuses = next;
  for (const listener of listeners) listener();
}

/** What became of each source the registrar loads: its apps, or why it failed. For an apps catalogue. */
export function useRemoteAppStatuses(): RemoteSourceStatus[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => statuses,
    () => statuses,
  );
}

/**
 * Loads the apps of `sources` (gondol apps runtimes) and registers them like built-in apps, so their
 * pages route and show in the menu (registerDynamicApps). Renders nothing; render it once, inside
 * the shell's providers, with the sources the user (and, in developer mode, this device) has. A
 * changed list reloads; apps of a source that went away are unregistered.
 */
export function RemoteAppsRegistrar({ sources, options }: { sources: RemoteAppSource[]; options?: LoadOptions }) {
  const key = useMemo(() => JSON.stringify(sources.map((source) => [source.url, !!source.dev])), [sources]);

  useEffect(() => {
    const list: RemoteAppSource[] = JSON.parse(key).map(([url, dev]: [string, boolean]) => ({ url, dev }));
    if (!list.length) {
      registerDynamicApps(REMOTE_APPS_OWNER, []);
      setStatuses([]);
      return;
    }
    let cancelled = false;
    let removeStyles: (() => void)[] = [];
    setStatuses(list.map((source) => ({ source: source.url, state: "loading", apps: [] })));
    loadRemoteApps(list, options).then(({ bundles, statuses: loaded }) => {
      if (cancelled) return;
      removeStyles = bundles.map((bundle) => addRemoteStyles(bundle.id, bundle.remote?.styles ?? []));
      registerDynamicApps(REMOTE_APPS_OWNER, bundles);
      // Their entity types, sources and art, like the built-in apps' (registered at configureGondol).
      registerAppContributions();
      setStatuses(loaded);
    });
    return () => {
      cancelled = true;
      removeStyles.forEach((remove) => remove());
    };
    // `options` is read once per list of sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => registerDynamicApps(REMOTE_APPS_OWNER, []), []);
  return null;
}
