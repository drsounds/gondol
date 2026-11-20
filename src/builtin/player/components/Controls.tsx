import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../../../design-system/bungalow-79d923";
import { useI18n } from "../../../i18n/i18n";
import { formatShortcut } from "../../../navigation/shortcuts";
import { playback } from "../../../playback/coordinator";
import { isMusikUri } from "../../../playback/musikUri";
import { formatPlaybackTime, usePlayback } from "../../../playback/usePlayback";
import { useServicesList } from "../../../services/ConceptsHost";
import { MusicNoteIcon, RepeatIcon, ShuffleIcon, VolumeIcon } from "./icons";

/** The playback shortcuts, as the player's buttons show them (same as the app's actions). */
export const PLAYBACK_KEYS = {
  toggle: "Space",
  next: "Alt+Shift+ArrowRight",
  previous: "Alt+Shift+ArrowLeft",
  seekForward: "Shift+ArrowRight",
  seekBack: "Shift+ArrowLeft",
  volumeUp: "Alt+Shift+ArrowUp",
  volumeDown: "Alt+Shift+ArrowDown",
  mute: "Alt+Shift+M",
  shuffle: "Alt+S",
  repeat: "Alt+R",
  nowPlaying: "Alt+Shift+R",
  playWith: "Alt+Shift+P",
} as const;

const withKeys = (label: string, keys: string) => `${label} (${formatShortcut(keys)})`;

/** What is playing: the service's title when it has one, else the request's. */
export function useNowPlayingText() {
  const { t } = useI18n();
  const snapshot = usePlayback();
  const services = useServicesList();
  const request = snapshot.current?.request;
  const title = snapshot.track?.title || request?.title || (request ? request.uri : "");
  const artist = snapshot.track?.artist ?? request?.artist ?? "";
  const service = services.find((s) => s.id === snapshot.activeServiceId);
  const status = snapshot.choice
    ? t("playback.choosing")
    : snapshot.resolving
      ? t("playback.resolving")
      : snapshot.error === "unplayable"
        ? t("playback.unplayable")
        : snapshot.error
          ? snapshot.error
          : service
            ? t("playback.playingOn", { service: service.name })
            : "";
  return { title, artist, service, status, imageUrl: snapshot.track?.imageUrl ?? request?.imageUrl, isMusik: !!request && isMusikUri(request.uri) };
}

/** The item's picture: the service's (a video thumbnail), else a music note tile. */
export function PlaybackArt({ imageUrl, size = "md" }: { imageUrl?: string; size?: "sm" | "md" | "lg" }) {
  return imageUrl ? (
    <span className={`playback-art playback-art--${size}`} aria-hidden="true">
      <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
    </span>
  ) : (
    <span className={`playback-art playback-art--${size} playback-art--empty`} aria-hidden="true">
      <MusicNoteIcon />
    </span>
  );
}

/** Shuffle, previous, play/pause, next, repeat. */
export function Transport({ large = false }: { large?: boolean }) {
  const { t } = useI18n();
  const { state, shuffle, repeat, queue, resolving } = usePlayback();
  const playing = state === "playing" || state === "loading" || resolving;
  const empty = queue.length === 0;
  return (
    <div className={large ? "playback-transport playback-transport--large" : "playback-transport"} role="group" aria-label={t("playback.controls")}>
      <button
        type="button"
        className={shuffle ? "playback-icon playback-icon--on" : "playback-icon"}
        aria-pressed={shuffle}
        aria-label={t("playback.shuffle")}
        title={withKeys(t("playback.shuffle"), PLAYBACK_KEYS.shuffle)}
        onClick={() => playback.toggleShuffle()}
      >
        <ShuffleIcon />
      </button>
      <button type="button" className="playback-icon" aria-label={t("playback.previous")} title={withKeys(t("playback.previous"), PLAYBACK_KEYS.previous)} disabled={empty} onClick={() => playback.previous()}>
        <Icon name="skip-to-prev" />
      </button>
      <button
        type="button"
        className="playback-play"
        aria-label={playing ? t("playback.pause") : t("playback.play")}
        title={withKeys(playing ? t("playback.pause") : t("playback.play"), PLAYBACK_KEYS.toggle)}
        disabled={empty}
        onClick={() => playback.toggle()}
      >
        <Icon name={playing ? "pause" : "play"} />
      </button>
      <button type="button" className="playback-icon" aria-label={t("playback.next")} title={withKeys(t("playback.next"), PLAYBACK_KEYS.next)} disabled={empty} onClick={() => playback.next()}>
        <Icon name="skip-to-next" />
      </button>
      <button
        type="button"
        className={repeat !== "off" ? "playback-icon playback-icon--on" : "playback-icon"}
        aria-pressed={repeat !== "off"}
        aria-label={repeat === "one" ? t("playback.repeatOne") : repeat === "all" ? t("playback.repeatAll") : t("playback.repeat")}
        title={withKeys(repeat === "one" ? t("playback.repeatOne") : repeat === "all" ? t("playback.repeatAll") : t("playback.repeat"), PLAYBACK_KEYS.repeat)}
        onClick={() => playback.cycleRepeat()}
      >
        <RepeatIcon one={repeat === "one"} />
      </button>
    </div>
  );
}

/** The seek bar: a range input (arrow keys seek), with the times either side. */
export function SeekBar() {
  const { t } = useI18n();
  const { positionMs, durationMs, queue } = usePlayback();
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? positionMs;
  const max = Math.max(durationMs, 1);
  const commit = () => {
    if (drag !== null) playback.seek(drag);
    setDrag(null);
  };
  return (
    <div className="playback-seek">
      <span className="playback-seek__time">{formatPlaybackTime(value)}</span>
      <input
        type="range"
        className="playback-range"
        min={0}
        max={max}
        step={1000}
        value={Math.min(value, max)}
        disabled={queue.length === 0 || durationMs <= 0}
        aria-label={t("playback.seek")}
        aria-valuetext={`${formatPlaybackTime(value)} / ${formatPlaybackTime(durationMs)}`}
        style={{ "--range-fill": `${(Math.min(value, max) / max) * 100}%` } as CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="playback-seek__time">{formatPlaybackTime(durationMs)}</span>
    </div>
  );
}

/** Mute and volume. */
export function VolumeControl() {
  const { t } = useI18n();
  const { volume, muted } = usePlayback();
  const level = muted ? 0 : volume;
  return (
    <div className="playback-volume">
      <button
        type="button"
        className="playback-icon"
        aria-pressed={muted}
        aria-label={muted ? t("playback.unmute") : t("playback.mute")}
        title={withKeys(muted ? t("playback.unmute") : t("playback.mute"), PLAYBACK_KEYS.mute)}
        onClick={() => playback.toggleMute()}
      >
        <VolumeIcon level={level} />
      </button>
      <input
        type="range"
        className="playback-range playback-range--volume"
        min={0}
        max={100}
        step={5}
        value={Math.round(level * 100)}
        aria-label={t("playback.volume")}
        title={`${t("playback.volume")} (${formatShortcut(PLAYBACK_KEYS.volumeUp)} / ${formatShortcut(PLAYBACK_KEYS.volumeDown)})`}
        style={{ "--range-fill": `${level * 100}%` } as CSSProperties}
        onChange={(e) => playback.setVolume(Number(e.target.value) / 100)}
      />
    </div>
  );
}

/** Calls `onEscape` on Escape while `active` (for the views that open over the app). */
export function useEscape(active: boolean, onEscape: () => void) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
