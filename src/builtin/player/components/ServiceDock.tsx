import { useSyncExternalStore, type CSSProperties } from "react";
import { useI18n } from "../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../navigation/useEntityModal";
import { authAspect, type AuthAspect } from "../../../playback/types";
import { useActiveSurface, useServiceSlot } from "../../../playback/surfaces";
import { usePlayback } from "../../../playback/usePlayback";
import { hasAspect } from "../../../services/service";
import type { AppSidebarWidgetProps } from "../../../apps/types";
import { accountsCache } from "../models/accounts";
import { setNowPlayingOpen } from "../models/nowPlaying";
import { PlaybackArt, useNowPlayingText } from "./Controls";

/**
 * The service dock at the bottom of the desktop menu, like the album art in early Spotify: the
 * active service runs here, in its own embedded player (YouTube's), with its name and the account
 * it is signed in with. The player isn't a child of the dock: the service surface layer lays it
 * over the dock's slot, so it keeps playing when Now playing takes it to the stage and back.
 */
export function ServiceDock({ collapsed }: AppSidebarWidgetProps) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const snapshot = usePlayback();
  const { service, surface } = useActiveSurface();
  const { title, artist, imageUrl } = useNowPlayingText();
  const slotRef = useServiceSlot("dock");
  useSyncExternalStore(accountsCache.subscribe, accountsCache.getVersion, () => 0);
  if (collapsed || (!service && snapshot.queue.length === 0)) return null;
  const auth = service && hasAspect(service, authAspect) ? (service as AuthAspect) : null;
  const account = auth?.getAccount();
  return (
    <section className="service-dock" aria-label={t("playback.serviceDock")}>
      <div className="service-dock__head">
        <span className="service-dock__service">{service ? t("playback.playingOn", { service: service.name }) : t("playback.player")}</span>
        {auth ? (
          <button
            type="button"
            className="link-button service-dock__account"
            onClick={() => (account ? go("/music-services") : auth.login({ navigate: go }))}
            title={account ? t("playback.signedInAs", { name: account.name }) : t("playback.signIn")}
          >
            {account ? account.name : t("playback.signIn")}
          </button>
        ) : null}
      </div>
      {surface ? (
        <div
          ref={slotRef}
          className="service-dock__slot"
          style={{ "--stage-ratio": surface.aspectRatio ?? 16 / 9, "--service-surface-z": 15 } as CSSProperties}
          aria-label={t("playback.servicePlayer", { service: service?.name ?? "" })}
        />
      ) : (
        <button type="button" className="service-dock__art" onClick={() => setNowPlayingOpen(true)} aria-label={t("playback.nowPlaying")}>
          <PlaybackArt imageUrl={imageUrl} size="md" />
        </button>
      )}
      <button type="button" className="service-dock__now" onClick={() => setNowPlayingOpen(true)}>
        <span className="service-dock__title">{title || t("playback.untitled")}</span>
        {artist ? <span className="service-dock__artist">{artist}</span> : null}
      </button>
    </section>
  );
}
