import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../design-system/bungalow-79d923";
import { useI18n } from "../i18n/i18n";
import { copyText, showToast } from "../shell/clipboard";
import { useSiteOffers } from "../sites/capabilities";
import { EntityArt, EntityArtTile } from "./EntityArt";
import { entityExtensions, type ShareTarget } from "./extensions";
import { useEntityLifecycle } from "./lifecycle";
import { entityTypeLabel } from "./lookup";
import { shareUri, shareUrl, useShareKey } from "./shareUri";
import { parseEntityUri } from "./uri";

interface ShareSheetProps {
  /** spacify: URI of the entity (by uuid, as ActionMenu gets it). */
  uri: string;
  name: string;
  onClose: () => void;
}

function LinkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

function UriIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

/** The share glyph (an arrow out of a box), for buttons that open the share sheet. */
export function ShareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function TargetArt({ target }: { target: ShareTarget }) {
  const parsed = target.uri ? parseEntityUri(target.uri) : null;
  return parsed ? (
    <EntityArt type={parsed.entityType} title={target.name} size="sm" uri={target.uri} />
  ) : (
    <EntityArtTile type="unknown" title={target.name} size="sm" />
  );
}

/**
 * The share sheet, as in the Spotify app: the entity on top, a row of round buttons that copy its
 * link (URL) or spacify: URI (or hand it to the system's share menu), and below them every place
 * the app can send it to (EntityExtensions.useShareTargets: agents, channels, threads, …), to pick
 * one or more of, add a message and send. A bottom sheet on phones, a dialog on wider screens.
 * ActionMenu's "Share" opens it for any entity with a `uri`.
 */
export function ShareSheet({ uri, name, onClose }: ShareSheetProps) {
  const { t } = useI18n();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const key = useShareKey(uri, true);
  const copyUri = key ? shareUri(uri, key) : uri;
  const url = key ? shareUrl(uri, key) : null;
  const parsed = parseEntityUri(uri);
  const share = entityExtensions().useShareTargets(true);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function" && !!url;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? share.targets.filter((target) => `${target.name} ${target.detail ?? ""}`.toLowerCase().includes(q)) : share.targets;
  }, [share.targets, query]);
  const groups = useMemo(() => {
    const byGroup = new Map<string, ShareTarget[]>();
    for (const target of shown) byGroup.set(target.group, [...(byGroup.get(target.group) ?? []), target]);
    return [...byGroup];
  }, [shown]);
  const pickedTargets = share.targets.filter((target) => picked.includes(target.key));

  useEffect(() => {
    sheetRef.current?.querySelector<HTMLElement>(".share-sheet__quick button")?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const toggle = (target: ShareTarget) =>
    setPicked((current) => (current.includes(target.key) ? current.filter((k) => k !== target.key) : [...current, target.key]));

  async function send() {
    if (!pickedTargets.length || sending) return;
    setSending(true);
    const entity = { uri, name, shareUri: copyUri, url };
    const results = await Promise.allSettled(pickedTargets.map((target) => share.send(target, entity, message.trim())));
    setSending(false);
    const failed = pickedTargets.filter((_, i) => results[i].status === "rejected");
    results.forEach((r) => r.status === "rejected" && console.warn("share: couldn't send", r.reason));
    if (failed.length) {
      // Keep the ones that failed picked, so sending again only retries those.
      setPicked(failed.map((target) => target.key));
      showToast(t("share.failed", { name: failed.map((target) => target.name).join(", ") }));
      return;
    }
    showToast(pickedTargets.length === 1 ? t("share.sent", { name: pickedTargets[0].name }) : t("share.sentCount", { count: pickedTargets.length }));
    onClose();
  }

  return createPortal(
    <div
      className="share-sheet-backdrop"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={sheetRef}
        className="share-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="share-sheet__header">
          <h2 id={titleId} className="share-sheet__title">{t("share.title")}</h2>
          <button type="button" className="share-sheet__close" aria-label={t("share.close")} title={t("share.close")} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="share-sheet__body">
          <div className="share-sheet__entity">
            {parsed ? <EntityArt type={parsed.entityType} title={name} size="lg" uri={uri} /> : null}
            <span className="share-sheet__entity-text">
              <span className="share-sheet__name">{name}</span>
              <span className="share-sheet__meta">{entityTypeLabel(t, uri)}</span>
            </span>
          </div>
          <div className="share-sheet__quick">
            {url ? (
              <button type="button" className="share-sheet__quick-item" onClick={() => copyText(url, t("actions.urlCopied"), t("actions.copyFailed"))}>
                <span className="share-sheet__round"><LinkIcon /></span>
                <span>{t("share.copyLink")}</span>
              </button>
            ) : null}
            <button type="button" className="share-sheet__quick-item" onClick={() => copyText(copyUri, t("actions.uriCopied"), t("actions.copyFailed"))}>
              <span className="share-sheet__round"><UriIcon /></span>
              <span>{t("actions.copyUri")}</span>
            </button>
            {canNativeShare ? (
              <button
                type="button"
                className="share-sheet__quick-item"
                onClick={() => void navigator.share({ title: name, url: url! }).catch(() => undefined)}
              >
                <span className="share-sheet__round"><ShareIcon /></span>
                <span>{t("share.more")}</span>
              </button>
            ) : null}
          </div>
          {share.targets.length || share.isLoading ? (
            <section className="share-sheet__targets" aria-label={t("share.sendTo")}>
              <h3 className="share-sheet__section">{t("share.sendTo")}</h3>
              <input
                className="bungalow-input share-sheet__search"
                type="search"
                value={query}
                placeholder={t("share.search")}
                aria-label={t("share.search")}
                onChange={(event) => setQuery(event.target.value)}
              />
              {share.isLoading && !share.targets.length ? <p className="share-sheet__empty">{t("app.loading")}</p> : null}
              {!share.isLoading && !shown.length ? <p className="share-sheet__empty">{t("share.noMatches")}</p> : null}
              {groups.map(([group, targets]) => (
                <div key={group} className="share-sheet__group" role="group" aria-label={group}>
                  <h4 className="share-sheet__group-title">{group}</h4>
                  {targets.map((target) => {
                    const on = picked.includes(target.key);
                    return (
                      <button
                        key={target.key}
                        type="button"
                        className={on ? "share-sheet__target share-sheet__target--picked" : "share-sheet__target"}
                        aria-pressed={on}
                        onClick={() => toggle(target)}
                      >
                        <TargetArt target={target} />
                        <span className="share-sheet__target-text">
                          <span className="share-sheet__target-name">{target.name}</span>
                          {target.detail ? <span className="share-sheet__target-detail">{target.detail}</span> : null}
                        </span>
                        <span className="share-sheet__check" aria-hidden="true">
                          {on ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m5 12 5 5 9-10" />
                            </svg>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </section>
          ) : null}
        </div>
        {pickedTargets.length ? (
          <form
            className="share-sheet__footer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <input
              className="bungalow-input share-sheet__message"
              value={message}
              placeholder={t("share.message")}
              aria-label={t("share.message")}
              onChange={(event) => setMessage(event.target.value)}
            />
            <Button type="submit" tone="primary" disabled={sending}>
              {pickedTargets.length === 1 ? t("share.send") : t("share.sendCount", { count: pickedTargets.length })}
            </Button>
          </form>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A round share button for an entity's own page (beside its like and "⋯"), opening the share
 * sheet. Renders nothing where the site doesn't offer sharing; disabled for restricted entities.
 */
export function ShareButton({ uri, name, className = "entity-share-button" }: { uri: string; name: string; className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const offers = useSiteOffers();
  const noSharing = !!useEntityLifecycle().restrictionFor(uri)?.noSharing;
  if (!offers({ aspects: ["share"] })) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-label={t("share.shareName", { name })}
        title={t("share.shareName", { name })}
        disabled={noSharing}
        onClick={() => setOpen(true)}
      >
        <ShareIcon />
      </button>
      {open ? <ShareSheet uri={uri} name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
