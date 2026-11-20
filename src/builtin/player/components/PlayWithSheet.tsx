import { useEffect, useState, type CSSProperties } from "react";
import { EntitySheet } from "../../../entities/EntitySheet";
import { FormActions } from "../../../entities/FormActions";
import { useI18n } from "../../../i18n/i18n";
import { formatPlaybackTime, usePlayback } from "../../../playback/usePlayback";
import { musikLabel } from "../../../playback/musikUri";
import type { ServiceMatch } from "../../../playback/types";
import { PlaybackArt } from "./Controls";

/**
 * "Play with…" (Bungalow's ServiceMatchDialog): every match the music services found for an item,
 * by service, and "Always play this with this match", which saves the choice so the item plays
 * straight away next time. It opens when an item nothing has been chosen for is played, and from
 * "Play with…" to change the choice. A transient dialog, so it has no route of its own.
 */
export function PlayWithSheet() {
  const { t } = useI18n();
  const { choice } = usePlayback();
  const [picked, setPicked] = useState(0);
  const [always, setAlways] = useState(false);

  useEffect(() => {
    if (!choice) return;
    const current = choice.current;
    const at = current ? choice.matches.findIndex((m) => m.serviceId === current.serviceId && (m.candidate.uri ?? null) === (current.uri ?? null)) : -1;
    setPicked(Math.max(0, at));
    setAlways(!!current);
  }, [choice]);

  if (!choice) return null;
  const { request, matches } = choice;
  const name = request.title || musikLabel(request.uri) || request.uri;
  const match: ServiceMatch | undefined = matches[picked];
  const services = [...new Set(matches.map((m) => m.serviceName))];

  return (
    <div className="playback-choice">
      <EntitySheet
        title={t("playback.playWithTitle")}
        subtitle={name}
        onClose={() => choice.answer(null)}
        closeLabel={t("sheet.close")}
        onSubmit={(event) => {
          event.preventDefault();
          if (match) choice.answer({ match, always });
        }}
        footer={<FormActions onCancel={() => choice.answer(null)} cancelLabel={t("form.cancel")} submitLabel={t("playback.play")} submitDisabled={!match} />}
        preview={
          <div className="entity-preview">
            <div>
              <div className="entity-preview__kind">{match ? match.serviceName : t("playback.playWith")}</div>
              <div className="entity-preview__label">{match?.candidate.title ?? name}</div>
            </div>
            {match?.candidate.imageUrl ? (
              <div className="cover-preview">
                <span className="cover-frame" style={{ "--cover-aspect": 16 / 9 } as CSSProperties}>
                  <img src={match.candidate.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </span>
              </div>
            ) : null}
            <dl className="entity-preview__meta">
              <div>
                <dt>{t("playback.request")}</dt>
                <dd>{name}</dd>
              </div>
              {match?.candidate.artist ? (
                <div>
                  <dt>{t("playback.artist")}</dt>
                  <dd>{match.candidate.artist}</dd>
                </div>
              ) : null}
              {match?.candidate.durationMs ? (
                <div>
                  <dt>{t("playback.length")}</dt>
                  <dd>{formatPlaybackTime(match.candidate.durationMs)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t("playback.matchedOn")}</dt>
                <dd>{match?.candidate.byIsrc ? "ISRC" : t("playback.titleAndArtist")}</dd>
              </div>
            </dl>
          </div>
        }
      >
        <div className="stack">
          <p className="muted">{t("playback.playWithIntro", { count: matches.length, services: services.join(", ") })}</p>
          <div className="playback-matches" role="radiogroup" aria-label={t("playback.matches")}>
            {matches.map((m, index) => (
              <label key={`${m.serviceId}:${m.candidate.uri ?? index}`} className={index === picked ? "playback-match playback-match--picked" : "playback-match"}>
                <input type="radio" name="playback-match" checked={index === picked} onChange={() => setPicked(index)} />
                <PlaybackArt imageUrl={m.candidate.imageUrl} size="sm" />
                <span className="playback-match__text">
                  <span className="playback-match__title">{m.candidate.title}</span>
                  <span className="playback-match__meta">
                    {[m.serviceName, m.candidate.artist, m.candidate.durationMs ? formatPlaybackTime(m.candidate.durationMs) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <label className="bungalow-check">
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
            <span>{t("playback.always")}</span>
          </label>
        </div>
      </EntitySheet>
    </div>
  );
}
