import { useEffect, useRef, useState } from "react";
import { Alert, Button, Icon, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { useI18n } from "../../../../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import type { MessageKey } from "../../../../../../register";
import { SafeHtml } from "../../../../components/RichContent";
import { Avatar, useRelativeTime } from "../../../../components/StatusCard";
import {
  normalizeHost,
  REMOTE_TIMELINES,
  useFinishRemoteSignIn,
  useRemotePost,
  useRemoteSessions,
  useRemoteStatusAction,
  useRemoteTimeline,
  useRemoveRemoteSession,
  useStartRemoteSignIn,
  type RemoteStatus,
  type RemoteTimeline,
} from "../../../../models/remote";
import type { RemoteSession, Visibility } from "../../../../models/types";
import { VISIBILITIES } from "../../../../models/types";
import { SkeletonRows } from "../../../../../../shell/Skeleton";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error ?? ""));

/**
 * Other Mastodon servers the user signed in to (`/mastodon/remote`): `/remote/new` signs in to
 * one, `/remote/callback` is where its sign-in comes back, `/remote/<id>[/<timeline>]` reads it and
 * `/remote/<id>/compose` posts there.
 */
export function RemoteClient({ rest }: { rest: string[] }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const sessions = useRemoteSessions();
  const remove = useRemoveRemoteSession();
  const [first, second, third] = rest;
  const active = (sessions.data ?? []).filter((s) => s.state === "active");

  if (first === "callback") return <Callback />;
  if (sessions.isLoading) return <SkeletonRows />;
  const session = first && first !== "new" ? active.find((s) => s.id === first) : undefined;
  if (session) return <RemoteTimelineView session={session} timeline={(REMOTE_TIMELINES as readonly string[]).includes(second ?? "") ? (second as RemoteTimeline) : "home"} composing={second === "compose" || third === "compose"} />;

  return (
    <section className="stack">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{t("mastodon.remote.title")}</h3>
          <p className="muted">{t("mastodon.remote.intro")}</p>
        </div>
        <Button size="sm" tone="primary" onClick={() => go("/mastodon/remote/new")}>
          {t("mastodon.remote.signIn")}
        </Button>
      </div>
      {sessions.error ? <Alert tone="danger">{errorText(sessions.error)}</Alert> : null}
      {!active.length ? (
        <EmptyState items={t("mastodon.remote.items")} actionLabel={t("mastodon.remote.signIn")} onAction={() => go("/mastodon/remote/new")} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("mastodon.remote.account")}</th>
              <th>{t("mastodon.remote.server")}</th>
              <th className="action-row-cell" aria-label={t("mastodon.actions")} />
            </tr>
          </thead>
          <tbody>
            {active.map((row) => (
              <tr key={row.id} className="action-row">
                <td>
                  <button type="button" className="link-button" onClick={() => go(`/mastodon/remote/${row.id}`)}>
                    @{row.acct}
                  </button>
                </td>
                <td>{row.host}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={`@${row.acct}`}
                    actions={[
                      { key: "open", label: t("mastodon.remote.open"), onSelect: () => go(`/mastodon/remote/${row.id}`) },
                      {
                        key: "signOut",
                        label: t("mastodon.remote.signOut"),
                        tone: "danger",
                        onSelect: () => {
                          if (window.confirm(t("mastodon.remote.confirmSignOut", { host: row.host }))) remove.mutate(row);
                        },
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {first === "new" ? <SignInSheet onClose={() => go("/mastodon/remote")} /> : null}
    </section>
  );
}

function SignInSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const start = useStartRemoteSignIn();
  const normalized = normalizeHost(host);
  return (
    <EntitySheet
      title={t("mastodon.remote.signInTitle")}
      onClose={onClose}
      closeLabel={t("mastodon.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (normalized) start.mutate({ host: normalized });
      }}
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{t("mastodon.remote.server")}</div>
          <div className="entity-preview__label">{normalized ?? "…"}</div>
          <p className="muted">{t("mastodon.remote.signInHint")}</p>
        </div>
      }
      footer={<FormActions onCancel={onClose} cancelLabel={t("mastodon.cancel")} submitLabel={t("mastodon.remote.continue")} saving={start.isPending} submitDisabled={!normalized} />}
    >
      {start.error ? <Alert tone="danger">{start.error.message === "bad-host" ? t("mastodon.remote.badHost") : t("mastodon.remote.failed", { error: start.error.message })}</Alert> : null}
      <Input label={t("mastodon.remote.server")} placeholder="mastodon.social" value={host} required autoFocus onChange={(e) => setHost(e.target.value)} />
    </EntitySheet>
  );
}

function Callback() {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const finish = useFinishRemoteSignIn();
  const started = useRef(false);
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error");
  useEffect(() => {
    if (started.current || !code || !state) return;
    started.current = true;
    finish.mutate({ code, state }, { onSuccess: (session) => go(`/mastodon/remote/${session.id}`) });
  }, [code, state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (denied) return <Alert tone="warning">{t("mastodon.remote.denied")}</Alert>;
  if (finish.error) return <Alert tone="danger">{t("mastodon.remote.failed", { error: finish.error.message })}</Alert>;
  return <p className="muted">{t("mastodon.remote.finishing")}</p>;
}

function RemoteTimelineView({ session, timeline, composing }: { session: RemoteSession; timeline: RemoteTimeline; composing: boolean }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const feed = useRemoteTimeline(session, timeline);
  const base = `/mastodon/remote/${session.id}`;
  const items = feed.data?.pages.flat() ?? [];
  return (
    <div className="stack">
      <div className="panel-head">
        <div>
          <button type="button" className="link-button muted" onClick={() => go("/mastodon/remote")}>
            ← {t("mastodon.remote.title")}
          </button>
          <h3 className="panel-title">@{session.acct}</h3>
        </div>
        <Button size="sm" tone="primary" onClick={() => go(`${base}/${timeline}/compose`)}>
          {t("mastodon.compose.button")}
        </Button>
      </div>
      <div className="search-chips" role="tablist">
        {REMOTE_TIMELINES.map((value) => (
          <button key={value} type="button" role="tab" className="search-chip" aria-selected={timeline === value} onClick={() => go(`${base}/${value}`)}>
            {t(`mastodon.tab.${value}` as MessageKey)}
          </button>
        ))}
      </div>
      {feed.isLoading ? <SkeletonRows art="round" /> : null}
      {feed.error ? <Alert tone="danger">{t("mastodon.remote.failed", { error: errorText(feed.error) })}</Alert> : null}
      {!feed.isLoading && !items.length && !feed.error ? <EmptyState items={t("mastodon.status.items")} /> : null}
      <div className="mastodon-feed">
        {items.map((item) =>
          item.kind === "status" ? (
            <RemoteStatusCard key={item.id} status={item.status} session={session} />
          ) : (
            <div key={item.id} className="mastodon-notification-group">
              <div className="mastodon-notification">
                <Avatar account={{ avatar: item.item.account.avatar, username: item.item.account.acct, display_name: item.item.account.display_name }} size={28} />
                <span>
                  <strong>{item.item.account.display_name || item.item.account.acct}</strong> {t(`mastodon.notification.${item.item.type}` as MessageKey)}
                </span>
              </div>
              {item.item.status ? <RemoteStatusCard status={item.item.status} session={session} /> : null}
            </div>
          ),
        )}
        {feed.hasNextPage ? (
          <Button variant="outline" disabled={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>
            {t("mastodon.more")}
          </Button>
        ) : null}
      </div>
      {composing ? <RemoteCompose session={session} onClose={() => go(`${base}/${timeline}`)} /> : null}
    </div>
  );
}

function RemoteStatusCard({ status, session }: { status: RemoteStatus; session: RemoteSession }) {
  const { t } = useI18n();
  const relative = useRelativeTime();
  const act = useRemoteStatusAction(session);
  const shown = status.reblog ?? status;
  const [revealed, setRevealed] = useState(!shown.spoiler_text);
  return (
    <article className="mastodon-status">
      {status.reblog ? (
        <div className="mastodon-status__boosted muted">
          <Icon name="repeat" /> {t("mastodon.status.boostedBy", { name: status.account.display_name || status.account.acct })}
        </div>
      ) : null}
      <div className="mastodon-status__row">
        <span className="mastodon-status__avatar">
          <Avatar account={{ avatar: shown.account.avatar, username: shown.account.acct, display_name: shown.account.display_name }} />
        </span>
        <div className="mastodon-status__main">
          <header className="mastodon-status__head">
            <span className="mastodon-name">
              <strong>{shown.account.display_name || shown.account.acct}</strong>
              <span className="muted">@{shown.account.acct}</span>
            </span>
            {shown.url ? (
              <a className="mastodon-status__time muted" href={shown.url} target="_blank" rel="noopener noreferrer">
                {relative(shown.created_at)}
              </a>
            ) : (
              <span className="mastodon-status__time muted">{relative(shown.created_at)}</span>
            )}
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
            <div className="mastodon-status__content">
              <SafeHtml html={shown.content} />
            </div>
          ) : null}
          {revealed && shown.media_attachments.length ? (
            <div className={`mastodon-media mastodon-media--${Math.min(shown.media_attachments.length, 4)}`}>
              {shown.media_attachments.map((media) =>
                media.type === "image" ? (
                  <a key={media.id} href={media.url} target="_blank" rel="noopener noreferrer">
                    <img src={media.preview_url ?? media.url} alt={media.description ?? ""} loading="lazy" referrerPolicy="no-referrer" />
                  </a>
                ) : (
                  <video key={media.id} src={media.url} controls playsInline aria-label={media.description ?? undefined} />
                ),
              )}
            </div>
          ) : null}
          <footer className="mastodon-status__bar">
            <span className="mastodon-action">
              <Icon name="chat" /> <span>{shown.replies_count || ""}</span>
            </span>
            <button type="button" className={`mastodon-action${shown.reblogged ? " is-on" : ""}`} disabled={act.isPending} onClick={() => act.mutate({ status, action: shown.reblogged ? "unreblog" : "reblog" })} aria-label={t("mastodon.status.boost")}>
              <Icon name="repeat" /> <span>{shown.reblogs_count || ""}</span>
            </button>
            <button type="button" className={`mastodon-action${shown.favourited ? " is-on" : ""}`} disabled={act.isPending} onClick={() => act.mutate({ status, action: shown.favourited ? "unfavourite" : "favourite" })} aria-label={t("mastodon.status.favourite")}>
              <Icon name="star" /> <span>{shown.favourites_count || ""}</span>
            </button>
            <button type="button" className={`mastodon-action${shown.bookmarked ? " is-on" : ""}`} disabled={act.isPending} onClick={() => act.mutate({ status, action: shown.bookmarked ? "unbookmark" : "bookmark" })} aria-label={t("mastodon.status.bookmark")}>
              <Icon name="flag" />
            </button>
          </footer>
          {act.error ? <p className="bungalow-help bungalow-help--error">{act.error.message}</p> : null}
        </div>
      </div>
    </article>
  );
}

function RemoteCompose({ session, onClose }: { session: RemoteSession; onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [cw, setCw] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const post = useRemotePost(session);
  return (
    <EntitySheet
      title={t("mastodon.compose.title")}
      subtitle={`@${session.acct}`}
      onClose={onClose}
      closeLabel={t("mastodon.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        post.mutate({ status: text, spoiler_text: cw.trim() || undefined, visibility }, { onSuccess: onClose });
      }}
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{session.host}</div>
          <div className="entity-preview__label">@{session.acct}</div>
          {cw.trim() ? <p className="muted">⚠ {cw}</p> : null}
          <p>{text || t("mastodon.compose.placeholder")}</p>
        </div>
      }
      footer={<FormActions onCancel={onClose} cancelLabel={t("mastodon.cancel")} submitLabel={t("mastodon.compose.publish")} saving={post.isPending} submitDisabled={!text.trim()} />}
    >
      {post.error ? <Alert tone="danger">{errorText(post.error)}</Alert> : null}
      <label className="mastodon-field">
        <span className="mastodon-field__label">{t("mastodon.compose.text")}</span>
        <textarea className="bungalow-input" rows={6} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      </label>
      <Input label={t("mastodon.compose.warningText")} value={cw} onChange={(e) => setCw(e.target.value)} />
      <Select label={t("mastodon.compose.visibility")} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
        {VISIBILITIES.map((value) => (
          <option key={value} value={value}>
            {t(`mastodon.visibility.${value}` as MessageKey)}
          </option>
        ))}
      </Select>
    </EntitySheet>
  );
}
