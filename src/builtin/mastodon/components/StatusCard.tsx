import { useState } from "react";
import { Button, Icon } from "../../../design-system/bungalow-79d923";
import { ActionMenu, type MenuAction } from "../../../entities/ActionMenu";
import { useI18n } from "../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../navigation/useEntityModal";
import type { MessageKey } from "../../../register";
import { accountUri, paths, statusUri, useStatusAction, useVote } from "../models/mastodon";
import type { MAccount, MPoll, MStatus } from "../models/types";
import { RichContent } from "./RichContent";

export function Avatar({ account, size = 44 }: { account: Pick<MAccount, "avatar" | "username" | "display_name"> | null; size?: number }) {
  const initial = (account?.display_name || account?.username || "?").trim().charAt(0).toUpperCase();
  return account?.avatar ? (
    <img className="mastodon-avatar" src={account.avatar} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <span className="mastodon-avatar mastodon-avatar--empty" style={{ width: size, height: size }} aria-hidden="true">
      {initial}
    </span>
  );
}

/** "3 min", "2 h", "5 d", then the date. */
export function useRelativeTime() {
  const { t, intlLocale } = useI18n();
  return (iso: string) => {
    const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return t("mastodon.time.now");
    if (seconds < 3600) return t("mastodon.time.minutes", { count: Math.floor(seconds / 60) });
    if (seconds < 86400) return t("mastodon.time.hours", { count: Math.floor(seconds / 3600) });
    if (seconds < 7 * 86400) return t("mastodon.time.days", { count: Math.floor(seconds / 86400) });
    return new Date(iso).toLocaleDateString(intlLocale, { day: "numeric", month: "short", year: "numeric" });
  };
}

export function AccountName({ account }: { account: MAccount }) {
  const go = useNavigateKeepingSearch();
  return (
    <button type="button" className="mastodon-name" onClick={() => go(paths.account(account))}>
      <strong>{account.display_name || account.username}</strong>
      {account.bot ? <span className="mastodon-badge">BOT</span> : null}
      <span className="muted">@{account.acct}</span>
    </button>
  );
}

/**
 * One status in a timeline or thread: who, when, its content (behind its content warning), media,
 * poll and the reply/boost/favourite/bookmark bar. The row's "⋯" menu carries the status's uri, so
 * it can be saved, put in playlists, shared and dragged like any entity.
 */
export function StatusCard({ status, viewer, focused = false }: { status: MStatus; viewer: string | null; focused?: boolean }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const relative = useRelativeTime();
  const act = useStatusAction();
  const boost = status.reblog ? status : null;
  const shown = status.reblog ?? status;
  const [revealed, setRevealed] = useState(!shown.spoiler_text);
  const [showMedia, setShowMedia] = useState(!shown.sensitive);
  const mine = !!viewer && shown.account.id === viewer;
  const run = (action: Parameters<typeof act.mutate>[0]["action"]) => viewer && act.mutate({ action, status: shown, account: viewer });

  const actions: MenuAction[] = [
    { key: "open", label: t("mastodon.status.open"), onSelect: () => go(paths.status(shown)) },
    ...(viewer ? [{ key: "reply", label: t("mastodon.status.reply"), onSelect: () => go(paths.reply(shown)) }] : []),
    ...(shown.url && !shown.local ? [{ key: "original", label: t("mastodon.status.original"), onSelect: () => window.open(shown.url!, "_blank", "noopener") }] : []),
    { key: "author", label: t("mastodon.status.author", { name: shown.account.display_name || shown.account.username }), onSelect: () => go(paths.account(shown.account)) },
    ...(mine && shown.local ? [{ key: "edit", label: t("mastodon.edit"), onSelect: () => go(paths.editStatus(shown)) }] : []),
    ...(mine
      ? [
          {
            key: "delete",
            label: t("mastodon.delete"),
            tone: "danger" as const,
            onSelect: () => {
              if (window.confirm(t("mastodon.status.confirmDelete"))) act.mutate({ action: "delete", status: shown, account: viewer! });
            },
          },
        ]
      : []),
  ];

  return (
    <article className={`mastodon-status action-row${focused ? " mastodon-status--focused" : ""}`}>
      {boost ? (
        <div className="mastodon-status__boosted muted">
          <Icon name="repeat" /> {t("mastodon.status.boostedBy", { name: boost.account.display_name || boost.account.username })}
        </div>
      ) : null}
      <div className="mastodon-status__row">
        <button type="button" className="mastodon-status__avatar" onClick={() => go(paths.account(shown.account))} aria-label={shown.account.acct}>
          <Avatar account={shown.account} />
        </button>
        <div className="mastodon-status__main">
          <header className="mastodon-status__head">
            <AccountName account={shown.account} />
            <button type="button" className="mastodon-status__time muted" onClick={() => go(paths.status(shown))} title={new Date(shown.created_at).toLocaleString()}>
              {visibilityGlyph(shown.visibility)} {relative(shown.created_at)}
              {shown.edited_at ? ` · ${t("mastodon.status.edited")}` : ""}
            </button>
          </header>
          {shown.spoiler_text ? (
            <div className="mastodon-status__cw">
              <span>{shown.spoiler_text}</span>
              <Button size="sm" variant="outline" onClick={() => setRevealed((v) => !v)}>
                {revealed ? t("mastodon.status.showLess") : t("mastodon.status.showMore")}
              </Button>
            </div>
          ) : null}
          {revealed ? (
            <div className="mastodon-status__content" lang={shown.language ?? undefined}>
              <RichContent text={shown.text} html={shown.content_html} domain={shown.account.domain} />
            </div>
          ) : null}
          {revealed && shown.media_attachments.length ? (
            <div className={`mastodon-media mastodon-media--${Math.min(shown.media_attachments.length, 4)}`}>
              {!showMedia ? (
                <button type="button" className="mastodon-media__veil" onClick={() => setShowMedia(true)}>
                  {t("mastodon.status.sensitive")}
                </button>
              ) : (
                shown.media_attachments.map((media) =>
                  media.type === "video" || media.type === "gifv" ? (
                    <video key={media.id} src={media.url} poster={media.preview_url} controls={media.type === "video"} autoPlay={media.type === "gifv"} loop={media.type === "gifv"} muted={media.type === "gifv"} playsInline aria-label={media.description ?? undefined} />
                  ) : media.type === "audio" ? (
                    <audio key={media.id} src={media.url} controls aria-label={media.description ?? undefined} />
                  ) : (
                    <a key={media.id} href={media.url} target="_blank" rel="noopener noreferrer">
                      <img src={media.preview_url} alt={media.description ?? ""} loading="lazy" referrerPolicy="no-referrer" />
                    </a>
                  ),
                )
              )}
            </div>
          ) : null}
          {revealed && shown.poll ? <Poll poll={shown.poll} viewer={viewer} /> : null}
          <footer className="mastodon-status__bar">
            <button type="button" className="mastodon-action" disabled={!viewer} onClick={() => go(paths.reply(shown))} aria-label={t("mastodon.status.reply")}>
              <Icon name="chat" /> <span>{shown.replies_count || ""}</span>
            </button>
            <button
              type="button"
              className={`mastodon-action${shown.reblogged ? " is-on" : ""}`}
              disabled={!viewer || act.isPending || (shown.visibility !== "public" && shown.visibility !== "unlisted")}
              onClick={() => run(shown.reblogged ? "unreblog" : "reblog")}
              aria-pressed={shown.reblogged}
              aria-label={t("mastodon.status.boost")}
            >
              <Icon name="repeat" /> <span>{shown.reblogs_count || ""}</span>
            </button>
            <button
              type="button"
              className={`mastodon-action${shown.favourited ? " is-on" : ""}`}
              disabled={!viewer || act.isPending}
              onClick={() => run(shown.favourited ? "unfavourite" : "favourite")}
              aria-pressed={shown.favourited}
              aria-label={t("mastodon.status.favourite")}
            >
              <Icon name="star" /> <span>{shown.favourites_count || ""}</span>
            </button>
            <button
              type="button"
              className={`mastodon-action${shown.bookmarked ? " is-on" : ""}`}
              disabled={!viewer || act.isPending}
              onClick={() => run(shown.bookmarked ? "unbookmark" : "bookmark")}
              aria-pressed={shown.bookmarked}
              aria-label={t("mastodon.status.bookmark")}
            >
              <Icon name="flag" />
            </button>
          </footer>
          {act.error ? <p className="bungalow-help bungalow-help--error">{act.error.message}</p> : null}
        </div>
        <ActionMenu name={`@${shown.account.acct}`} uri={statusUri(shown)} actions={actions} />
      </div>
    </article>
  );
}

function visibilityGlyph(visibility: MStatus["visibility"]) {
  return visibility === "public" ? "🌐" : visibility === "unlisted" ? "🔓" : visibility === "private" ? "🔒" : "✉";
}

function Poll({ poll, viewer }: { poll: MPoll; viewer: string | null }) {
  const { t } = useI18n();
  const vote = useVote();
  const [picked, setPicked] = useState<number[]>([]);
  const done = poll.expired || poll.voted || !viewer;
  const total = Math.max(1, poll.multiple ? poll.voters_count : poll.votes_count);
  return (
    <div className="mastodon-poll">
      {poll.options.map((option, index) =>
        done ? (
          <div key={index} className={`mastodon-poll__result${poll.own_votes.includes(index) ? " is-own" : ""}`}>
            <span className="mastodon-poll__bar" style={{ width: `${Math.round(((option.votes_count ?? 0) / total) * 100)}%` }} />
            <span className="mastodon-poll__label">
              <strong>{Math.round(((option.votes_count ?? 0) / total) * 100)}%</strong> {option.title}
            </span>
          </div>
        ) : (
          <label key={index} className="mastodon-poll__option">
            <input
              type={poll.multiple ? "checkbox" : "radio"}
              name={`poll-${poll.id}`}
              checked={picked.includes(index)}
              onChange={(e) => setPicked((prev) => (poll.multiple ? (e.target.checked ? [...prev, index] : prev.filter((i) => i !== index)) : [index]))}
            />
            {option.title}
          </label>
        ),
      )}
      <div className="muted mastodon-poll__meta">
        {t("mastodon.poll.voters", { count: poll.voters_count })}
        {poll.expires_at ? ` · ${poll.expired ? t("mastodon.poll.closed") : t("mastodon.poll.closes", { date: new Date(poll.expires_at).toLocaleString() })}` : ""}
      </div>
      {!done ? (
        <Button size="sm" variant="outline" disabled={!picked.length || vote.isPending} onClick={() => vote.mutate({ poll: poll.id, account: viewer!, choices: picked })}>
          {t("mastodon.poll.vote")}
        </Button>
      ) : null}
      {vote.error ? <p className="bungalow-help bungalow-help--error">{vote.error.message}</p> : null}
    </div>
  );
}

/** A compact row for an account (search results, follow requests, members of a list). */
export function AccountRow({ account, actions = [], detail }: { account: MAccount; actions?: MenuAction[]; detail?: string }) {
  const go = useNavigateKeepingSearch();
  return (
    <div className="mastodon-account-row action-row">
      <button type="button" className="mastodon-account-row__main" onClick={() => go(paths.account(account))}>
        <Avatar account={account} size={36} />
        <span className="mastodon-account-row__names">
          <strong>{account.display_name || account.username}</strong>
          <span className="muted">@{account.acct}{detail ? ` · ${detail}` : ""}</span>
        </span>
      </button>
      <ActionMenu name={`@${account.acct}`} uri={accountUri(account)} actions={actions} />
    </div>
  );
}

