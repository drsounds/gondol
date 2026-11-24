import { useMemo, useState, type ReactNode } from "react";
import { Alert, Button, Checkbox, Input, Select } from "../../../design-system/bungalow-79d923";
import { EntityPicker, type EntityOption } from "../../../entities/EntityPicker";
import { EntitySheet } from "../../../entities/EntitySheet";
import { FormActions } from "../../../entities/FormActions";
import { useI18n } from "../../../i18n/i18n";
import { mediaHost } from "../../../media/host";
import { MediaPickerDialog } from "../../../media/MediaPickerDialog";
import type { EntityType, MessageKey } from "../../../register";
import {
  accountUri,
  domainBlockUri,
  instanceUri,
  listUri,
  statusUri,
  useAdminCreateAccount,
  useAdminSetAccount,
  useDeleteDomainBlock,
  useDeleteInstance,
  useDeleteList,
  useDeleteProfile,
  useEditStatus,
  useFollowing,
  usePostStatus,
  useSaveDomainBlock,
  useSaveInstance,
  useSaveList,
  useSaveProfile,
  type MastodonListWithMembers,
} from "../models/mastodon";
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  DOMAIN_BLOCK_SEVERITIES,
  REGISTRATION_MODES,
  REPLIES_POLICIES,
  VISIBILITIES,
  type AdminAccount,
  type DomainBlock,
  type MastodonAccountRow,
  type MastodonInstance,
  type MStatus,
  type ProfileField,
  type Visibility,
} from "../models/types";
import { StatusText } from "./RichContent";
import { Avatar } from "./StatusCard";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

function TextArea({ label, hint, value, rows = 4, onChange, required, maxLength, autoFocus }: { label: string; hint?: string; value: string; rows?: number; onChange: (value: string) => void; required?: boolean; maxLength?: number; autoFocus?: boolean }) {
  return (
    <label className="mastodon-field">
      <span className="mastodon-field__label">{label}</span>
      <textarea className="bungalow-input" rows={rows} value={value} required={required} maxLength={maxLength} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="muted mastodon-field__hint">{hint}</span> : null}
    </label>
  );
}

function Preview({ kind, label, children }: { kind: string; label: ReactNode; children?: ReactNode }) {
  return (
    <div className="entity-preview">
      <div className="entity-preview__kind">{kind}</div>
      <div className="entity-preview__label">{label}</div>
      {children}
    </div>
  );
}

function Meta({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="entity-preview__meta">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An image from the media library (where the host has one) or a link to one. */
function ImageField({ label, url, mediaId, onChange }: { label: string; url: string; mediaId: string | null; onChange: (next: { url: string; mediaId: string | null }) => void }) {
  const { t } = useI18n();
  const host = mediaHost();
  const images = host.useImages();
  return (
    <div className="mastodon-image-field">
      {host.MediaPicker ? (
        <MediaPickerDialog
          label={label}
          kinds={["image"]}
          value={mediaId}
          onChange={(id) => {
            const src = id ? (images.data ?? []).find((image) => image.id === id)?.src ?? "" : "";
            onChange({ mediaId: id, url: src || (id ? url : "") });
          }}
        />
      ) : null}
      <Input
        label={host.MediaPicker ? t("mastodon.field.imageUrl") : label}
        type="url"
        placeholder="https://"
        value={url}
        onChange={(e) => onChange({ url: e.target.value, mediaId: null })}
      />
    </div>
  );
}

// ── Composing ───────────────────────────────────────────────────────────────────────────────

type MediaDraft = { url: string; description: string; mediaId: string | null };

/**
 * Writing a post, a reply (`replyTo`) or changing one of the user's posts (`editing`): text, an
 * optional content warning, who sees it, up to four images and a poll.
 */
export function ComposeSheet({
  account,
  accounts,
  maxChars,
  replyTo,
  editing,
  onClose,
  onSaved,
}: {
  account: MastodonAccountRow;
  accounts: MastodonAccountRow[];
  maxChars: number;
  replyTo?: MStatus | null;
  editing?: MStatus | null;
  onClose: () => void;
  onSaved: (status: { id: string; slug?: string; identifier?: string }) => void;
}) {
  const { t } = useI18n();
  const mentionPrefix = replyTo
    ? [replyTo.account, ...replyTo.mentions.map((m) => ({ id: m.id, acct: m.acct }))]
        .filter((who, index, all) => who.id !== account.id && all.findIndex((x) => x.id === who.id) === index)
        .map((who) => `@${who.acct} `)
        .join("")
    : "";
  const [authorId, setAuthorId] = useState(account.id);
  const [text, setText] = useState(editing?.text ?? mentionPrefix);
  const [cw, setCw] = useState(editing?.spoiler_text ?? replyTo?.spoiler_text ?? "");
  const [useCw, setUseCw] = useState(!!(editing?.spoiler_text || replyTo?.spoiler_text));
  const [sensitive, setSensitive] = useState(editing?.sensitive ?? false);
  const [visibility, setVisibility] = useState<Visibility>(replyTo && replyTo.visibility !== "public" ? replyTo.visibility : "public");
  const [language, setLanguage] = useState(editing?.language ?? "");
  const [media, setMedia] = useState<MediaDraft[]>([]);
  const [pollOn, setPollOn] = useState(false);
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [expiresIn, setExpiresIn] = useState(86400);
  const post = usePostStatus();
  const edit = useEditStatus();
  const used = text.length + (useCw ? cw.length : 0);
  const author = accounts.find((a) => a.id === authorId) ?? account;
  const pollReady = !pollOn || options.filter((o) => o.trim()).length >= 2;
  const canSend = (text.trim().length > 0 || media.some((m) => m.url) || pollOn) && used <= maxChars && pollReady;
  const pending = post.isPending || edit.isPending;
  const error = post.error ?? edit.error;

  return (
    <EntitySheet
      title={editing ? t("mastodon.compose.editTitle") : replyTo ? t("mastodon.compose.replyTitle") : t("mastodon.compose.title")}
      subtitle={replyTo ? t("mastodon.compose.replyingTo", { acct: replyTo.account.acct }) : `@${author.username}`}
      onClose={onClose}
      closeLabel={t("mastodon.close")}
      uri={editing ? statusUri(editing) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSend) return;
        if (editing) {
          edit.mutate({ id: editing.id, text, spoilerText: useCw ? cw : "", sensitive }, { onSuccess: () => onSaved(editing) });
          return;
        }
        post.mutate(
          {
            account: author.id,
            text,
            spoilerText: useCw ? cw : "",
            sensitive: sensitive || (useCw && !!cw.trim()),
            visibility,
            language: language.trim() || null,
            inReplyTo: replyTo?.id ?? null,
            media: media.filter((m) => m.url).map((m) => ({ url: m.url, description: m.description || null, media_id: m.mediaId, type: "image" })),
            poll: pollOn ? { options: options.map((o) => o.trim()).filter(Boolean), multiple, expires_in: expiresIn } : null,
          },
          { onSuccess: (saved) => onSaved(saved) },
        );
      }}
      preview={
        <Preview kind={t("entity.mastodon_status" as MessageKey)} label={author.display_name || `@${author.username}`}>
          {useCw && cw.trim() ? <p className="muted">⚠ {cw}</p> : null}
          <div className="mastodon-status__content">{text.trim() ? <StatusText text={text} domain={null} /> : <p className="muted">{t("mastodon.compose.placeholder")}</p>}</div>
          <Meta
            rows={[
              [t("mastodon.compose.visibility"), t(`mastodon.visibility.${visibility}` as MessageKey)],
              [t("mastodon.compose.characters"), `${used} / ${maxChars}`],
              ...(media.filter((m) => m.url).length ? [[t("mastodon.compose.media"), String(media.filter((m) => m.url).length)] as [string, ReactNode]] : []),
              ...(pollOn ? [[t("mastodon.compose.poll"), options.filter((o) => o.trim()).join(" · ")] as [string, ReactNode]] : []),
            ]}
          />
        </Preview>
      }
      footer={<FormActions onCancel={onClose} cancelLabel={t("mastodon.cancel")} submitLabel={editing ? t("mastodon.save") : t("mastodon.compose.publish")} saving={pending} submitDisabled={!canSend} />}
    >
      {error ? <Alert tone="danger">{errorText(error)}</Alert> : null}
      {!editing && accounts.length > 1 ? (
        <EntityPicker
          label={t("mastodon.compose.as")}
          types={["mastodon_account" as EntityType]}
          required
          options={accounts.map((a) => ({ type: "mastodon_account" as EntityType, id: a.id, title: a.display_name || a.username, subtitle: `@${a.username}` }))}
          value={authorId}
          onChange={(next) => next && setAuthorId(next)}
        />
      ) : null}
      <TextArea label={t("mastodon.compose.text")} value={text} rows={6} autoFocus onChange={setText} hint={`${used} / ${maxChars}`} />
      <Checkbox label={t("mastodon.compose.contentWarning")} checked={useCw} onChange={(e) => setUseCw(e.target.checked)} />
      {useCw ? <Input label={t("mastodon.compose.warningText")} value={cw} maxLength={1000} onChange={(e) => setCw(e.target.value)} /> : null}
      {!editing ? (
        <Select label={t("mastodon.compose.visibility")} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
          {VISIBILITIES.map((value) => (
            <option key={value} value={value}>
              {t(`mastodon.visibility.${value}` as MessageKey)} · {t(`mastodon.visibility.${value}.hint` as MessageKey)}
            </option>
          ))}
        </Select>
      ) : null}
      <Checkbox label={t("mastodon.compose.sensitive")} checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
      {!editing ? <Input label={t("mastodon.compose.language")} hint={t("mastodon.compose.languageHint")} value={language} maxLength={10} onChange={(e) => setLanguage(e.target.value)} /> : null}
      {!editing ? (
        <fieldset className="mastodon-fieldset">
          <legend>{t("mastodon.compose.media")}</legend>
          {media.map((item, index) => (
            <div key={index} className="mastodon-fieldset__item">
              <ImageField label={t("mastodon.compose.image")} url={item.url} mediaId={item.mediaId} onChange={(next) => setMedia((all) => all.map((m, i) => (i === index ? { ...m, ...next } : m)))} />
              <Input label={t("mastodon.compose.altText")} value={item.description} maxLength={1500} onChange={(e) => setMedia((all) => all.map((m, i) => (i === index ? { ...m, description: e.target.value } : m)))} />
              <Button size="sm" variant="ghost" onClick={() => setMedia((all) => all.filter((_, i) => i !== index))}>
                {t("mastodon.remove")}
              </Button>
            </div>
          ))}
          {media.length < 4 && !pollOn ? (
            <Button size="sm" variant="outline" onClick={() => setMedia((all) => [...all, { url: "", description: "", mediaId: null }])}>
              {t("mastodon.compose.addImage")}
            </Button>
          ) : null}
        </fieldset>
      ) : null}
      {!editing && !media.length ? (
        <fieldset className="mastodon-fieldset">
          <legend>{t("mastodon.compose.poll")}</legend>
          <Checkbox label={t("mastodon.compose.addPoll")} checked={pollOn} onChange={(e) => setPollOn(e.target.checked)} />
          {pollOn ? (
            <>
              {options.map((option, index) => (
                <Input key={index} label={t("mastodon.compose.option", { n: index + 1 })} value={option} maxLength={200} onChange={(e) => setOptions((all) => all.map((o, i) => (i === index ? e.target.value : o)))} />
              ))}
              {options.length < 4 ? (
                <Button size="sm" variant="outline" onClick={() => setOptions((all) => [...all, ""])}>
                  {t("mastodon.compose.addOption")}
                </Button>
              ) : null}
              <Checkbox label={t("mastodon.compose.multiple")} checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
              <Select label={t("mastodon.compose.duration")} value={String(expiresIn)} onChange={(e) => setExpiresIn(Number(e.target.value))}>
                {[300, 1800, 3600, 21600, 86400, 259200, 604800].map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds < 3600 ? t("mastodon.time.minutesLong", { count: seconds / 60 }) : seconds < 86400 ? t("mastodon.time.hoursLong", { count: seconds / 3600 }) : t("mastodon.time.daysLong", { count: seconds / 86400 })}
                  </option>
                ))}
              </Select>
            </>
          ) : null}
        </fieldset>
      ) : null}
    </EntitySheet>
  );
}

// ── Profiles ────────────────────────────────────────────────────────────────────────────────

const instanceOption = (instance: MastodonInstance): EntityOption => ({ type: "mastodon_instance" as EntityType, id: instance.id, title: instance.title, subtitle: instance.domain });

/** Setting up a profile on one of the servers here (signing up), or changing one of the user's. */
export function ProfileSheet({ account, instances, defaultInstance, onClose, onSaved }: { account?: MastodonAccountRow; instances: MastodonInstance[]; defaultInstance?: string | null; onClose: () => void; onSaved: (account: MastodonAccountRow) => void }) {
  const { t } = useI18n();
  const open = instances.filter((i) => i.registrations !== "closed");
  const [instanceId, setInstanceId] = useState<string | null>(account?.instance_id ?? defaultInstance ?? open[0]?.id ?? null);
  const [username, setUsername] = useState(account?.username ?? "");
  const [displayName, setDisplayName] = useState(account?.display_name ?? "");
  const [note, setNote] = useState(account?.note ?? "");
  const [avatar, setAvatar] = useState({ url: account?.avatar_url ?? "", mediaId: account?.avatar_media_id ?? null });
  const [header, setHeader] = useState({ url: account?.header_url ?? "", mediaId: account?.header_media_id ?? null });
  const [fields, setFields] = useState<ProfileField[]>(account?.fields?.length ? account.fields : []);
  const [locked, setLocked] = useState(account?.locked ?? false);
  const [bot, setBot] = useState(account?.bot ?? false);
  const [discoverable, setDiscoverable] = useState(account?.discoverable ?? true);
  const [indexable, setIndexable] = useState(account?.indexable ?? true);
  const [reason, setReason] = useState("");
  const save = useSaveProfile();
  const remove = useDeleteProfile();
  const instance = instances.find((i) => i.id === instanceId);
  const validName = /^[A-Za-z0-9_]{1,30}$/.test(username);
  const needsReason = !account && instance?.registrations === "approval";

  return (
    <EntitySheet
      title={account ? t("mastodon.profile.editTitle") : t("mastodon.profile.newTitle")}
      subtitle={account ? `@${account.username}` : instance?.domain}
      onClose={onClose}
      closeLabel={t("mastodon.close")}
      uri={account ? accountUri(account) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!account && (!instanceId || !validName)) return;
        const values = {
          display_name: displayName.trim() || null,
          note: note.trim() || null,
          avatar_url: avatar.url.trim() || null,
          avatar_media_id: avatar.mediaId,
          header_url: header.url.trim() || null,
          header_media_id: header.mediaId,
          fields: fields.filter((f) => f.name.trim() || f.value.trim()).map((f) => ({ name: f.name.trim(), value: f.value.trim() })),
          locked,
          bot,
          discoverable,
          indexable,
        };
        save.mutate(account ? { id: account.id, ...values } : { ...values, instance_id: instanceId!, username: username.trim(), reason: reason.trim() || null }, { onSuccess: onSaved });
      }}
      preview={
        <div className="mastodon-profile-preview">
          {header.url ? <img className="mastodon-profile-preview__header" src={header.url} alt="" referrerPolicy="no-referrer" /> : <div className="mastodon-profile-preview__header" />}
          <Avatar account={{ avatar: avatar.url || null, username: username || "?", display_name: displayName }} size={72} />
          <div className="entity-preview__label">{displayName.trim() || username || t("mastodon.profile.untitled")}</div>
          <div className="muted">@{username || "…"}@{instance?.domain ?? "…"}</div>
          {note.trim() ? (
            <div className="mastodon-status__content">
              <StatusText text={note} domain={null} />
            </div>
          ) : null}
          <Meta rows={fields.filter((f) => f.name.trim()).map((f) => [f.name, f.value])} />
          {!account && instance ? <p className="muted">{t(`mastodon.registrations.${instance.registrations}.hint` as MessageKey)}</p> : null}
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("mastodon.cancel")}
          onDelete={
            account
              ? () => {
                  if (window.confirm(t("mastodon.profile.confirmDelete", { acct: account.username }))) remove.mutate(account.id, { onSuccess: onClose });
                }
              : undefined
          }
          deleteLabel={t("mastodon.profile.delete")}
          deleting={remove.isPending}
          submitLabel={account ? t("mastodon.save") : t("mastodon.profile.create")}
          saving={save.isPending}
          submitDisabled={!account && (!instanceId || !validName || (needsReason && !reason.trim()))}
        />
      }
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      {!account ? (
        <>
          {open.length === 0 ? <Alert tone="warning">{t("mastodon.profile.noServers")}</Alert> : null}
          <EntityPicker
            label={t("mastodon.profile.server")}
            types={["mastodon_instance" as EntityType]}
            required
            options={open.map(instanceOption)}
            value={instanceId}
            onChange={(next) => setInstanceId(next)}
          />
          {instance?.registration_message ? <p className="muted">{instance.registration_message}</p> : null}
          {instance?.rules?.length ? (
            <ol className="mastodon-rules">
              {instance.rules.map((rule, i) => (
                <li key={i}>{rule.text}</li>
              ))}
            </ol>
          ) : null}
          <Input
            label={t("mastodon.profile.username")}
            hint={t("mastodon.profile.usernameHint")}
            value={username}
            required
            autoFocus
            maxLength={30}
            error={username && !validName ? t("mastodon.profile.usernameInvalid") : undefined}
            onChange={(e) => setUsername(e.target.value)}
          />
        </>
      ) : null}
      <Input label={t("mastodon.profile.displayName")} value={displayName} maxLength={200} onChange={(e) => setDisplayName(e.target.value)} />
      <TextArea label={t("mastodon.profile.bio")} hint={t("mastodon.profile.bioHint")} value={note} maxLength={5000} onChange={setNote} />
      <ImageField label={t("mastodon.profile.avatar")} url={avatar.url} mediaId={avatar.mediaId} onChange={setAvatar} />
      <ImageField label={t("mastodon.profile.header")} url={header.url} mediaId={header.mediaId} onChange={setHeader} />
      <fieldset className="mastodon-fieldset">
        <legend>{t("mastodon.profile.fields")}</legend>
        {fields.map((field, index) => (
          <div key={index} className="mastodon-fieldset__pair">
            <Input label={t("mastodon.profile.fieldName")} value={field.name} maxLength={255} onChange={(e) => setFields((all) => all.map((f, i) => (i === index ? { ...f, name: e.target.value } : f)))} />
            <Input label={t("mastodon.profile.fieldValue")} value={field.value} maxLength={255} onChange={(e) => setFields((all) => all.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)))} />
            <Button size="sm" variant="ghost" onClick={() => setFields((all) => all.filter((_, i) => i !== index))}>
              {t("mastodon.remove")}
            </Button>
          </div>
        ))}
        {fields.length < 4 ? (
          <Button size="sm" variant="outline" onClick={() => setFields((all) => [...all, { name: "", value: "" }])}>
            {t("mastodon.profile.addField")}
          </Button>
        ) : null}
      </fieldset>
      <Checkbox label={t("mastodon.profile.locked")} checked={locked} onChange={(e) => setLocked(e.target.checked)} />
      <Checkbox label={t("mastodon.profile.bot")} checked={bot} onChange={(e) => setBot(e.target.checked)} />
      <Checkbox label={t("mastodon.profile.discoverable")} checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} />
      <Checkbox label={t("mastodon.profile.indexable")} checked={indexable} onChange={(e) => setIndexable(e.target.checked)} />
      {needsReason ? <TextArea label={t("mastodon.profile.reason")} hint={t("mastodon.profile.reasonHint")} value={reason} required maxLength={1000} onChange={setReason} /> : null}
    </EntitySheet>
  );
}

// ── Lists ───────────────────────────────────────────────────────────────────────────────────

export function ListSheet({ list, account, onClose, onSaved }: { list?: MastodonListWithMembers; account: MastodonAccountRow; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(list?.title ?? "");
  const [repliesPolicy, setRepliesPolicy] = useState<string>(list?.replies_policy ?? "list");
  const [exclusive, setExclusive] = useState(list?.exclusive ?? false);
  const [members, setMembers] = useState<string[]>(list?.members ?? []);
  const following = useFollowing(account.id);
  const options = useMemo<EntityOption[]>(
    () =>
      (following.data ?? []).map((a) => ({
        type: "mastodon_account" as EntityType,
        id: a.id,
        title: a.display_name || a.username,
        subtitle: a.domain ? `@${a.username}@${a.domain}` : `@${a.username}`,
      })),
    [following.data],
  );
  const save = useSaveList();
  const remove = useDeleteList();
  return (
    <EntitySheet
      title={list ? t("mastodon.list.editTitle") : t("mastodon.list.newTitle")}
      subtitle={list?.title}
      onClose={onClose}
      closeLabel={t("mastodon.close")}
      uri={list ? listUri(list) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        save.mutate({ id: list?.id, account_id: account.id, title: title.trim(), replies_policy: repliesPolicy, exclusive, members }, { onSuccess: onSaved });
      }}
      preview={
        <Preview kind={t("entity.mastodon_list" as MessageKey)} label={title.trim() || t("mastodon.list.untitled")}>
          <Meta
            rows={[
              [t("mastodon.list.members"), String(members.length)],
              [t("mastodon.list.replies"), t(`mastodon.list.replies.${repliesPolicy}` as MessageKey)],
              [t("mastodon.list.exclusive"), exclusive ? "✓" : "—"],
            ]}
          />
        </Preview>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("mastodon.cancel")}
          onDelete={
            list
              ? () => {
                  if (window.confirm(t("mastodon.confirmDelete", { name: list.title }))) remove.mutate(list.id, { onSuccess: onClose });
                }
              : undefined
          }
          deleteLabel={t("mastodon.delete")}
          deleting={remove.isPending}
          submitLabel={t("mastodon.save")}
          saving={save.isPending}
          submitDisabled={!title.trim()}
        />
      }
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      <Input label={t("mastodon.list.title")} value={title} required autoFocus maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      <Select label={t("mastodon.list.replies")} value={repliesPolicy} onChange={(e) => setRepliesPolicy(e.target.value)}>
        {REPLIES_POLICIES.map((value) => (
          <option key={value} value={value}>
            {t(`mastodon.list.replies.${value}` as MessageKey)}
          </option>
        ))}
      </Select>
      <Checkbox label={t("mastodon.list.exclusive")} checked={exclusive} onChange={(e) => setExclusive(e.target.checked)} />
      <EntityPicker
        label={t("mastodon.list.members")}
        hint={t("mastodon.list.membersHint")}
        types={["mastodon_account" as EntityType]}
        multiple
        options={options}
        value={members}
        onChange={(next) => setMembers(next)}
      />
    </EntitySheet>
  );
}

// ── Running a server ────────────────────────────────────────────────────────────────────────

/** Setting up a server (the domain it answers on) or changing how it presents itself and takes people in. */
export function InstanceSheet({ instance, onClose, onSaved }: { instance?: MastodonInstance; onClose: () => void; onSaved: (instance: MastodonInstance) => void }) {
  const { t } = useI18n();
  const [domain, setDomain] = useState(instance?.domain ?? (typeof window !== "undefined" ? window.location.hostname : ""));
  const [title, setTitle] = useState(instance?.title ?? "");
  const [shortDescription, setShortDescription] = useState(instance?.short_description ?? "");
  const [description, setDescription] = useState(instance?.description ?? "");
  const [contactEmail, setContactEmail] = useState(instance?.contact_email ?? "");
  const [registrations, setRegistrations] = useState<string>(instance?.registrations ?? "approval");
  const [registrationMessage, setRegistrationMessage] = useState(instance?.registration_message ?? "");
  const [rules, setRules] = useState((instance?.rules ?? []).map((rule) => rule.text).join("\n"));
  const [languages, setLanguages] = useState((instance?.languages ?? ["en"]).join(", "));
  const [maxChars, setMaxChars] = useState(String(instance?.max_status_chars ?? 500));
  const [thumbnail, setThumbnail] = useState({ url: instance?.thumbnail_url ?? "", mediaId: null as string | null });
  const save = useSaveInstance();
  const remove = useDeleteInstance();
  const ruleList = rules.split("\n").map((r) => r.trim()).filter(Boolean);

  return (
    <EntitySheet
      title={instance ? t("mastodon.instance.editTitle") : t("mastodon.instance.newTitle")}
      subtitle={instance?.domain}
      onClose={onClose}
      closeLabel={t("mastodon.close")}
      uri={instance ? instanceUri(instance) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!domain.trim() || !title.trim()) return;
        save.mutate(
          {
            id: instance?.id,
            domain: domain.trim(),
            title: title.trim(),
            short_description: shortDescription.trim() || null,
            description: description.trim() || null,
            contact_email: contactEmail.trim() || null,
            registrations: registrations as MastodonInstance["registrations"],
            registration_message: registrationMessage.trim() || null,
            rules: ruleList.map((text) => ({ text })),
            languages: languages.split(/[\s,]+/).map((l) => l.trim().toLowerCase()).filter(Boolean),
            max_status_chars: Math.min(100000, Math.max(100, Number(maxChars) || 500)),
            thumbnail_url: thumbnail.url.trim() || null,
          },
          { onSuccess: onSaved },
        );
      }}
      preview={
        <Preview kind={t("entity.mastodon_instance" as MessageKey)} label={title.trim() || t("mastodon.instance.untitled")}>
          <p className="muted">{domain.trim() || "…"}</p>
          {shortDescription.trim() ? <p>{shortDescription}</p> : null}
          <Meta
            rows={[
              [t("mastodon.instance.registrations"), t(`mastodon.registrations.${registrations}` as MessageKey)],
              [t("mastodon.instance.maxChars"), maxChars],
              [t("mastodon.instance.rules"), String(ruleList.length)],
            ]}
          />
        </Preview>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("mastodon.cancel")}
          onDelete={
            instance
              ? () => {
                  if (window.confirm(t("mastodon.instance.confirmDelete", { domain: instance.domain }))) remove.mutate(instance.id, { onSuccess: onClose });
                }
              : undefined
          }
          deleteLabel={t("mastodon.delete")}
          deleting={remove.isPending}
          submitLabel={t("mastodon.save")}
          saving={save.isPending}
          submitDisabled={!domain.trim() || !title.trim()}
        />
      }
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      <Input label={t("mastodon.instance.domain")} hint={t("mastodon.instance.domainHint")} value={domain} required disabled={!!instance} onChange={(e) => setDomain(e.target.value)} />
      <Input label={t("mastodon.instance.title")} value={title} required autoFocus maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      <Input label={t("mastodon.instance.shortDescription")} value={shortDescription} maxLength={500} onChange={(e) => setShortDescription(e.target.value)} />
      <TextArea label={t("mastodon.instance.description")} value={description} maxLength={20000} onChange={setDescription} />
      <Input label={t("mastodon.instance.contactEmail")} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
      <Select label={t("mastodon.instance.registrations")} value={registrations} onChange={(e) => setRegistrations(e.target.value)}>
        {REGISTRATION_MODES.map((value) => (
          <option key={value} value={value}>
            {t(`mastodon.registrations.${value}` as MessageKey)}
          </option>
        ))}
      </Select>
      {registrations === "approval" ? <TextArea label={t("mastodon.instance.registrationMessage")} value={registrationMessage} rows={2} onChange={setRegistrationMessage} /> : null}
      <TextArea label={t("mastodon.instance.rules")} hint={t("mastodon.instance.rulesHint")} value={rules} onChange={setRules} />
      <Input label={t("mastodon.instance.languages")} hint={t("mastodon.instance.languagesHint")} value={languages} onChange={(e) => setLanguages(e.target.value)} />
      <Input label={t("mastodon.instance.maxChars")} type="number" min={100} max={100000} value={maxChars} onChange={(e) => setMaxChars(e.target.value)} />
      <ImageField label={t("mastodon.instance.thumbnail")} url={thumbnail.url} mediaId={thumbnail.mediaId} onChange={setThumbnail} />
    </EntitySheet>
  );
}

/** A moderator's sheet for one of the server's people: status, role and a private note. */
export function AdminAccountSheet({ entry, onClose, isAdmin }: { entry: AdminAccount; onClose: () => void; isAdmin: boolean }) {
  const { t, intlLocale } = useI18n();
  const account = entry.account;
  const [status, setStatus] = useState<string>(account.status === "pending" ? "active" : account.status);
  const [role, setRole] = useState<string>(account.role);
  const [note, setNote] = useState(entry.admin_note ?? "");
  const save = useAdminSetAccount();
  return (
    <EntitySheet
      title={t("mastodon.admin.accountTitle")}
      subtitle={`@${account.acct}`}
      onClose={onClose}
      closeLabel={t("mastodon.close")}
      uri={accountUri(account)}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          { account: account.id, status: status !== account.status ? status : null, role: role !== account.role ? role : null, adminNote: note },
          { onSuccess: onClose },
        );
      }}
      preview={
        <Preview kind={t("entity.mastodon_account" as MessageKey)} label={account.display_name || account.username}>
          <p className="muted">@{account.acct}</p>
          <Meta
            rows={[
              [t("mastodon.admin.email"), entry.email ?? "—"],
              [t("mastodon.admin.status"), t(`mastodon.accountStatus.${account.status}` as MessageKey)],
              [t("mastodon.admin.role"), t(`mastodon.role.${account.role}` as MessageKey)],
              [t("mastodon.admin.joined"), new Date(account.created_at).toLocaleDateString(intlLocale)],
              [t("mastodon.profile.posts"), String(account.statuses_count)],
            ]}
          />
          {entry.reason ? <p>“{entry.reason}”</p> : null}
        </Preview>
      }
      footer={<FormActions onCancel={onClose} cancelLabel={t("mastodon.cancel")} submitLabel={account.status === "pending" && status === "active" ? t("mastodon.admin.approve") : t("mastodon.save")} saving={save.isPending} />}
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      {entry.reason ? (
        <p>
          <strong>{t("mastodon.profile.reason")}:</strong> {entry.reason}
        </p>
      ) : null}
      <Select label={t("mastodon.admin.status")} value={status} onChange={(e) => setStatus(e.target.value)}>
        {ACCOUNT_STATUSES.filter((value) => value !== "pending").map((value) => (
          <option key={value} value={value}>
            {t(`mastodon.accountStatus.${value}` as MessageKey)} · {t(`mastodon.accountStatus.${value}.hint` as MessageKey)}
          </option>
        ))}
      </Select>
      <Select label={t("mastodon.admin.role")} value={role} disabled={!isAdmin} onChange={(e) => setRole(e.target.value)}>
        {ACCOUNT_ROLES.map((value) => (
          <option key={value} value={value}>
            {t(`mastodon.role.${value}` as MessageKey)}
          </option>
        ))}
      </Select>
      <TextArea label={t("mastodon.admin.note")} hint={t("mastodon.admin.noteHint")} value={note} maxLength={5000} onChange={setNote} />
    </EntitySheet>
  );
}

/** An admin adds someone who already has an account in the app (by e-mail) to the server. */
export function CreateAccountSheet({ instance, onClose, onSaved }: { instance: MastodonInstance; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("user");
  const create = useAdminCreateAccount();
  const valid = /^[A-Za-z0-9_]{1,30}$/.test(username) && email.includes("@");
  return (
    <EntitySheet
      title={t("mastodon.admin.newAccountTitle")}
      subtitle={instance.domain}
      onClose={onClose}
      closeLabel={t("mastodon.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        create.mutate({ instance: instance.id, email: email.trim(), username: username.trim(), displayName: displayName.trim(), role }, { onSuccess: onSaved });
      }}
      preview={
        <Preview kind={t("entity.mastodon_account" as MessageKey)} label={displayName.trim() || username || t("mastodon.profile.untitled")}>
          <p className="muted">
            @{username || "…"}@{instance.domain}
          </p>
          <Meta
            rows={[
              [t("mastodon.admin.email"), email || "—"],
              [t("mastodon.admin.role"), t(`mastodon.role.${role}` as MessageKey)],
            ]}
          />
        </Preview>
      }
      footer={<FormActions onCancel={onClose} cancelLabel={t("mastodon.cancel")} submitLabel={t("mastodon.profile.create")} saving={create.isPending} submitDisabled={!valid} />}
    >
      {create.error ? <Alert tone="danger">{errorText(create.error)}</Alert> : null}
      <Input label={t("mastodon.admin.email")} hint={t("mastodon.admin.emailHint")} type="email" value={email} required autoFocus onChange={(e) => setEmail(e.target.value)} />
      <Input label={t("mastodon.profile.username")} hint={t("mastodon.profile.usernameHint")} value={username} required maxLength={30} onChange={(e) => setUsername(e.target.value)} />
      <Input label={t("mastodon.profile.displayName")} value={displayName} maxLength={200} onChange={(e) => setDisplayName(e.target.value)} />
      <Select label={t("mastodon.admin.role")} value={role} onChange={(e) => setRole(e.target.value)}>
        {ACCOUNT_ROLES.map((value) => (
          <option key={value} value={value}>
            {t(`mastodon.role.${value}` as MessageKey)}
          </option>
        ))}
      </Select>
    </EntitySheet>
  );
}

/** Blocking (silencing or suspending) another server. */
export function DomainBlockSheet({ block, instance, onClose, onSaved }: { block?: DomainBlock; instance: MastodonInstance; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [domain, setDomain] = useState(block?.domain ?? "");
  const [severity, setSeverity] = useState<string>(block?.severity ?? "silence");
  const [rejectMedia, setRejectMedia] = useState(block?.reject_media ?? false);
  const [publicComment, setPublicComment] = useState(block?.public_comment ?? "");
  const [privateComment, setPrivateComment] = useState(block?.private_comment ?? "");
  const save = useSaveDomainBlock();
  const remove = useDeleteDomainBlock();
  return (
    <EntitySheet
      title={block ? t("mastodon.block.editTitle") : t("mastodon.block.newTitle")}
      subtitle={instance.domain}
      onClose={onClose}
      closeLabel={t("mastodon.close")}
      uri={block ? domainBlockUri(block) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!domain.trim()) return;
        save.mutate(
          {
            id: block?.id,
            instance_id: instance.id,
            domain: domain.trim().toLowerCase(),
            severity: severity as DomainBlock["severity"],
            reject_media: rejectMedia,
            public_comment: publicComment.trim() || null,
            private_comment: privateComment.trim() || null,
          },
          { onSuccess: onSaved },
        );
      }}
      preview={
        <Preview kind={t("entity.mastodon_domain_block" as MessageKey)} label={domain.trim() || "…"}>
          <Meta
            rows={[
              [t("mastodon.block.severity"), t(`mastodon.block.severity.${severity}` as MessageKey)],
              [t("mastodon.block.rejectMedia"), rejectMedia ? "✓" : "—"],
            ]}
          />
          {publicComment.trim() ? <p>{publicComment}</p> : null}
        </Preview>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("mastodon.cancel")}
          onDelete={
            block
              ? () => {
                  if (window.confirm(t("mastodon.confirmDelete", { name: block.domain }))) remove.mutate(block.id, { onSuccess: onClose });
                }
              : undefined
          }
          deleteLabel={t("mastodon.block.lift")}
          deleting={remove.isPending}
          submitLabel={t("mastodon.save")}
          saving={save.isPending}
          submitDisabled={!domain.trim()}
        />
      }
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      <Input label={t("mastodon.block.domain")} hint={t("mastodon.block.domainHint")} value={domain} required autoFocus disabled={!!block} onChange={(e) => setDomain(e.target.value)} />
      <Select label={t("mastodon.block.severity")} value={severity} onChange={(e) => setSeverity(e.target.value)}>
        {DOMAIN_BLOCK_SEVERITIES.map((value) => (
          <option key={value} value={value}>
            {t(`mastodon.block.severity.${value}` as MessageKey)} · {t(`mastodon.block.severity.${value}.hint` as MessageKey)}
          </option>
        ))}
      </Select>
      <Checkbox label={t("mastodon.block.rejectMedia")} checked={rejectMedia} onChange={(e) => setRejectMedia(e.target.checked)} />
      <TextArea label={t("mastodon.block.publicComment")} value={publicComment} rows={2} onChange={setPublicComment} />
      <TextArea label={t("mastodon.block.privateComment")} value={privateComment} rows={2} onChange={setPrivateComment} />
    </EntitySheet>
  );
}
