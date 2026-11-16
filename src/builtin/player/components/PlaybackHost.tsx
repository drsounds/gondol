import { useEffect, type ReactNode } from "react";
import { useResolutions } from "../../../apps/contributions";
import { playback } from "../../../playback/coordinator";
import { setServiceAccountStore } from "../../../playback/accounts";
import { playbackHostHook } from "../../../playback/host";
import { serviceManager } from "../../../services/service";
import { accountsCache, databaseAccountStore } from "../models/accounts";
import { databaseResolutionStore } from "../models/resolutions";
import { playerDb } from "../models/db";

/**
 * Wires playback to the database while the player app is on: services keep their sessions as
 * external_service_accounts rows, "Play with…" choices go in playback_resolutions, and the apps'
 * answers to playbackHostHook turn their entity URIs into play requests.
 */
export function PlaybackHost({ children }: { children: ReactNode }) {
  useEffect(() => {
    setServiceAccountStore(databaseAccountStore());
    playback.setResolutionStore(databaseResolutionStore());
    const reload = () => void accountsCache.load().then(() => serviceManager.notify());
    reload();
    const { data } = playerDb().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") reload();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const hosts = useResolutions(playbackHostHook);
  useEffect(() => {
    const removers = hosts.map(({ value }) => (value.toPlayRequest ? playback.addRequestResolver((uri) => value.toPlayRequest!(uri)) : () => {}));
    return () => removers.forEach((remove) => remove());
  }, [hosts]);

  return <>{children}</>;
}
