import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Badge, Button, Card, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntityPicker } from "../../../../../../entities/EntityPicker";
import { EntitySheet } from "../../../../../../entities/EntitySheet";
import { FormActions } from "../../../../../../entities/FormActions";
import { useEntityDropTarget } from "../../../../../../entities/dragEntity";
import { entityTypeLabel, labelFor, useEntityLabels } from "../../../../../../entities/lookup";
import { entityKey, findByEntityKey } from "../../../../../../entities/slugs";
import { isEntityUri, toEntityUri } from "../../../../../../entities/uri";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import type { DateRangeSearch } from "../../../../../../navigation/dateRangeSearch";
import { useEntityModal } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import {
  formatDuration,
  sumEntries as sum,
  toLocalInput,
  fromLocalInput,
  useContextDurations,
  useDeleteStream,
  useDeleteStreamEntry,
  useSaveStream,
  useSaveStreamEntry,
  useStreamAccounts,
  useStreamEntries,
  useStreams,
  type EntryDraft,
  type Stream,
  type StreamAccount,
  type StreamDraft,
  type StreamEntry,
  type StreamSource,
} from "../../../../models";

const streamUri = (id: string) => toEntityUri("stream", id);

const emptyStream = (): StreamDraft => ({
  action: "",
  context_uri: "",
  object_uri: "",
  motivation_uri: "",
  description: "",
  source: "manual",
  start_date: toLocalInput(new Date().toISOString()),
  end_date: "",
  quantity: "1",
});
const emptyEntry = (objectUri = ""): EntryDraft => ({
  object_uri: objectUri,
  yin: "0",
  yang: "0",
  yin_account_id: "",
  yang_account_id: "",
  description: "",
});

/** Seconds between two datetime-local values, or null while the end is missing (or before the start). */
function draftDuration(start: string, end: string): number | null {
  const from = fromLocalInput(start);
  const to = fromLocalInput(end);
  if (!from || !to) return null;
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  return seconds >= 0 ? seconds : null;
}

/**
 * Streams (ported from gantt-resume-pro): a user's action (the predicate) on an object, in a task
 * context, for a motivation, from a start to an end. Each entry moves yin (out) and yang (in) to an
 * object entity, optionally booked against the host's accounts. A stream is in equilibrium when its
 * yin and yang balance, and new or edited entries must keep it that way.
 */
export function StreamsPanel() {
  const { t, intlLocale } = useI18n();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const streams = useStreams().data ?? [];
  const entries = useStreamEntries().data ?? [];
  const contextDurations = useContextDurations().data ?? {};
  const accountsQuery = useStreamAccounts();
  const accounts = accountsQuery.data ?? [];
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // An entity dropped on a stream opens its "new entry" modal with the object pre-filled.
  const [pendingObject, setPendingObject] = useState("");

  const streamModal = useEntityModal("/streams");
  const entryStreamKey = /^\/streams\/([^/]+)\/entries\//.exec(pathname)?.[1] ?? null;
  const entryModal = useEntityModal(`/streams/${entryStreamKey ?? "_"}/entries`, "/streams");
  const entryStream = findByEntityKey(streams, entryStreamKey);
  const editingStream = streamModal.mode === "edit" ? findByEntityKey(streams, streamModal.id) : undefined;
  const editingEntry = entryModal.mode === "edit" ? findByEntityKey(entries, entryModal.id) : undefined;

  const { data: labels } = useEntityLabels(
    [...streams.flatMap((s) => [s.context_uri, s.object_uri, s.motivation_uri]), ...entries.map((e) => e.object_uri)].filter(
      (u): u is string => !!u && isEntityUri(u),
    ),
  );
  const uriLabel = (uri: string | null) => (uri ? (labelFor(labels, uri) ?? uri) : "—");
  const num = (n: number) => new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 }).format(n);
  const accountName = (id: string | null) => accounts.find((x) => x.id === id)?.label ?? "—";

  const deleteStream = useDeleteStream();
  const deleteEntry = useDeleteStreamEntry();

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Streams and entries are addressed by slug; a stream not in `streams` yet falls back to its id.
  const streamKey = (streamId: string) => {
    const stream = streams.find((x) => x.id === streamId);
    return stream ? entityKey(stream) : streamId;
  };
  function openNewEntry(streamId: string, objectUri = "") {
    setPendingObject(objectUri);
    setExpanded((prev) => new Set(prev).add(streamId));
    navigate({ to: `/streams/${streamKey(streamId)}/entries/new`, search: (prev: DateRangeSearch) => prev } as Parameters<typeof navigate>[0]);
  }
  function openEditEntry(entry: StreamEntry) {
    navigate({
      to: `/streams/${streamKey(entry.stream_id)}/entries/${entityKey(entry)}/edit`,
      search: (prev: DateRangeSearch) => prev,
    } as Parameters<typeof navigate>[0]);
  }
  function confirmDeleteStream(s: Stream) {
    if (window.confirm(t("streams.confirmDelete", { name: s.action }))) deleteStream.mutate(s.id, { onSuccess: streamModal.close });
  }
  function confirmDeleteEntry(e: StreamEntry) {
    if (window.confirm(t("streams.confirmDeleteEntry"))) deleteEntry.mutate(e.id, { onSuccess: entryModal.close });
  }

  const totalYin = sum(entries, "yin");
  const totalYang = sum(entries, "yang");
  const net = totalYang - totalYin;

  return (
    <>
      <Card>
        <div className="stack">
          <div className="panel-head">
            <div>
              <div className="panel-title">{t("streams.title")}</div>
              <p className="muted">{t("streams.intro")}</p>
            </div>
            <Button size="sm" tone="primary" onClick={streamModal.openNew}>
              {t("streams.add")}
            </Button>
          </div>

          {streams.length > 0 ? (
            <div className="stat-grid">
              <Card>
                <div className="stat-label">{t("streams.yin")}</div>
                <div className="stat-value">{num(totalYin)}</div>
              </Card>
              <Card>
                <div className="stat-label">{t("streams.yang")}</div>
                <div className="stat-value">{num(totalYang)}</div>
              </Card>
              <Card>
                <div className="stat-label">{t("streams.net")}</div>
                <div className="stat-value">
                  {net > 0 ? "+" : ""}
                  {num(net)}
                </div>
                <div className="stat-note">{net === 0 ? `☯ ${t("streams.equilibrium")}` : t("streams.notBalanced")}</div>
              </Card>
            </div>
          ) : (
            <EmptyState items={t("streams.items")} actionLabel={t("streams.add")} onAction={streamModal.openNew} />
          )}

          <ul className="stream-list">
            {streams.map((s) => (
              <StreamItem
                key={s.id}
                stream={s}
                entries={entries.filter((e) => e.stream_id === s.id)}
                expanded={expanded.has(s.id)}
                onToggle={() => toggle(s.id)}
                context={s.context_uri ? uriLabel(s.context_uri) : null}
                contextKind={s.context_uri ? entityTypeLabel(t, s.context_uri) : null}
                contextDuration={s.context_uri ? (contextDurations[s.context_uri] ?? null) : null}
                showAccounts={accountsQuery.available}
                num={num}
                uriLabel={uriLabel}
                accountName={accountName}
                onDropObject={(uri) => openNewEntry(s.id, uri)}
                onAddEntry={() => openNewEntry(s.id)}
                onEdit={() => streamModal.openEdit(entityKey(s))}
                onDelete={() => confirmDeleteStream(s)}
                onEditEntry={openEditEntry}
                onDeleteEntry={confirmDeleteEntry}
              />
            ))}
          </ul>
        </div>
      </Card>

      {streamModal.mode === "new" || editingStream ? (
        <StreamSheet
          key={editingStream?.id ?? "new"}
          stream={editingStream}
          entries={editingStream ? entries.filter((e) => e.stream_id === editingStream.id) : []}
          labels={labels}
          num={num}
          onClose={streamModal.close}
          onSaved={streamModal.close}
          onDelete={editingStream ? () => confirmDeleteStream(editingStream) : undefined}
          deleting={deleteStream.isPending}
        />
      ) : null}

      {entryStream && (entryModal.mode === "new" || editingEntry) ? (
        <EntrySheet
          key={editingEntry?.id ?? `new-${entryStream.id}`}
          stream={entryStream}
          entry={editingEntry}
          initialObject={pendingObject}
          others={entries.filter((e) => e.stream_id === entryStream.id && e.id !== editingEntry?.id)}
          accounts={accountsQuery.available ? accounts : null}
          labels={labels}
          num={num}
          onClose={entryModal.close}
          onSaved={() => {
            setPendingObject("");
            entryModal.close();
          }}
          onDelete={editingEntry ? () => confirmDeleteEntry(editingEntry) : undefined}
          deleting={deleteEntry.isPending}
        />
      ) : null}
    </>
  );
}

function StreamItem({
  stream,
  entries,
  expanded,
  onToggle,
  context,
  contextKind,
  contextDuration,
  showAccounts,
  num,
  uriLabel,
  accountName,
  onDropObject,
  onAddEntry,
  onEdit,
  onDelete,
  onEditEntry,
  onDeleteEntry,
}: {
  stream: Stream;
  entries: StreamEntry[];
  expanded: boolean;
  onToggle: () => void;
  context: string | null;
  contextKind: string | null;
  contextDuration: number | null;
  showAccounts: boolean;
  num: (n: number) => string;
  uriLabel: (uri: string | null) => string;
  accountName: (id: string | null) => string;
  onDropObject: (uri: string) => void;
  onAddEntry: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditEntry: (e: StreamEntry) => void;
  onDeleteEntry: (e: StreamEntry) => void;
}) {
  const { t, intlLocale } = useI18n();
  const drop = useEntityDropTarget((d) => {
    if (d.uri !== streamUri(stream.id)) onDropObject(d.uri);
  });
  const yin = sum(entries, "yin");
  const yang = sum(entries, "yang");
  const net = yang - yin;
  const when = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <li className={drop.over ? "stream stream--drop" : "stream"} {...drop.props}>
      <div className="stream__head action-row">
        <button type="button" className="stream__toggle" aria-expanded={expanded} onClick={onToggle}>
          <span className={expanded ? "stream__chevron stream__chevron--open" : "stream__chevron"} aria-hidden="true">
            ›
          </span>
          <span className="stream__title">
            <span className="library-row__label">{stream.action}</span>
            {context ? (
              <span className="library-row__kind">
                {contextKind} · {context}
              </span>
            ) : null}
          </span>
          <Badge tone={stream.source === "manual" ? "default" : "info"}>{t(`streams.source.${stream.source}` as MessageKey)}</Badge>
          <span className="stream__totals">
            {stream.quantity !== 1 ? `${num(stream.quantity)} × · ` : ""}
            {stream.duration_seconds != null ? `${formatDuration(stream.duration_seconds)} · ` : ""}
            {t("streams.totals", { yin: num(yin), yang: num(yang), net: `${net > 0 ? "+" : ""}${num(net)}` })}
            {net === 0 && entries.length > 0 ? " ☯" : ""}
          </span>
        </button>
        <ActionMenu
          name={stream.action}
          uri={streamUri(stream.id)}
          actions={[
            { key: "add-entry", label: t("streams.addEntry"), onSelect: onAddEntry },
            { key: "edit", label: t("streams.edit"), onSelect: onEdit },
            { key: "delete", label: t("streams.delete"), tone: "danger", onSelect: onDelete },
          ]}
        />
      </div>

      {expanded ? (
        <div className="stream__body stack">
          {stream.description ? <p className="muted">{stream.description}</p> : null}
          <p className="muted">
            {stream.end_date
              ? t("streams.period", { start: when.format(new Date(stream.start_date)), end: when.format(new Date(stream.end_date)) })
              : t("streams.ongoingSince", { start: when.format(new Date(stream.start_date)) })}
          </p>
          {stream.object_uri ? (
            <p className="muted">
              {t("streams.object")}: {uriLabel(stream.object_uri)}
            </p>
          ) : null}
          {stream.motivation_uri ? (
            <p className="muted">
              {t("streams.motivation")}: {uriLabel(stream.motivation_uri)}
            </p>
          ) : null}
          {stream.position_seconds != null ? (
            <p className="muted">
              {contextDuration == null
                ? t("streams.positionOnly", { position: formatDuration(stream.position_seconds) })
                : t("streams.position", {
                    position: formatDuration(stream.position_seconds),
                    duration: formatDuration(contextDuration),
                  })}
            </p>
          ) : null}
          {entries.length > 0 ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("streams.object")}</th>
                    <th className="num">{t("streams.yin")}</th>
                    {showAccounts ? <th>{t("streams.yinAccount")}</th> : null}
                    <th className="num">{t("streams.yang")}</th>
                    {showAccounts ? <th>{t("streams.yangAccount")}</th> : null}
                    <th>{t("streams.description")}</th>
                    <th className="action-row-cell" aria-label={t("streams.actions")} />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="action-row">
                      <td className="wrap">{uriLabel(e.object_uri)}</td>
                      <td className="num">{num(e.yin)}</td>
                      {showAccounts ? <td className="wrap">{accountName(e.yin_account_id)}</td> : null}
                      <td className="num">{num(e.yang)}</td>
                      {showAccounts ? <td className="wrap">{accountName(e.yang_account_id)}</td> : null}
                      <td className="wrap">{e.description ?? ""}</td>
                      <td className="action-row-cell">
                        <ActionMenu
                          name={e.description || uriLabel(e.object_uri)}
                          actions={[
                            { key: "edit", label: t("streams.edit"), onSelect: () => onEditEntry(e) },
                            { key: "delete", label: t("streams.deleteEntry"), tone: "danger", onSelect: () => onDeleteEntry(e) },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="stat-label">{t("streams.entriesEmpty")}</p>
          )}
          <div>
            <Button variant="ghost" size="sm" onClick={onAddEntry}>
              {t("streams.addEntry")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function StreamSheet({
  stream,
  entries,
  labels,
  num,
  onClose,
  onSaved,
  onDelete,
  deleting,
}: {
  stream?: Stream;
  entries: StreamEntry[];
  labels: Map<string, string> | undefined;
  num: (n: number) => string;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
  deleting: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<StreamDraft>(() =>
    stream
      ? {
          action: stream.action,
          context_uri: stream.context_uri ?? "",
          object_uri: stream.object_uri ?? "",
          motivation_uri: stream.motivation_uri ?? "",
          description: stream.description ?? "",
          source: stream.source,
          start_date: toLocalInput(stream.start_date),
          end_date: toLocalInput(stream.end_date),
          quantity: String(stream.quantity ?? 1),
        }
      : emptyStream(),
  );
  const { data: draftLabels } = useEntityLabels([draft.context_uri, draft.object_uri, draft.motivation_uri].filter((uri) => isEntityUri(uri)));
  const contextOk = !draft.context_uri.trim() || isEntityUri(draft.context_uri);
  const objectOk = !draft.object_uri.trim() || isEntityUri(draft.object_uri);
  const motivationOk = !draft.motivation_uri.trim() || isEntityUri(draft.motivation_uri);
  const quantity = Number(draft.quantity);
  const quantityOk = draft.quantity.trim() !== "" && Number.isFinite(quantity) && quantity >= 0;
  const duration = draftDuration(draft.start_date, draft.end_date);
  const periodOk = !!fromLocalInput(draft.start_date) && (!draft.end_date || duration != null);

  const save = useSaveStream();

  const yin = sum(entries, "yin");
  const yang = sum(entries, "yang");
  const label = (uri: string) => (uri.trim() ? (labelFor(draftLabels ?? labels, uri) ?? uri.trim()) : null);
  const contextLabel = label(draft.context_uri);
  const objectLabel = label(draft.object_uri) ?? contextLabel;
  const motivationLabel = label(draft.motivation_uri);

  return (
    <EntitySheet
      title={stream ? stream.action : t("streams.add")}
      uri={stream ? streamUri(stream.id) : undefined}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ id: stream?.id, draft }, { onSuccess: onSaved });
      }}
      footer={
        <FormActions
          onDelete={onDelete}
          deleteLabel={t("streams.delete")}
          deleting={deleting}
          onCancel={stream ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={stream ? t("form.save") : t("streams.create")}
          saving={save.isPending}
          submitDisabled={!draft.action.trim() || !contextOk || !objectOk || !motivationOk || !quantityOk || !periodOk}
        />
      }
      preview={
        <div className="entity-preview">
          <div>
            <div className="entity-preview__kind">{t("entity.stream")}</div>
            <div className="entity-preview__label">{draft.action || t("streams.actionPlaceholder")}</div>
          </div>
          <div className="entity-preview__amount">
            {yang - yin > 0 ? "+" : ""}
            {num(yang - yin)}
          </div>
          <dl className="entity-preview__meta">
            {contextLabel ? (
              <div>
                <dt>{t("streams.context")}</dt>
                <dd>{contextLabel}</dd>
              </div>
            ) : null}
            {objectLabel ? (
              <div>
                <dt>{t("streams.object")}</dt>
                <dd>{objectLabel}</dd>
              </div>
            ) : null}
            {motivationLabel ? (
              <div>
                <dt>{t("streams.motivation")}</dt>
                <dd>{motivationLabel}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("streams.duration")}</dt>
              <dd>{duration != null ? formatDuration(duration) : t("streams.ongoing")}</dd>
            </div>
            <div>
              <dt>{t("streams.quantity")}</dt>
              <dd>{quantityOk ? num(quantity) : "—"}</dd>
            </div>
            <div>
              <dt>{t("streams.yin")}</dt>
              <dd>{num(yin)}</dd>
            </div>
            <div>
              <dt>{t("streams.yang")}</dt>
              <dd>{num(yang)}</dd>
            </div>
            <div>
              <dt>{t("streams.sourceLabel")}</dt>
              <dd>{t(`streams.source.${draft.source}` as MessageKey)}</dd>
            </div>
          </dl>
        </div>
      }
    >
      <div className="form-grid">
        <Input
          label={t("streams.action")}
          placeholder={t("streams.actionPlaceholder")}
          required
          value={draft.action}
          onChange={(e) => setDraft((p) => ({ ...p, action: e.target.value }))}
        />
        <EntityPicker
          label={t("streams.context")}
          types={["task"]}
          valueKind="uri"
          hint={contextOk ? t("streams.taskContextHint") : t("streams.uriInvalid")}
          value={draft.context_uri || null}
          onChange={(uri) =>
            setDraft((p) => ({
              ...p,
              context_uri: uri ?? "",
              object_uri: !p.object_uri || p.object_uri === p.context_uri ? (uri ?? "") : p.object_uri,
            }))
          }
        />
        <EntityPicker
          label={t("streams.object")}
          hint={objectOk ? t("streams.uriHint") : t("streams.uriInvalid")}
          value={draft.object_uri || null}
          onChange={(uri) => setDraft((p) => ({ ...p, object_uri: uri ?? "" }))}
        />
        <EntityPicker
          label={t("streams.motivation")}
          hint={motivationOk ? t("streams.motivationHint") : t("streams.uriInvalid")}
          value={draft.motivation_uri || null}
          onChange={(uri) => setDraft((p) => ({ ...p, motivation_uri: uri ?? "" }))}
        />
        <Input
          label={t("streams.start")}
          type="datetime-local"
          required
          value={draft.start_date}
          onChange={(e) => setDraft((p) => ({ ...p, start_date: e.target.value }))}
        />
        <Input
          label={t("streams.end")}
          type="datetime-local"
          hint={periodOk ? t("streams.endHint") : t("streams.endBeforeStart")}
          value={draft.end_date}
          onChange={(e) => setDraft((p) => ({ ...p, end_date: e.target.value }))}
        />
        <Input
          label={t("streams.quantity")}
          type="number"
          min={0}
          step="any"
          required
          value={draft.quantity}
          onChange={(e) => setDraft((p) => ({ ...p, quantity: e.target.value }))}
        />
        <Input
          label={t("streams.description")}
          value={draft.description}
          onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
        />
        <Select
          label={t("streams.sourceLabel")}
          value={draft.source}
          onChange={(e) => setDraft((p) => ({ ...p, source: e.target.value as StreamSource }))}
        >
          <option value="manual">{t("streams.source.manual")}</option>
          <option value="automatic">{t("streams.source.automatic")}</option>
        </Select>
      </div>
    </EntitySheet>
  );
}

function EntrySheet({
  stream,
  entry,
  initialObject,
  others,
  accounts,
  labels,
  num,
  onClose,
  onSaved,
  onDelete,
  deleting,
}: {
  stream: Stream;
  entry?: StreamEntry;
  initialObject: string;
  others: StreamEntry[];
  /** The host's accounts, or null when it has none to book against. */
  accounts: StreamAccount[] | null;
  labels: Map<string, string> | undefined;
  num: (n: number) => string;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
  deleting: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<EntryDraft>(() =>
    entry
      ? {
          object_uri: entry.object_uri ?? "",
          yin: String(entry.yin),
          yang: String(entry.yang),
          yin_account_id: entry.yin_account_id ?? "",
          yang_account_id: entry.yang_account_id ?? "",
          description: entry.description ?? "",
        }
      : emptyEntry(initialObject),
  );
  useEffect(() => {
    if (!entry && initialObject) setDraft((p) => ({ ...p, object_uri: initialObject }));
  }, [entry, initialObject]);
  const { data: draftLabels } = useEntityLabels(isEntityUri(draft.object_uri) ? [draft.object_uri.trim()] : []);

  const yinValue = Math.max(0, Number(draft.yin) || 0);
  const yangValue = Math.max(0, Number(draft.yang) || 0);
  const netAfter = sum(others, "yang") + yangValue - (sum(others, "yin") + yinValue);
  const balanced = Math.abs(netAfter) < 1e-9;
  const objectOk = !draft.object_uri.trim() || isEntityUri(draft.object_uri);
  const accountOptions = (accounts ?? [])
    .filter((a) => a.active !== false || a.id === draft.yin_account_id || a.id === draft.yang_account_id)
    .map((a) => ({ type: "account" as const, id: a.id, title: a.label }));

  const save = useSaveStreamEntry();

  const objectLabel = draft.object_uri.trim() ? (labelFor(draftLabels ?? labels, draft.object_uri) ?? draft.object_uri.trim()) : null;

  return (
    <EntitySheet
      title={entry ? t("streams.editEntry") : t("streams.addEntry")}
      subtitle={stream.action}
      onClose={onClose}
      closeLabel={t("sheet.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (balanced && objectOk) save.mutate({ id: entry?.id, streamId: stream.id, draft }, { onSuccess: onSaved });
      }}
      footer={
        <FormActions
          onDelete={onDelete}
          deleteLabel={t("streams.deleteEntry")}
          deleting={deleting}
          onCancel={entry ? undefined : onClose}
          cancelLabel={t("form.cancel")}
          submitLabel={entry ? t("form.save") : t("streams.addEntry")}
          saving={save.isPending}
          submitDisabled={!balanced || !objectOk}
        />
      }
      preview={
        <div className="entity-preview">
          <div>
            <div className="entity-preview__kind">{t("entity.stream")}</div>
            <div className="entity-preview__label">{stream.action}</div>
          </div>
          <div className="entity-preview__amount">
            {netAfter > 0 ? "+" : ""}
            {num(netAfter)}
          </div>
          <p className="entity-preview__note">{balanced ? `☯ ${t("streams.equilibrium")}` : `⚠ ${t("streams.notBalancedHint")}`}</p>
          <dl className="entity-preview__meta">
            {objectLabel ? (
              <div>
                <dt>{entityTypeLabel(t, draft.object_uri)}</dt>
                <dd>{objectLabel}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("streams.yin")}</dt>
              <dd>{num(yinValue)}</dd>
            </div>
            <div>
              <dt>{t("streams.yang")}</dt>
              <dd>{num(yangValue)}</dd>
            </div>
          </dl>
        </div>
      }
    >
      <div className="form-grid">
        <EntityPicker
          label={t("streams.object")}
          hint={objectOk ? t("streams.uriHint") : t("streams.uriInvalid")}
          value={draft.object_uri || null}
          onChange={(uri) => setDraft((p) => ({ ...p, object_uri: uri ?? "" }))}
        />
        <Input
          label={t("streams.yin")}
          type="number"
          min={0}
          step="any"
          value={draft.yin}
          onChange={(e) => setDraft((p) => ({ ...p, yin: e.target.value }))}
        />
        {accounts ? (
          <EntityPicker
            label={t("streams.yinAccount")}
            types={["account"]}
            options={accountOptions}
            value={draft.yin_account_id}
            onChange={(id) => setDraft((p) => ({ ...p, yin_account_id: id ?? "" }))}
          />
        ) : null}
        <Input
          label={t("streams.yang")}
          type="number"
          min={0}
          step="any"
          value={draft.yang}
          onChange={(e) => setDraft((p) => ({ ...p, yang: e.target.value }))}
        />
        {accounts ? (
          <EntityPicker
            label={t("streams.yangAccount")}
            types={["account"]}
            options={accountOptions}
            value={draft.yang_account_id}
            onChange={(id) => setDraft((p) => ({ ...p, yang_account_id: id ?? "" }))}
          />
        ) : null}
        <Input
          label={t("streams.description")}
          value={draft.description}
          onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
        />
      </div>
    </EntitySheet>
  );
}
