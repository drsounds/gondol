import { useEffect, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { ActionMenu, type MenuAction } from "../../../../../../entities/ActionMenu";
import { useI18n } from "../../../../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import type { MessageKey } from "../../../../../../register";
import { RichContent } from "../../../../components/RichContent";
import { ComposeSheet, ListSheet, ProfileSheet } from "../../../../components/Sheets";
import { AccountName, AccountRow, Avatar, StatusCard, useRelativeTime } from "../../../../components/StatusCard";
import {
  accountUri,
  findByKey,
  listUri,
  paths,
  useAccount,
  useAccountAction,
  useCurrentAccount,
  useDebounced,
  useFollowRequest,
  useFollowRequests,
  useInstances,
  useLists,
  useMarkNotificationsRead,
  useNotifications,
  useRefreshRemote,
  useResolveRemote,
  useSearch,
  useThread,
  useTimeline,
  type TimelineKind,
} from "../../../../models/mastodon";
import { RemoteClient } from "../components/RemoteClient";
import type { MAccount, MastodonAccountRow, MastodonInstance, MNotification, MStatus } from "../../../../models/types";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

const TABS = ["home", "local", "federated", "notifications", "bookmarks", "favourites", "lists", "search", "profiles", "remote"] as const;
type Tab = (typeof TABS)[number];
const TIMELINE_TABS: Partial<Record<Tab, TimelineKind>> = { home: "home", local: "local", federated: "federated", bookmarks: "bookmarks", favourites: "favourites" };

/**
 * The Mastodon client (`/mastodon`): timelines, notifications, profiles, threads, hashtags, lists,
 * search and other servers, acting as one of the user's profiles on the servers here.
 *
 *   /mastodon[/local|/federated|/notifications|/bookmarks|/favourites]   timelines
 *   /mastodon/new                                     compose (a routed sheet)
 *   /mastodon/statuses/<key>[/reply|/edit]            a thread, replying, editing
 *   /mastodon/accounts/<key or user@domain>[/edit]    a profile; /accounts/new sets one up
 *   /mastodon/tags/<name>, /mastodon/search[/<q>]
 *   /mastodon/lists[/new|/<key>[/edit]], /mastodon/profiles, /mastodon/follow-requests
 *   /mastodon/remote[/…]                              signed in to other servers (./RemoteClient)
 */
export function MastodonPage({ splat }: AppFeaturePageProps) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const parts = (splat ?? "").split("/").filter(Boolean).map(decodeURIComponent);
  const me = useCurrentAccount();
  const instances = useInstances();
  const [section, key, action] = parts;
  const current = me.current;
  const instance = current ? instances.data?.find((i) => i.id === current.instance_id) : undefined;
  const tab: Tab = (TABS as readonly string[]).includes(section ?? "") ? (section as Tab) : section ? ("" as Tab) : "home";

  const close = (to: string) => () => go(to);

  let sheet: ReactNode = null;
  if (section === "new" && current) {
    sheet = <ComposeSheet account={current} accounts={me.usable} maxChars={instance?.max_status_chars ?? 500} onClose={close(paths.home)} onSaved={() => go(paths.home)} />;
  } else if (section === "accounts" && key === "new") {
    sheet = <ProfileSheet instances={instances.data ?? []} onClose={close("/mastodon/profiles")} onSaved={(saved) => { me.pick(saved.id); go("/mastodon/profiles"); }} />;
  }

  if (me.isLoading || instances.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;

  const header = (
    <div className="panel-head">
      <div>
        <h2 className="panel-title">{t("mastodon.title")}</h2>
        <p className="muted">{current ? `@${current.username}@${instance?.domain ?? ""}` : t("mastodon.intro")}</p>
      </div>
      <div className="row-actions">
        {me.usable.length > 1 && current ? (
          <Select aria-label={t("mastodon.compose.as")} value={current.id} onChange={(e) => me.pick(e.target.value)}>
            {me.usable.map((account) => (
              <option key={account.id} value={account.id}>
                @{account.username}@{instances.data?.find((i) => i.id === account.instance_id)?.domain ?? ""}
              </option>
            ))}
          </Select>
        ) : null}
        {current ? (
          <Button size="sm" tone="primary" onClick={() => go(paths.compose)}>
            {t("mastodon.compose.button")}
          </Button>
        ) : (
          <Button size="sm" tone="primary" onClick={() => go(paths.newAccount)}>
            {t("mastodon.profile.new")}
          </Button>
        )}
      </div>
    </div>
  );

  const nav = (
    <div className="search-chips mastodon-tabs" role="tablist" aria-label={t("mastodon.tabs")}>
      {TABS.map((value) => (
        <button key={value} type="button" role="tab" aria-selected={tab === value} className="search-chip" onClick={() => go(paths.tab(value))}>
          {t(`mastodon.tab.${value}` as MessageKey)}
        </button>
      ))}
    </div>
  );

  let body: ReactNode;
  if (section === "remote") body = <RemoteClient rest={parts.slice(1)} />;
  else if (section === "profiles" || (section === "accounts" && key === "new")) body = <Profiles accounts={me.accounts} instances={instances.data ?? []} current={current} onPick={me.pick} />;
  else if (section === "accounts" && key) body = <ProfileView accountKey={key} action={action} viewer={current} instances={instances.data ?? []} />;
  else if (section === "statuses" && key) body = <ThreadView statusKey={key} action={action} viewer={current} accounts={me.usable} instance={instance} />;
  else if (section === "tags" && key) body = <TagView name={key} viewer={current} />;
  else if (section === "lists") body = current ? <ListsView listKey={key} action={action} account={current} /> : <NoProfile pending={me.accounts} />;
  else if (section === "search") body = <SearchView query={key ?? ""} viewer={current} />;
  else if (section === "follow-requests") body = current ? <FollowRequests account={current} /> : <NoProfile pending={me.accounts} />;
  else if (section === "notifications") body = current ? <Notifications account={current} /> : <NoProfile pending={me.accounts} />;
  else if (section === "new" || !section || TIMELINE_TABS[tab]) {
    const kind = TIMELINE_TABS[tab] ?? "home";
    body = !current && kind !== "federated" ? <NoProfile pending={me.accounts} /> : <Timeline kind={kind} viewer={current?.id ?? null} />;
  } else body = <EmptyState items={t("mastodon.items")} description={t("mastodon.notFound")} />;

  return (
    <div className="stack mastodon">
      {header}
      {nav}
      {body}
      {sheet}
      {section === "new" && !current ? <Alert tone="warning">{t("mastodon.profile.needed")}</Alert> : null}
    </div>
  );
}

function NoProfile({ pending }: { pending: MastodonAccountRow[] }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const waiting = pending.find((a) => a.status === "pending");
  const blocked = pending.find((a) => a.status === "suspended" || a.status === "disabled");
  if (waiting) return <Alert tone="info">{t("mastodon.profile.pending", { acct: waiting.username })}</Alert>;
  return (
    <>
      {blocked ? <Alert tone="warning">{t("mastodon.profile.suspended", { acct: blocked.username })}</Alert> : null}
      <EmptyState items={t("mastodon.profile.items")} description={t("mastodon.profile.emptyHint")} actionLabel={t("mastodon.profile.new")} onAction={() => go(paths.newAccount)} />
    </>
  );
}

function Timeline({ kind, viewer, arg, withReplies, empty }: { kind: TimelineKind; viewer: string | null; arg?: string | null; withReplies?: boolean; empty?: string }) {
  const { t } = useI18n();
  const feed = useTimeline(kind, viewer, arg, { withReplies });
  const statuses = feed.data?.pages.flat() ?? [];
  if (feed.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  if (feed.error) return <Alert tone="danger">{errorText(feed.error)}</Alert>;
  if (!statuses.length) return <EmptyState items={t("mastodon.status.items")} description={empty ?? t(`mastodon.empty.${kind}` as MessageKey)} />;
  return (
    <div className="mastodon-feed">
      {statuses.map((status) => (
        <StatusCard key={status.id} status={status} viewer={viewer} />
      ))}
      {feed.hasNextPage ? (
        <Button variant="outline" disabled={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>
          {t("mastodon.more")}
        </Button>
      ) : null}
    </div>
  );
}

function Notifications({ account }: { account: MastodonAccountRow }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const relative = useRelativeTime();
  const feed = useNotifications(account.id);
  const markRead = useMarkNotificationsRead();
  const requests = useFollowRequests(account.locked ? account.id : null);
  const items = feed.data?.pages.flat() ?? [];
  useEffect(() => {
    if (items.some((n) => !n.read)) markRead.mutate(account.id);
  }, [items.length, account.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (feed.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  if (feed.error) return <Alert tone="danger">{errorText(feed.error)}</Alert>;
  return (
    <div className="mastodon-feed">
      {requests.data?.length ? (
        <Button variant="outline" onClick={() => go("/mastodon/follow-requests")}>
          {t("mastodon.followRequests.count", { count: requests.data.length })}
        </Button>
      ) : null}
      {!items.length ? <EmptyState items={t("mastodon.notification.items")} description={t("mastodon.empty.notifications")} /> : null}
      {items.map((item) => (
        <NotificationItem key={item.id} item={item} viewer={account.id} relative={relative} />
      ))}
      {feed.hasNextPage ? (
        <Button variant="outline" disabled={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>
          {t("mastodon.more")}
        </Button>
      ) : null}
    </div>
  );
}

function NotificationItem({ item, viewer, relative }: { item: MNotification; viewer: string; relative: (iso: string) => string }) {
  const { t } = useI18n();
  const who = item.account;
  const line = (
    <div className={`mastodon-notification${item.read ? "" : " is-unread"}`}>
      {who ? <Avatar account={who} size={28} /> : null}
      <span>
        {who ? <AccountName account={who} /> : null} {t(`mastodon.notification.${item.type}` as MessageKey)}
      </span>
      <span className="muted">{relative(item.created_at)}</span>
    </div>
  );
  if (item.status && item.type !== "follow" && item.type !== "follow_request" && item.type !== "admin.sign_up") {
    return (
      <div className="mastodon-notification-group">
        {item.type !== "mention" ? line : null}
        <StatusCard status={item.status} viewer={viewer} />
      </div>
    );
  }
  return line;
}

function FollowRequests({ account }: { account: MastodonAccountRow }) {
  const { t } = useI18n();
  const requests = useFollowRequests(account.id);
  const decide = useFollowRequest();
  if (requests.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  if (!requests.data?.length) return <EmptyState items={t("mastodon.followRequests.items")} description={t("mastodon.followRequests.empty")} />;
  return (
    <div className="mastodon-feed">
      {requests.data.map((row) => (
        <AccountRow
          key={row.id}
          account={rowToAccount(row)}
          actions={[
            { key: "accept", label: t("mastodon.followRequests.accept"), onSelect: () => decide.mutate({ follower: row.id, account: account.id, accept: true }) },
            { key: "reject", label: t("mastodon.followRequests.reject"), tone: "danger", onSelect: () => decide.mutate({ follower: row.id, account: account.id, accept: false }) },
          ]}
        />
      ))}
    </div>
  );
}

/** A profile row as the API shape the shared components take. */
function rowToAccount(row: MastodonAccountRow, domain = ""): MAccount {
  return {
    id: row.id,
    identifier: row.identifier,
    slug: row.slug,
    username: row.username,
    acct: row.domain ? `${row.username}@${row.domain}` : row.username,
    domain: row.domain ?? domain,
    local: !row.domain,
    instance_id: row.instance_id,
    user_id: row.user_id,
    display_name: row.display_name ?? "",
    note: row.note,
    note_html: row.note_html,
    avatar: row.avatar_url,
    header: row.header_url,
    fields: row.fields,
    locked: row.locked,
    bot: row.bot,
    discoverable: row.discoverable,
    role: row.role,
    status: row.status,
    url: row.url,
    uri: row.actor_uri,
    followers_count: row.followers_count,
    following_count: row.following_count,
    statuses_count: row.statuses_count,
    last_status_at: null,
    created_at: row.created_at,
  };
}

/** The user's own profiles on the servers here: which one is in use, their state and their sheets. */
function Profiles({ accounts, instances, current, onPick }: { accounts: MastodonAccountRow[]; instances: MastodonInstance[]; current: MastodonAccountRow | null; onPick: (id: string) => void }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const domainOf = (row: MastodonAccountRow) => instances.find((i) => i.id === row.instance_id)?.domain ?? "";
  return (
    <section className="stack">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{t("mastodon.profiles.title")}</h3>
          <p className="muted">{t("mastodon.profiles.intro")}</p>
        </div>
        <Button size="sm" tone="primary" onClick={() => go(paths.newAccount)}>
          {t("mastodon.profile.new")}
        </Button>
      </div>
      {!accounts.length ? (
        <EmptyState items={t("mastodon.profile.items")} actionLabel={t("mastodon.profile.new")} onAction={() => go(paths.newAccount)} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("mastodon.profile.displayName")}</th>
              <th>{t("mastodon.profile.address")}</th>
              <th>{t("mastodon.admin.status")}</th>
              <th>{t("mastodon.admin.role")}</th>
              <th className="action-row-cell" aria-label={t("mastodon.actions")} />
            </tr>
          </thead>
          <tbody>
            {accounts.map((row) => (
              <tr key={row.id} className="action-row">
                <td>
                  <button type="button" className="link-button" onClick={() => go(paths.account(row))}>
                    {row.display_name || row.username}
                  </button>
                  {current?.id === row.id ? <Badge tone="primary">{t("mastodon.profiles.inUse")}</Badge> : null}
                </td>
                <td>
                  @{row.username}@{domainOf(row)}
                </td>
                <td>{t(`mastodon.accountStatus.${row.status}` as MessageKey)}</td>
                <td>{t(`mastodon.role.${row.role}` as MessageKey)}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={`@${row.username}`}
                    uri={accountUri(row)}
                    actions={[
                      ...(row.status === "active" || row.status === "silenced" ? [{ key: "use", label: t("mastodon.profiles.use"), onSelect: () => onPick(row.id) }] : []),
                      { key: "open", label: t("mastodon.profile.open"), onSelect: () => go(paths.account(row)) },
                      { key: "edit", label: t("mastodon.edit"), onSelect: () => go(paths.editAccount(row)) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ProfileView({ accountKey, action, viewer, instances }: { accountKey: string; action?: string; viewer: MastodonAccountRow | null; instances: MastodonInstance[] }) {
  const { t, intlLocale } = useI18n();
  const go = useNavigateKeepingSearch();
  const account = useAccount(accountKey, viewer?.id);
  const resolve = useResolveRemote();
  const refresh = useRefreshRemote();
  const act = useAccountAction();
  const [withReplies, setWithReplies] = useState(false);
  const me = useCurrentAccount();

  if (account.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  const found = account.data;
  if (!found) {
    const lookup = accountKey.includes("@") ? accountKey : null;
    return (
      <div className="stack">
        <EmptyState items={t("mastodon.profile.items")} description={t("mastodon.profile.notFound")} />
        {lookup ? (
          <Button variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ q: lookup, account: viewer?.id ?? null }, { onSuccess: () => account.refetch() })}>
            {t("mastodon.search.lookUp", { q: lookup })}
          </Button>
        ) : null}
        {resolve.error ? <Alert tone="danger">{errorText(resolve.error)}</Alert> : null}
      </div>
    );
  }
  const ownRow = me.accounts.find((row) => row.id === found.id);
  const rel = found.relationship;
  const isSelf = !!viewer && viewer.id === found.id;
  const run = (kind: Parameters<typeof act.mutate>[0]["action"]) => viewer && act.mutate({ action: kind, target: found.id, account: viewer.id });
  const menu: MenuAction[] = [
    ...(found.url ? [{ key: "original", label: t("mastodon.profile.original"), onSelect: () => window.open(found.url!, "_blank", "noopener") }] : []),
    ...(!found.local ? [{ key: "refresh", label: t("mastodon.profile.refresh"), onSelect: () => refresh.mutate(found.id) }] : []),
    ...(ownRow ? [{ key: "edit", label: t("mastodon.edit"), onSelect: () => go(paths.editAccount(found)) }] : []),
    ...(viewer && !isSelf
      ? [
          { key: "mute", label: rel?.muting ? t("mastodon.profile.unmute") : t("mastodon.profile.mute"), onSelect: () => run(rel?.muting ? "unmute" : "mute") },
          { key: "block", label: rel?.blocking ? t("mastodon.profile.unblock") : t("mastodon.profile.block"), tone: "danger" as const, onSelect: () => run(rel?.blocking ? "unblock" : "block") },
        ]
      : []),
  ];

  return (
    <div className="stack">
      <section className="mastodon-profile action-row">
        {found.header ? <img className="mastodon-profile__header" src={found.header} alt="" referrerPolicy="no-referrer" /> : <div className="mastodon-profile__header" />}
        <div className="mastodon-profile__top">
          <Avatar account={found} size={88} />
          <div className="row-actions">
            {viewer && !isSelf ? (
              <Button
                size="sm"
                tone={rel?.following || rel?.requested ? undefined : "primary"}
                variant={rel?.following || rel?.requested ? "outline" : undefined}
                disabled={act.isPending || rel?.blocking}
                onClick={() => run(rel?.following || rel?.requested ? "unfollow" : "follow")}
              >
                {rel?.following ? t("mastodon.profile.unfollow") : rel?.requested ? t("mastodon.profile.requested") : t("mastodon.profile.follow")}
              </Button>
            ) : null}
            {ownRow ? (
              <Button size="sm" variant="outline" onClick={() => go(paths.editAccount(found))}>
                {t("mastodon.profile.editButton")}
              </Button>
            ) : null}
            <ActionMenu name={`@${found.acct}`} uri={accountUri(found)} actions={menu} />
          </div>
        </div>
        <h3 className="panel-title">
          {found.display_name || found.username} {found.bot ? <Badge>BOT</Badge> : null} {found.locked ? "🔒" : null}
        </h3>
        <p className="muted">
          @{found.username}@{found.domain}
          {rel?.followed_by ? ` · ${t("mastodon.profile.followsYou")}` : ""}
          {found.status !== "active" ? ` · ${t(`mastodon.accountStatus.${found.status}` as MessageKey)}` : ""}
        </p>
        <div className="mastodon-status__content">
          <RichContent text={found.note} html={found.note_html} domain={found.domain} />
        </div>
        {found.fields.length ? (
          <dl className="mastodon-fields">
            {found.fields.map((field, i) => (
              <div key={i}>
                <dt>{field.name}</dt>
                <dd>{field.value.replace(/<[^>]*>/g, "")}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="mastodon-profile__counts">
          <span>
            <strong>{found.statuses_count}</strong> {t("mastodon.profile.posts")}
          </span>
          <span>
            <strong>{found.following_count}</strong> {t("mastodon.profile.following")}
          </span>
          <span>
            <strong>{found.followers_count}</strong> {t("mastodon.profile.followers")}
          </span>
          <span className="muted">{t("mastodon.profile.joined", { date: new Date(found.created_at).toLocaleDateString(intlLocale, { month: "long", year: "numeric" }) })}</span>
        </p>
        {act.error ? <Alert tone="danger">{errorText(act.error)}</Alert> : null}
        {refresh.error ? <Alert tone="danger">{errorText(refresh.error)}</Alert> : null}
      </section>
      <div className="search-chips" role="tablist">
        <button type="button" role="tab" className="search-chip" aria-selected={!withReplies} onClick={() => setWithReplies(false)}>
          {t("mastodon.profile.posts")}
        </button>
        <button type="button" role="tab" className="search-chip" aria-selected={withReplies} onClick={() => setWithReplies(true)}>
          {t("mastodon.profile.postsAndReplies")}
        </button>
      </div>
      <Timeline kind="account" viewer={viewer?.id ?? null} arg={found.id} withReplies={withReplies} empty={t("mastodon.empty.account")} />
      {action === "edit" && ownRow ? <ProfileSheet account={ownRow} instances={instances} onClose={() => go(paths.account(found))} onSaved={() => go(paths.account(found))} /> : null}
    </div>
  );
}

function ThreadView({ statusKey, action, viewer, accounts, instance }: { statusKey: string; action?: string; viewer: MastodonAccountRow | null; accounts: MastodonAccountRow[]; instance?: MastodonInstance }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const thread = useThread(statusKey, viewer?.id);
  if (thread.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  if (thread.error) return <Alert tone="danger">{errorText(thread.error)}</Alert>;
  const data = thread.data;
  if (!data?.status) return <EmptyState items={t("mastodon.status.items")} description={t("mastodon.status.notFound")} />;
  const status = data.status;
  const back = paths.status(status);
  return (
    <div className="mastodon-feed mastodon-thread">
      {data.ancestors.map((s) => (
        <StatusCard key={s.id} status={s} viewer={viewer?.id ?? null} />
      ))}
      <StatusCard status={status} viewer={viewer?.id ?? null} focused />
      {data.descendants.map((s) => (
        <StatusCard key={s.id} status={s} viewer={viewer?.id ?? null} />
      ))}
      {action === "reply" && viewer ? (
        <ComposeSheet account={viewer} accounts={accounts} maxChars={instance?.max_status_chars ?? 500} replyTo={status} onClose={() => go(back)} onSaved={() => go(back)} />
      ) : null}
      {action === "edit" && viewer && status.account.id === viewer.id ? (
        <ComposeSheet account={viewer} accounts={accounts} maxChars={instance?.max_status_chars ?? 500} editing={status} onClose={() => go(back)} onSaved={() => go(back)} />
      ) : null}
    </div>
  );
}

function TagView({ name, viewer }: { name: string; viewer: MastodonAccountRow | null }) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <h3 className="panel-title">#{name}</h3>
      <Timeline kind="tag" viewer={viewer?.id ?? null} arg={name} empty={t("mastodon.empty.tag", { tag: name })} />
    </div>
  );
}

function ListsView({ listKey, action, account }: { listKey?: string; action?: string; account: MastodonAccountRow }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const lists = useLists(account.id);
  const rows = lists.data ?? [];
  const list = listKey && listKey !== "new" ? findByKey(rows, listKey) : undefined;
  const sheet =
    listKey === "new" ? (
      <ListSheet account={account} onClose={() => go(paths.lists)} onSaved={() => go(paths.lists)} />
    ) : list && action === "edit" ? (
      <ListSheet key={list.id} list={list} account={account} onClose={() => go(paths.list(list))} onSaved={() => go(paths.list(list))} />
    ) : null;

  if (lists.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  if (list) {
    return (
      <div className="stack">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">{list.title}</h3>
            <p className="muted">{t("mastodon.list.memberCount", { count: list.members.length })}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => go(paths.editList(list))}>
            {t("mastodon.edit")}
          </Button>
        </div>
        <Timeline kind="list" viewer={account.id} arg={list.id} empty={t("mastodon.empty.list")} />
        {sheet}
      </div>
    );
  }
  return (
    <section className="stack">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{t("mastodon.lists.title")}</h3>
          <p className="muted">{t("mastodon.lists.intro")}</p>
        </div>
        <Button size="sm" tone="primary" onClick={() => go(paths.newList)}>
          {t("mastodon.list.new")}
        </Button>
      </div>
      {lists.error ? <Alert tone="danger">{errorText(lists.error)}</Alert> : null}
      {!rows.length ? (
        <EmptyState items={t("mastodon.list.items")} actionLabel={t("mastodon.list.new")} onAction={() => go(paths.newList)} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("mastodon.list.title")}</th>
              <th>{t("mastodon.list.members")}</th>
              <th>{t("mastodon.list.replies")}</th>
              <th className="action-row-cell" aria-label={t("mastodon.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="action-row">
                <td>
                  <button type="button" className="link-button" onClick={() => go(paths.list(row))}>
                    {row.title}
                  </button>
                </td>
                <td>{row.members.length}</td>
                <td>{t(`mastodon.list.replies.${row.replies_policy}` as MessageKey)}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={row.title}
                    uri={listUri(row)}
                    actions={[
                      { key: "open", label: t("mastodon.list.open"), onSelect: () => go(paths.list(row)) },
                      { key: "edit", label: t("mastodon.edit"), onSelect: () => go(paths.editList(row)) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sheet}
    </section>
  );
}

/**
 * Search over what's known here (accounts, hashtags, statuses), plus looking up `user@domain` or a
 * link on its own server.
 */
function SearchView({ query, viewer }: { query: string; viewer: MastodonAccountRow | null }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const [text, setText] = useState(query);
  const settled = useDebounced(text);
  const results = useSearch(settled, viewer?.id);
  const resolve = useResolveRemote();
  useEffect(() => {
    if (settled !== query) go(paths.search(settled.trim() || undefined));
  }, [settled]); // eslint-disable-line react-hooks/exhaustive-deps
  const remoteLookup = /^@?[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(text.trim()) || /^https?:\/\//.test(text.trim());
  const data = results.data;
  const nothing = data && !data.accounts.length && !data.statuses.length && !data.hashtags.length;
  return (
    <div className="stack">
      <Input label={t("mastodon.search.label")} placeholder={t("mastodon.search.placeholder")} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      {remoteLookup ? (
        <Button
          variant="outline"
          disabled={resolve.isPending}
          onClick={() =>
            resolve.mutate(
              { q: text.trim().replace(/^@/, ""), account: viewer?.id ?? null },
              {
                onSuccess: (found) => {
                  if (found.statuses[0]) go(paths.status({ id: found.statuses[0] }));
                  else if (found.accounts[0]) go(paths.account({ id: found.accounts[0] }));
                },
              },
            )
          }
        >
          {resolve.isPending ? t("app.loading" as MessageKey) : t("mastodon.search.lookUp", { q: text.trim() })}
        </Button>
      ) : null}
      {resolve.error ? <Alert tone="danger">{errorText(resolve.error)}</Alert> : null}
      {resolve.data && !resolve.data.accounts.length && !resolve.data.statuses.length ? <Alert tone="info">{t("mastodon.search.nothingRemote")}</Alert> : null}
      {!settled.trim() ? <EmptyState items={t("mastodon.search.items")} description={t("mastodon.search.hint")} /> : null}
      {results.isLoading && settled.trim() ? <p className="muted">{t("app.loading" as MessageKey)}</p> : null}
      {nothing ? <EmptyState items={t("mastodon.search.items")} description={t("mastodon.search.nothing")} /> : null}
      {data?.accounts.length ? (
        <section className="stack">
          <h3 className="panel-title">{t("mastodon.search.accounts")}</h3>
          {data.accounts.map((account) => (
            <AccountRow key={account.id} account={account} />
          ))}
        </section>
      ) : null}
      {data?.hashtags.length ? (
        <section className="stack">
          <h3 className="panel-title">{t("mastodon.search.hashtags")}</h3>
          <div className="search-chips">
            {data.hashtags.map((tag) => (
              <button key={tag.id} type="button" className="search-chip" onClick={() => go(paths.tag(tag.name))}>
                #{tag.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {data?.statuses.length ? (
        <section className="mastodon-feed">
          <h3 className="panel-title">{t("mastodon.search.statuses")}</h3>
          {data.statuses.map((status: MStatus) => (
            <StatusCard key={status.id} status={status} viewer={viewer?.id ?? null} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

