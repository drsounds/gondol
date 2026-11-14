import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button } from "../../../../../../design-system/bungalow-79d923";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { useI18n } from "../../../../../../i18n/i18n";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import { useSession } from "../../../../../../supabase/useSession";
import type { MessageKey } from "../../../../../../register";
import { AdminAccountSheet, CreateAccountSheet, DomainBlockSheet, InstanceSheet } from "../../../../components/Sheets";
import {
  accountUri,
  domainBlockUri,
  findByKey,
  instanceUri,
  keyOf,
  mastodonDb,
  paths,
  useAdminAccounts,
  useAdminSetAccount,
  useDomainBlocks,
  useInstances,
  useMyAccounts,
} from "../../../../models/mastodon";
import type { DomainBlock, MastodonInstance } from "../../../../models/types";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

/**
 * Running Mastodon servers (`/mastodon-instances`): the servers here, and for each one its people
 * (approving sign-ups, silencing, suspending, roles, adding someone by e-mail) and the servers it
 * blocks.
 *
 *   /mastodon-instances/new, /<key>/edit                        the server's sheet
 *   /mastodon-instances/<key>[/people|/domain-blocks]          a server
 *   /mastodon-instances/<key>/people/{new,<account key>/edit}  people
 *   /mastodon-instances/<key>/domain-blocks/{new,<key>/edit}   blocked servers
 *   /mastodon-instances/domain-blocks/<key>/edit               where a domain block's URI points
 */
export function InstancesPage({ splat }: AppFeaturePageProps) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const instances = useInstances();
  const parts = (splat ?? "").split("/").filter(Boolean).map(decodeURIComponent);
  const rows = instances.data ?? [];

  if (parts[0] === "domain-blocks" && parts[1]) return <DomainBlockForward blockKey={parts[1]} instances={rows} />;
  if (instances.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  if (parts[0] && parts[0] !== "new") {
    const instance = findByKey(rows, parts[0]);
    if (!instance) return <EmptyState items={t("mastodon.instance.items")} description={t("mastodon.instance.notFound")} />;
    return <InstanceView instance={instance} rest={parts.slice(1)} />;
  }

  return (
    <div className="stack mastodon">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("mastodon.instances.title")}</h2>
          <p className="muted">{t("mastodon.instances.intro")}</p>
        </div>
        <Button size="sm" tone="primary" onClick={() => go(paths.newInstance)}>
          {t("mastodon.instance.new")}
        </Button>
      </div>
      {instances.error ? <Alert tone="danger">{errorText(instances.error)}</Alert> : null}
      {!rows.length ? (
        <EmptyState items={t("mastodon.instance.items")} actionLabel={t("mastodon.instance.new")} onAction={() => go(paths.newInstance)} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("mastodon.instance.title")}</th>
              <th>{t("mastodon.instance.domain")}</th>
              <th>{t("mastodon.instance.registrations")}</th>
              <th className="action-row-cell" aria-label={t("mastodon.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((instance) => (
              <tr key={instance.id} className="action-row">
                <td>
                  <button type="button" className="link-button" onClick={() => go(paths.instance(instance))}>
                    {instance.title}
                  </button>
                  {instance.short_description ? <div className="muted">{instance.short_description}</div> : null}
                </td>
                <td>{instance.domain}</td>
                <td>{t(`mastodon.registrations.${instance.registrations}` as MessageKey)}</td>
                <td className="action-row-cell">
                  <ActionMenu
                    name={instance.title}
                    uri={instanceUri(instance)}
                    actions={[
                      { key: "open", label: t("mastodon.instance.open"), onSelect: () => go(paths.instance(instance)) },
                      { key: "edit", label: t("mastodon.edit"), onSelect: () => go(paths.editInstance(instance)) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {parts[0] === "new" ? <InstanceSheet onClose={() => go(paths.instances)} onSaved={(saved) => go(paths.instance(saved))} /> : null}
    </div>
  );
}

const SECTIONS = ["people", "domain-blocks"] as const;

function InstanceView({ instance, rest }: { instance: MastodonInstance; rest: string[] }) {
  const { t, intlLocale } = useI18n();
  const go = useNavigateKeepingSearch();
  const { session } = useSession();
  const mine = useMyAccounts();
  const [sectionPart, key, action] = rest;
  const section = sectionPart === "domain-blocks" ? "domain-blocks" : "people";
  const base = paths.instance(instance);
  const myRole = (mine.data ?? []).find((a) => a.instance_id === instance.id && a.status === "active")?.role;
  const isOwner = instance.user_id === session?.user.id;
  const isAdmin = isOwner || myRole === "owner" || myRole === "admin";
  const isModerator = isAdmin || myRole === "moderator";
  const people = useAdminAccounts(instance.id, isModerator);
  const blocks = useDomainBlocks(instance.id, isModerator);
  const setAccount = useAdminSetAccount();
  const entries = people.data ?? [];
  const pending = entries.filter((e) => e.account.status === "pending").length;

  const sheet =
    sectionPart === "edit" ? (
      <InstanceSheet instance={instance} onClose={() => go(base)} onSaved={(saved) => go(paths.instance(saved))} />
    ) : section === "people" && key === "new" && isAdmin ? (
      <CreateAccountSheet instance={instance} onClose={() => go(`${base}/people`)} onSaved={() => go(`${base}/people`)} />
    ) : section === "people" && key && action === "edit" ? (
      (() => {
        const entry = entries.find((e) => e.account.slug === key || e.account.identifier === key || e.account.id === key);
        return entry ? <AdminAccountSheet key={entry.account.id} entry={entry} isAdmin={isAdmin} onClose={() => go(`${base}/people`)} /> : null;
      })()
    ) : section === "domain-blocks" && (key === "new" || action === "edit") && isAdmin ? (
      (() => {
        const block = key === "new" ? undefined : findByKey(blocks.data ?? [], key);
        if (key !== "new" && !block) return null;
        return <DomainBlockSheet key={key} block={block} instance={instance} onClose={() => go(`${base}/domain-blocks`)} onSaved={() => go(`${base}/domain-blocks`)} />;
      })()
    ) : null;

  return (
    <div className="stack mastodon">
      <div className="panel-head">
        <div>
          <button type="button" className="link-button muted" onClick={() => go(paths.instances)}>
            ← {t("mastodon.instances.title")}
          </button>
          <h2 className="panel-title">{instance.title}</h2>
          <p className="muted">
            {instance.domain} · {t(`mastodon.registrations.${instance.registrations}` as MessageKey)}
          </p>
        </div>
        <div className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => go(`/mastodon/accounts/new`)}>
            {t("mastodon.profile.new")}
          </Button>
          {isAdmin ? (
            <Button size="sm" variant="outline" onClick={() => go(`${base}/edit`)}>
              {t("mastodon.edit")}
            </Button>
          ) : null}
          {isAdmin ? (
            <Button size="sm" tone="primary" onClick={() => go(section === "people" ? `${base}/people/new` : `${base}/domain-blocks/new`)}>
              {section === "people" ? t("mastodon.admin.newAccount") : t("mastodon.block.new")}
            </Button>
          ) : null}
        </div>
      </div>
      {instance.description ? <p>{instance.description}</p> : null}
      {!isModerator ? (
        <Alert tone="info">{t("mastodon.admin.notModerator")}</Alert>
      ) : (
        <>
          <div className="search-chips" role="tablist">
            {SECTIONS.map((value) => (
              <button key={value} type="button" role="tab" className="search-chip" aria-selected={section === value} onClick={() => go(`${base}/${value}`)}>
                {t(`mastodon.admin.section.${value}` as MessageKey)}
                {value === "people" && pending ? ` (${pending})` : ""}
              </button>
            ))}
          </div>
          {section === "people" ? (
            people.isLoading ? (
              <p className="muted">{t("app.loading" as MessageKey)}</p>
            ) : people.error ? (
              <Alert tone="danger">{errorText(people.error)}</Alert>
            ) : !entries.length ? (
              <EmptyState items={t("mastodon.profile.items")} actionLabel={isAdmin ? t("mastodon.admin.newAccount") : undefined} onAction={isAdmin ? () => go(`${base}/people/new`) : undefined} />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("mastodon.profile.displayName")}</th>
                    <th>{t("mastodon.admin.email")}</th>
                    <th>{t("mastodon.admin.status")}</th>
                    <th>{t("mastodon.admin.role")}</th>
                    <th>{t("mastodon.admin.joined")}</th>
                    <th className="action-row-cell" aria-label={t("mastodon.actions")} />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const account = entry.account;
                    const edit = () => go(`${base}/people/${keyOf(account)}/edit`);
                    const set = (status: string) => setAccount.mutate({ account: account.id, status });
                    return (
                      <tr key={account.id} className="action-row">
                        <td>
                          <button type="button" className="link-button" onClick={edit}>
                            {account.display_name || account.username}
                          </button>
                          <div className="muted">@{account.username}</div>
                        </td>
                        <td>{entry.email ?? "—"}</td>
                        <td>
                          <Badge tone={account.status === "active" ? "success" : account.status === "pending" ? "warning" : account.status === "silenced" ? "info" : "danger"}>
                            {t(`mastodon.accountStatus.${account.status}` as MessageKey)}
                          </Badge>
                        </td>
                        <td>{t(`mastodon.role.${account.role}` as MessageKey)}</td>
                        <td>{new Date(account.created_at).toLocaleDateString(intlLocale)}</td>
                        <td className="action-row-cell">
                          <ActionMenu
                            name={`@${account.username}`}
                            uri={accountUri(account)}
                            actions={[
                              ...(account.status === "pending" ? [{ key: "approve", label: t("mastodon.admin.approve"), onSelect: () => set("active") }] : []),
                              { key: "edit", label: t("mastodon.admin.manage"), onSelect: edit },
                              { key: "profile", label: t("mastodon.profile.open"), onSelect: () => go(paths.account(account)) },
                              ...(account.status === "active" ? [{ key: "silence", label: t("mastodon.admin.silence"), onSelect: () => set("silenced") }] : []),
                              ...(account.status === "suspended" || account.status === "silenced" || account.status === "disabled"
                                ? [{ key: "restore", label: t("mastodon.admin.restore"), onSelect: () => set("active") }]
                                : []),
                              ...(account.status === "pending"
                                ? [{ key: "reject", label: t("mastodon.admin.reject"), tone: "danger" as const, onSelect: () => set("disabled") }]
                                : account.status !== "suspended"
                                  ? [
                                      {
                                        key: "suspend",
                                        label: t("mastodon.admin.suspend"),
                                        tone: "danger" as const,
                                        onSelect: () => {
                                          if (window.confirm(t("mastodon.admin.confirmSuspend", { acct: account.username }))) set("suspended");
                                        },
                                      },
                                    ]
                                  : []),
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : blocks.isLoading ? (
            <p className="muted">{t("app.loading" as MessageKey)}</p>
          ) : blocks.error ? (
            <Alert tone="danger">{errorText(blocks.error)}</Alert>
          ) : !(blocks.data ?? []).length ? (
            <EmptyState items={t("mastodon.block.items")} actionLabel={isAdmin ? t("mastodon.block.new") : undefined} onAction={isAdmin ? () => go(`${base}/domain-blocks/new`) : undefined} />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("mastodon.block.domain")}</th>
                  <th>{t("mastodon.block.severity")}</th>
                  <th>{t("mastodon.block.publicComment")}</th>
                  <th className="action-row-cell" aria-label={t("mastodon.actions")} />
                </tr>
              </thead>
              <tbody>
                {(blocks.data ?? []).map((block) => (
                  <tr key={block.id} className="action-row">
                    <td>{block.domain}</td>
                    <td>{t(`mastodon.block.severity.${block.severity}` as MessageKey)}</td>
                    <td>{block.public_comment ?? ""}</td>
                    <td className="action-row-cell">
                      <ActionMenu
                        name={block.domain}
                        uri={domainBlockUri(block)}
                        actions={isAdmin ? [{ key: "edit", label: t("mastodon.edit"), onSelect: () => go(`${base}/domain-blocks/${keyOf(block)}/edit`) }] : []}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {setAccount.error ? <Alert tone="danger">{errorText(setAccount.error)}</Alert> : null}
        </>
      )}
      {sheet}
    </div>
  );
}

/** `/mastodon-instances/domain-blocks/<key>/edit`: opens the block's sheet on its server. */
function DomainBlockForward({ blockKey, instances }: { blockKey: string; instances: MastodonInstance[] }) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const block = useQuery({
    queryKey: ["gondol", "mastodon", "domain-block", blockKey],
    queryFn: async () => {
      const { data, error } = await mastodonDb().from("mastodon_domain_blocks").select("*").or(`slug.eq.${blockKey},identifier.eq.${blockKey}`).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      return data as DomainBlock | null;
    },
  });
  const instance = block.data ? instances.find((i) => i.id === block.data!.instance_id) : undefined;
  useEffect(() => {
    if (instance && block.data) go(`${paths.instance(instance)}/domain-blocks/${keyOf(block.data)}/edit`);
  }, [instance, block.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (block.isLoading) return <p className="muted">{t("app.loading" as MessageKey)}</p>;
  if (!block.data) return <EmptyState items={t("mastodon.block.items")} description={t("mastodon.notFound")} />;
  return null;
}
