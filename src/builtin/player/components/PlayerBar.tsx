import { useI18n } from "../../../i18n/i18n";
import { formatShortcut } from "../../../navigation/shortcuts";
import { playback } from "../../../playback/coordinator";
import { usePlayback } from "../../../playback/usePlayback";
import type { AppBottomWidgetProps } from "../../../apps/types";
import { setNowPlayingOpen, useNowPlayingOpen } from "../models/nowPlaying";
import { PLAYBACK_KEYS, PlaybackArt, SeekBar, Transport, VolumeControl, useNowPlayingText } from "./Controls";
import { ExpandIcon } from "./icons";

/**
 * The music player bar at the bottom (a bottom widget), like Spotify's: what plays and on which
 * service, the transport, the seek bar, "Play with…", Now playing and the volume. It shows while
 * there is something in the queue. On phones it is a mini player; tapping it opens Now playing.
 */
export function PlayerBar(_props: AppBottomWidgetProps) {
  const { t } = useI18n();
  const snapshot = usePlayback();
  const open = useNowPlayingOpen();
  const { title, artist, status, imageUrl } = useNowPlayingText();
  if (snapshot.queue.length === 0) return null;
  const openNowPlaying = () => setNowPlayingOpen(true);
  return (
    <section className="playback-bar" aria-label={t("playback.player")} data-state={snapshot.state} data-region="player">
      <div
        className="playback-bar__now"
        onClick={(event) => {
          // On phones the whole row opens Now playing; buttons keep their own job.
          if (!(event.target as HTMLElement).closest("button") && window.matchMedia("(max-width: 63.99rem)").matches) openNowPlaying();
        }}
      >
        <PlaybackArt imageUrl={imageUrl} size="sm" />
        <div className="playback-bar__text">
          <span className="playback-bar__title" title={title}>
            {title || t("playback.untitled")}
          </span>
          <span className="playback-bar__meta">{[artist, status].filter(Boolean).join(" · ")}</span>
        </div>
      </div>
      <div className="playback-bar__center">
        <Transport />
        <SeekBar />
      </div>
      <div className="playback-bar__side">
        <button
          type="button"
          className="playback-text-button"
          onClick={() => void playback.playWith()}
          disabled={snapshot.index < 0}
          title={`${t("playback.playWith")} (${formatShortcut(PLAYBACK_KEYS.playWith)})`}
        >
          {t("playback.playWith")}
        </button>
        <button
          type="button"
          className={open ? "playback-icon playback-icon--on" : "playback-icon"}
          aria-pressed={open}
          aria-label={t("playback.nowPlaying")}
          title={`${t("playback.nowPlaying")} (${formatShortcut(PLAYBACK_KEYS.nowPlaying)})`}
          onClick={() => setNowPlayingOpen(!open)}
        >
          <ExpandIcon />
        </button>
        <VolumeControl />
      </div>
    </section>
  );
}
