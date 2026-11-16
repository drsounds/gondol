import { useEffect, useRef, type CSSProperties } from "react";
import { useI18n } from "../../../i18n/i18n";
import { playback } from "../../../playback/coordinator";
import { useActiveSurface, useServiceSlot } from "../../../playback/surfaces";
import { formatPlaybackTime, usePlayback } from "../../../playback/usePlayback";
import { setNowPlayingOpen, useNowPlayingOpen } from "../models/nowPlaying";
import { PlaybackArt, SeekBar, Transport, VolumeControl, useEscape, useNowPlayingText } from "./Controls";
import { ChevronDownIcon } from "./icons";

/**
 * Now playing, the full-screen player. It is always mounted while the player app is on and shown
 * or hidden with `visibility` (and `inert`), never by mounting it, so the stage inside it can hold
 * a service's player (YouTube's) that keeps playing when it closes: the service surface layer lays
 * the active service's player over the stage while it shows, and over the menu's dock otherwise.
 */
export function NowPlayingView() {
  const { t } = useI18n();
  const open = useNowPlayingOpen();
  const snapshot = usePlayback();
  const { title, artist, status, imageUrl } = useNowPlayingText();
  const { surface } = useActiveSurface();
  const stageRef = useServiceSlot("stage");
  const viewRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Opening moves focus into the view; closing gives it back.
  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      viewRef.current?.focus();
    } else if (returnFocus.current?.isConnected) {
      returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [open]);
  // Nothing to show: close.
  useEffect(() => {
    if (snapshot.queue.length === 0) setNowPlayingOpen(false);
  }, [snapshot.queue.length]);
  useEscape(open, () => setNowPlayingOpen(false));

  const upNext = snapshot.queue.slice(snapshot.index + 1);
  const ratio = surface?.aspectRatio ?? 16 / 9;

  return (
    <div
      ref={viewRef}
      className="playback-now"
      data-open={open || undefined}
      role="dialog"
      aria-modal={open || undefined}
      aria-hidden={!open || undefined}
      aria-label={t("playback.nowPlaying")}
      tabIndex={-1}
      // Hidden, it keeps its place in the DOM (and the stage's player keeps playing), but is out of
      // the way of the mouse, the keyboard and screen readers.
      inert={!open || undefined}
    >
      <header className="playback-now__head">
        <button type="button" className="playback-icon" onClick={() => setNowPlayingOpen(false)} aria-label={t("playback.closeNowPlaying")} title={t("playback.closeNowPlaying")}>
          <ChevronDownIcon />
        </button>
        <div className="playback-now__context">
          <span className="playback-now__eyebrow">{t("playback.playingFrom")}</span>
          <span className="playback-now__context-name">{snapshot.context?.label ?? t("playback.queue")}</span>
        </div>
        <button type="button" className="playback-text-button" onClick={() => void playback.playWith()} disabled={snapshot.index < 0}>
          {t("playback.playWith")}
        </button>
      </header>

      <div className="playback-now__body">
        <div className="playback-now__main">
          {surface ? (
            <div ref={stageRef} className="playback-now__stage" style={{ "--stage-ratio": ratio, "--service-surface-z": 103 } as CSSProperties} />
          ) : (
            <div className="playback-now__art">
              <PlaybackArt imageUrl={imageUrl} size="lg" />
            </div>
          )}
          <div className="playback-now__text">
            <h2 className="playback-now__title">{title || t("playback.untitled")}</h2>
            <p className="playback-now__artist">{[artist, status].filter(Boolean).join(" · ")}</p>
          </div>
          <SeekBar />
          <Transport large />
          <VolumeControl />
        </div>

        <aside className="playback-now__queue" aria-label={t("playback.upNext")}>
          <h3 className="playback-now__queue-title">{t("playback.upNext")}</h3>
          {upNext.length === 0 ? (
            <p className="muted">{t("playback.queueEnd")}</p>
          ) : (
            <ol className="playback-queue">
              {upNext.map((item, offset) => {
                const index = snapshot.index + 1 + offset;
                return (
                  <li key={item.key} className="playback-queue__row">
                    <button type="button" className="playback-queue__play" onClick={() => void playback.playAt(index, { interactive: true })}>
                      <span className="playback-queue__title">{item.request.title || item.request.uri}</span>
                      <span className="playback-queue__meta">
                        {[item.request.artist, item.request.durationMs ? formatPlaybackTime(item.request.durationMs) : null].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    <button type="button" className="playback-icon" aria-label={t("playback.removeFromQueue", { title: item.request.title || item.request.uri })} onClick={() => playback.removeFromQueue(item.key)}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
