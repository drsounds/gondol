import { useMemo, useState } from "react";
import { Alert, Button, Checkbox, Input, Select } from "../../../design-system/bungalow-79d923";
import { useResolutions } from "../../../apps/contributions";
import { EntityPicker, type EntityOption } from "../../../entities/EntityPicker";
import { EntitySheet } from "../../../entities/EntitySheet";
import { FormActions } from "../../../entities/FormActions";
import { parseEntityUri, registeredEntityTypes } from "../../../entities/uri";
import { useI18n } from "../../../i18n/i18n";
import { GENUI_FORMATS, type GenUiFormat } from "../../../genui/GenerativeUi";
import type { EntityType, MessageKey } from "../../../register";
import type { Json } from "../../../supabase/types";
import { setAiDraft } from "../../ai/models/draft";
import { studioAgentsHook, type StudioAgent } from "../hooks";
import { buildAgentPrompt } from "../models/prompts";
import { sampleDocument } from "../models/samples";
import {
  appUri,
  fieldLabel,
  keyFromName,
  useDeleteLiteApp,
  useDeleteLiteRow,
  useLiteRecords,
  useSaveLiteApp,
  useSaveLitePage,
  useSaveLiteRelation,
  useSaveLiteType,
} from "../models/studio";
import { LITE_FIELD_TYPES, type LiteApp, type LiteAppTree, type LiteEntityType, type LiteField, type LitePage, type LiteRelation, type LiteRelationKind } from "../models/types";
import { LitePageView } from "./LitePageView";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

function TextArea({ label, hint, value, rows = 4, onChange, required, code }: { label: string; hint?: string; value: string; rows?: number; onChange: (value: string) => void; required?: boolean; code?: boolean }) {
  return (
    <label className="studio-field">
      <span className="studio-field__label">{label}</span>
      <textarea className={`bungalow-input${code ? " studio-field__code" : ""}`} rows={rows} value={value} required={required} spellCheck={!code} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="muted studio-field__hint">{hint}</span> : null}
    </label>
  );
}

/** The agents the host offers (its answer to studioAgentsHook), as picker options. */
function useStudioAgents() {
  const [bridge] = useResolutions(studioAgentsHook);
  const { agents, loading } = bridge?.value.useAgents() ?? { agents: [] as StudioAgent[], loading: false };
  const options = useMemo<EntityOption[]>(
    () => agents.map((agent) => ({ type: (parseEntityUri(agent.uri)?.entityType ?? "agent") as EntityType, id: agent.id, title: agent.name, subtitle: agent.description ?? null })),
    [agents],
  );
  return { bridge: bridge?.value ?? null, agents, options, loading };
}

/** Creating or editing an app: its name, menu entry and the agent that builds it. */
export function LiteAppSheet({ app, onClose, onSaved }: { app?: LiteAppTree; onClose: () => void; onSaved: (app: LiteApp) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(app?.name ?? "");
  const [description, setDescription] = useState(app?.description ?? "");
  const [instructions, setInstructions] = useState(app?.instructions ?? "");
  const [iconName, setIconName] = useState(app?.icon_name ?? "");
  const [inMenu, setInMenu] = useState(app?.in_menu ?? true);
  const [menuOrder, setMenuOrder] = useState(app?.menu_order === null || app?.menu_order === undefined ? "" : String(app.menu_order));
  const [builderUri, setBuilderUri] = useState<string | null>(app?.builder_uri ?? null);
  const save = useSaveLiteApp();
  const remove = useDeleteLiteApp();

  return (
    <EntitySheet
      title={app ? t("studio.app.editTitle") : t("studio.app.newTitle")}
      subtitle={app?.name}
      onClose={onClose}
      closeLabel={t("studio.close")}
      uri={app ? appUri(app) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        const order = menuOrder.trim() === "" ? null : Number(menuOrder);
        save.mutate(
          {
            id: app?.id,
            name: name.trim(),
            description: description.trim() || null,
            instructions: instructions.trim() || null,
            icon_name: iconName.trim() || null,
            hue: app?.hue ?? null,
            in_menu: inMenu,
            menu_order: order !== null && Number.isFinite(order) ? Math.trunc(order) : null,
            builder_uri: builderUri,
          },
          { onSuccess: onSaved },
        );
      }}
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{t("studio.app.kind")}</div>
          <div className="entity-preview__label">{name.trim() || t("studio.app.untitled")}</div>
          {description.trim() ? <p className="muted">{description}</p> : null}
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("studio.app.pages")}</dt>
              <dd>{app?.pages.length ?? 0}</dd>
            </div>
            <div>
              <dt>{t("studio.app.types")}</dt>
              <dd>{app?.types.length ?? 0}</dd>
            </div>
            <div>
              <dt>{t("studio.app.inMenu")}</dt>
              <dd>{inMenu ? "✓" : "—"}</dd>
            </div>
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("studio.cancel")}
          onDelete={
            app
              ? () => {
                  if (window.confirm(t("studio.app.confirmDelete", { name: app.name }))) remove.mutate(app.id, { onSuccess: onClose });
                }
              : undefined
          }
          deleteLabel={t("studio.delete")}
          deleting={remove.isPending}
          submitLabel={t("studio.save")}
          saving={save.isPending}
          submitDisabled={!name.trim()}
        />
      }
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      <Input label={t("studio.app.name")} value={name} required autoFocus onChange={(e) => setName(e.target.value)} />
      <TextArea label={t("studio.app.description")} value={description} rows={2} onChange={setDescription} />
      <TextArea label={t("studio.app.instructions")} hint={t("studio.app.instructionsHint")} value={instructions} onChange={setInstructions} />
      <EntityPicker label={t("studio.app.builder")} hint={t("studio.app.builderHint")} valueKind="uri" value={builderUri} onChange={(next) => setBuilderUri(next)} />
      <Input label={t("studio.app.icon")} hint={t("studio.app.iconHint")} value={iconName} onChange={(e) => setIconName(e.target.value)} />
      <Checkbox label={t("studio.app.inMenu")} checked={inMenu} onChange={(e) => setInMenu(e.target.checked)} />
      <Input label={t("studio.app.menuOrder")} type="number" step={1} value={menuOrder} onChange={(e) => setMenuOrder(e.target.value)} />
    </EntitySheet>
  );
}

/**
 * Asks an agent to build an app, or (with `app`) to change one. Without the host's agents, the
 * request opens in the AI chat instead.
 */
export function AskAgentSheet({ app, onClose, onNavigate }: { app?: LiteAppTree; onClose: () => void; onNavigate: (path: string) => void }) {
  const { t } = useI18n();
  const { bridge, agents, options, loading } = useStudioAgents();
  const builder = app?.builder_uri ? agents.find((agent) => agent.uri === app.builder_uri) : undefined;
  const [agentId, setAgentId] = useState<string | null>(null);
  const agent = agents.find((a) => a.id === (agentId ?? builder?.id)) ?? (agents.length === 1 ? agents[0] : undefined);
  const [request, setRequest] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = buildAgentPrompt({ request: request || t("studio.ask.placeholder"), app });

  async function send() {
    if (!request.trim()) return;
    const text = buildAgentPrompt({ request, app });
    if (!bridge || !agent) {
      setAiDraft(text);
      onNavigate("/ai/new");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const path = await bridge.ask({ agent, prompt: text, title: app ? t("studio.ask.changeTitle", { name: app.name }) : t("studio.ask.buildTitle") });
      if (path) onNavigate(path);
      else onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <EntitySheet
      title={app ? t("studio.ask.changeTitle", { name: app.name }) : t("studio.ask.buildTitle")}
      subtitle={t("studio.ask.subtitle")}
      onClose={onClose}
      closeLabel={t("studio.close")}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{agent ? agent.name : t("studio.ask.aiChat")}</div>
          <pre className="studio-prompt">{prompt}</pre>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("studio.cancel")}
          submitLabel={bridge && agent ? t("studio.ask.send", { agent: agent.name }) : t("studio.ask.openChat")}
          saving={sending}
          submitDisabled={!request.trim()}
        />
      }
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {bridge ? (
        <EntityPicker
          label={t("studio.ask.agent")}
          hint={!loading && !agents.length ? t("studio.ask.noAgents") : undefined}
          options={options}
          valueKind="uri"
          value={agent?.uri ?? null}
          onChange={(next) => setAgentId(agents.find((a) => a.uri === next)?.id ?? null)}
        />
      ) : (
        <p className="muted">{t("studio.ask.noBridge")}</p>
      )}
      <TextArea label={t("studio.ask.request")} hint={t("studio.ask.hint")} value={request} rows={8} required onChange={setRequest} />
    </EntitySheet>
  );
}

/** A page document as the editor shows it: JSON, or the HTML itself for an MCP-UI page held as a string. */
function documentText(document: Json | undefined): string {
  if (document === undefined || document === null) return "";
  if (typeof document === "string") return document;
  return JSON.stringify(document, null, 2);
}

/** The editor's text as a document: JSON when it parses, else (MCP-UI only) the HTML as a string. */
function parseDocument(format: GenUiFormat, text: string): { document: Json | null; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { document: null, error: null };
  try {
    return { document: JSON.parse(trimmed) as Json, error: null };
  } catch (error) {
    if (format === "mcp_ui") return { document: text, error: null };
    // A2UI may also be JSON Lines: one message per line.
    if (format === "a2ui") {
      try {
        return { document: trimmed.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as Json), error: null };
      } catch {
        // fall through to the first error
      }
    }
    return { document: null, error: errorText(error) };
  }
}

/** Creating or editing a page: its title, menu entry, format and document, with a live preview. */
export function LitePageSheet({ app, page, onClose, onSaved }: { app: LiteAppTree; page?: LitePage; onClose: () => void; onSaved: (page: LitePage) => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(page?.title ?? "");
  const [key, setKey] = useState(page?.key ?? "");
  const [format, setFormat] = useState<GenUiFormat>(page?.format ?? "a2ui");
  const [inMenu, setInMenu] = useState(page?.in_menu ?? true);
  const [iconName, setIconName] = useState(page?.icon_name ?? "");
  const [text, setText] = useState(() => documentText(page?.document ?? sampleDocument("a2ui", app, "")));
  const records = useLiteRecords(app.id);
  const save = useSaveLitePage();
  const remove = useDeleteLiteRow("lite_app_pages");
  const pageKey = key.trim() || keyFromName(title);
  const parsed = useMemo(() => parseDocument(format, text), [format, text]);
  const draft: LitePage | null = parsed.document === null
    ? null
    : {
        ...(page ?? { id: "", user_id: "", app_id: app.id, position: app.pages.length, created_at: "", updated_at: "" }),
        key: pageKey,
        title: title || pageKey,
        format,
        in_menu: inMenu,
        icon_name: iconName || null,
        document: parsed.document,
      };
  const taken = app.pages.some((p) => p.key === pageKey && p.id !== page?.id);

  return (
    <EntitySheet
      title={page ? t("studio.page.editTitle") : t("studio.page.newTitle")}
      subtitle={app.name}
      onClose={onClose}
      closeLabel={t("studio.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft || !title.trim() || !pageKey || taken) return;
        save.mutate(
          { id: page?.id, app_id: app.id, key: pageKey, title: title.trim(), icon_name: iconName.trim() || null, position: page?.position ?? app.pages.length, in_menu: inMenu, format, document: draft.document },
          { onSuccess: onSaved },
        );
      }}
      preview={
        draft ? (
          <LitePageView app={app} page={draft} records={records.data ?? []} interactive={false} onNavigate={() => undefined} onOpenNew={() => undefined} onOpenEdit={() => undefined} />
        ) : (
          <p className="muted">{parsed.error ? t("studio.page.invalid", { error: parsed.error }) : t("studio.page.empty")}</p>
        )
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("studio.cancel")}
          onDelete={
            page
              ? () => {
                  if (window.confirm(t("studio.page.confirmDelete", { name: page.title }))) remove.mutate({ id: page.id, appId: app.id }, { onSuccess: onClose });
                }
              : undefined
          }
          deleteLabel={t("studio.delete")}
          deleting={remove.isPending}
          submitLabel={t("studio.save")}
          saving={save.isPending}
          submitDisabled={!draft || !title.trim() || !pageKey || taken}
        />
      }
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      <Input label={t("studio.page.title")} value={title} required autoFocus onChange={(e) => setTitle(e.target.value)} />
      <Input
        label={t("studio.page.key")}
        hint={taken ? t("studio.page.keyTaken") : t("studio.page.keyHint", { path: `/lite/${app.slug || app.identifier}/${pageKey || "…"}` })}
        value={key}
        placeholder={keyFromName(title)}
        onChange={(e) => setKey(keyFromName(e.target.value) || e.target.value.toLowerCase())}
      />
      <Select label={t("studio.page.format")} value={format} onChange={(e) => setFormat(e.target.value as GenUiFormat)}>
        {GENUI_FORMATS.map((value) => (
          <option key={value} value={value}>
            {t(`studio.format.${value}` as MessageKey)}
          </option>
        ))}
      </Select>
      <Checkbox label={t("studio.page.inMenu")} checked={inMenu} onChange={(e) => setInMenu(e.target.checked)} />
      <Input label={t("studio.app.icon")} hint={t("studio.app.iconHint")} value={iconName} onChange={(e) => setIconName(e.target.value)} />
      <TextArea
        label={t("studio.page.document")}
        hint={parsed.error ?? t(`studio.page.documentHint.${format}` as MessageKey)}
        value={text}
        rows={16}
        code
        onChange={setText}
      />
      <div className="row-actions">
        <Button type="button" size="sm" variant="outline" onClick={() => setText(documentText(sampleDocument(format, app, title)))}>
          {t("studio.page.sample")}
        </Button>
      </div>
    </EntitySheet>
  );
}

type FieldDraft = LiteField & { optionsText?: string };

/** Creating or editing an entity type: its names and fields. */
export function LiteTypeSheet({ app, type, onClose, onSaved }: { app: LiteAppTree; type?: LiteEntityType; onClose: () => void; onSaved: (type: LiteEntityType) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(type?.name ?? "");
  const [plural, setPlural] = useState(type?.plural_name ?? "");
  const [key, setKey] = useState(type?.key ?? "");
  const [iconName, setIconName] = useState(type?.icon_name ?? "");
  const [fields, setFields] = useState<FieldDraft[]>(() =>
    (type?.fields ?? [{ key: "name", label: "Name", type: "text", required: true }]).map((field) => ({ ...field, optionsText: (field.options ?? []).join(", ") })),
  );
  const [titleField, setTitleField] = useState(type?.title_field ?? "");
  const save = useSaveLiteType();
  const remove = useDeleteLiteRow("lite_entity_types");
  const typeKey = key.trim() || keyFromName(name, "_");
  const taken = app.types.some((other) => other.key === typeKey && other.id !== type?.id);
  const keys = fields.map((field) => field.key);
  const badFields = fields.some((field, index) => !/^[a-z][a-z0-9_]*$/.test(field.key) || keys.indexOf(field.key) !== index);

  const update = (index: number, patch: Partial<FieldDraft>) => setFields((previous) => previous.map((field, i) => (i === index ? { ...field, ...patch } : field)));

  const cleanFields = (): LiteField[] =>
    fields.map(({ optionsText, ...field }) => {
      const out: LiteField = { key: field.key, type: field.type };
      if (field.label?.trim()) out.label = field.label.trim();
      if (field.required) out.required = true;
      if (field.description?.trim()) out.description = field.description.trim();
      if (field.type === "select" || field.type === "multiselect") out.options = (optionsText ?? "").split(",").map((v) => v.trim()).filter(Boolean);
      return out;
    });

  return (
    <EntitySheet
      title={type ? t("studio.type.editTitle") : t("studio.type.newTitle")}
      subtitle={app.name}
      onClose={onClose}
      closeLabel={t("studio.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || !typeKey || taken || badFields) return;
        save.mutate(
          {
            id: type?.id,
            app_id: app.id,
            key: typeKey,
            name: name.trim(),
            plural_name: plural.trim() || null,
            icon_name: iconName.trim() || null,
            fields: cleanFields(),
            title_field: titleField || null,
            position: type?.position ?? app.types.length,
          },
          { onSuccess: onSaved },
        );
      }}
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{t("studio.type.kind")}</div>
          <div className="entity-preview__label">{name.trim() || t("studio.type.untitled")}</div>
          <dl className="entity-preview__meta">
            {fields.map((field, index) => (
              <div key={index}>
                <dt>{fieldLabel(field)}</dt>
                <dd>
                  {t(`studio.fieldType.${field.type}` as MessageKey)}
                  {field.required ? " *" : ""}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("studio.cancel")}
          onDelete={
            type
              ? () => {
                  if (window.confirm(t("studio.type.confirmDelete", { name: type.name }))) remove.mutate({ id: type.id, appId: app.id }, { onSuccess: onClose });
                }
              : undefined
          }
          deleteLabel={t("studio.delete")}
          deleting={remove.isPending}
          submitLabel={t("studio.save")}
          saving={save.isPending}
          submitDisabled={!name.trim() || !typeKey || taken || badFields}
        />
      }
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      <Input label={t("studio.type.name")} value={name} required autoFocus onChange={(e) => setName(e.target.value)} />
      <Input label={t("studio.type.plural")} value={plural} onChange={(e) => setPlural(e.target.value)} />
      <Input
        label={t("studio.type.key")}
        hint={taken ? t("studio.type.keyTaken") : t("studio.type.keyHint")}
        value={key}
        placeholder={keyFromName(name, "_")}
        onChange={(e) => setKey(keyFromName(e.target.value, "_") || e.target.value.toLowerCase())}
      />
      <Input label={t("studio.app.icon")} hint={t("studio.app.iconHint")} value={iconName} onChange={(e) => setIconName(e.target.value)} />
      <fieldset className="studio-fields">
        <legend className="studio-field__label">{t("studio.type.fields")}</legend>
        {badFields ? <p className="muted">{t("studio.type.fieldKeyHint")}</p> : null}
        {fields.map((field, index) => (
          <div key={index} className="studio-fields__row">
            <Input label={t("studio.field.label")} value={field.label ?? ""} onChange={(e) => update(index, { label: e.target.value, ...(field.key && field.key !== keyFromName(field.label ?? "", "_") ? {} : { key: keyFromName(e.target.value, "_") }) })} />
            <Input label={t("studio.field.key")} value={field.key} onChange={(e) => update(index, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
            <Select label={t("studio.field.type")} value={field.type} onChange={(e) => update(index, { type: e.target.value as LiteField["type"] })}>
              {LITE_FIELD_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`studio.fieldType.${value}` as MessageKey)}
                </option>
              ))}
            </Select>
            {field.type === "select" || field.type === "multiselect" ? (
              <Input label={t("studio.field.options")} hint={t("studio.field.optionsHint")} value={field.optionsText ?? ""} onChange={(e) => update(index, { optionsText: e.target.value })} />
            ) : null}
            <div className="studio-fields__row-actions">
              <Checkbox label={t("studio.field.required")} checked={!!field.required} onChange={(e) => update(index, { required: e.target.checked })} />
              <Button type="button" size="sm" variant="ghost" onClick={() => setFields((previous) => previous.filter((_, i) => i !== index))}>
                {t("studio.field.remove")}
              </Button>
            </div>
          </div>
        ))}
        <div className="row-actions">
          <Button type="button" size="sm" variant="outline" onClick={() => setFields((previous) => [...previous, { key: `field_${previous.length + 1}`, type: "text", optionsText: "" }])}>
            {t("studio.field.add")}
          </Button>
        </div>
      </fieldset>
      <Select label={t("studio.type.titleField")} value={titleField} onChange={(e) => setTitleField(e.target.value)}>
        <option value="">{t("studio.type.titleFieldDefault")}</option>
        {fields.map((field) => (
          <option key={field.key} value={field.key}>
            {fieldLabel(field)}
          </option>
        ))}
      </Select>
    </EntitySheet>
  );
}

/** Creating or editing a relation from one of the app's types to another, or to any entity type. */
export function LiteRelationSheet({ app, relation, onClose, onSaved }: { app: LiteAppTree; relation?: LiteRelation; onClose: () => void; onSaved: (relation: LiteRelation) => void }) {
  const { t } = useI18n();
  const [label, setLabel] = useState(relation?.label ?? "");
  const [key, setKey] = useState(relation?.key ?? "");
  const [fromType, setFromType] = useState(relation?.from_type_id ?? app.types[0]?.id ?? "");
  // The target: "type:<id>" (one of the app's types) or "entity:<type>" (any entity of the host's type).
  const [target, setTarget] = useState(relation ? (relation.to_type_id ? `type:${relation.to_type_id}` : `entity:${relation.to_entity_type ?? ""}`) : app.types[0] ? `type:${app.types[0].id}` : "");
  const [kind, setKind] = useState<LiteRelationKind>(relation?.kind ?? "one");
  const save = useSaveLiteRelation();
  const remove = useDeleteLiteRow("lite_entity_relations");
  const relationKey = key.trim() || keyFromName(label, "_");
  const from = app.types.find((type) => type.id === fromType);
  // Keys are unique in the app, and never one of the type's fields.
  const taken = app.relations.some((other) => other.key === relationKey && other.id !== relation?.id) || !!from?.fields.some((field) => field.key === relationKey);
  const hostTypes = registeredEntityTypes().filter((type) => type !== "lite_record");
  const valid = !!label.trim() && !!relationKey && !!from && !!target && !taken;

  return (
    <EntitySheet
      title={relation ? t("studio.relation.editTitle") : t("studio.relation.newTitle")}
      subtitle={app.name}
      onClose={onClose}
      closeLabel={t("studio.close")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        const [targetKind, targetValue] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
        save.mutate(
          {
            id: relation?.id,
            app_id: app.id,
            key: relationKey,
            label: label.trim(),
            from_type_id: fromType,
            to_type_id: targetKind === "type" ? targetValue : null,
            to_entity_type: targetKind === "entity" ? targetValue : null,
            kind,
          },
          { onSuccess: onSaved },
        );
      }}
      preview={
        <div className="entity-preview">
          <div className="entity-preview__kind">{t("studio.relation.kind")}</div>
          <div className="entity-preview__label">{label.trim() || t("studio.relation.untitled")}</div>
          <dl className="entity-preview__meta">
            <div>
              <dt>{t("studio.relation.from")}</dt>
              <dd>{from?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("studio.relation.to")}</dt>
              <dd>
                {target.startsWith("type:")
                  ? (app.types.find((type) => `type:${type.id}` === target)?.name ?? "—")
                  : target
                    ? t(`entity.${target.slice("entity:".length)}` as MessageKey)
                    : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("studio.relation.cardinality")}</dt>
              <dd>{t(`studio.relation.${kind}` as MessageKey)}</dd>
            </div>
          </dl>
        </div>
      }
      footer={
        <FormActions
          onCancel={onClose}
          cancelLabel={t("studio.cancel")}
          onDelete={
            relation
              ? () => {
                  if (window.confirm(t("studio.relation.confirmDelete", { name: relation.label }))) remove.mutate({ id: relation.id, appId: app.id }, { onSuccess: onClose });
                }
              : undefined
          }
          deleteLabel={t("studio.delete")}
          deleting={remove.isPending}
          submitLabel={t("studio.save")}
          saving={save.isPending}
          submitDisabled={!valid}
        />
      }
    >
      {save.error ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      {!app.types.length ? <Alert tone="warning">{t("studio.relation.noTypes")}</Alert> : null}
      <Input label={t("studio.relation.label")} value={label} required autoFocus onChange={(e) => setLabel(e.target.value)} />
      <Input
        label={t("studio.relation.key")}
        hint={taken ? t("studio.relation.keyTaken") : t("studio.relation.keyHint")}
        value={key}
        placeholder={keyFromName(label, "_")}
        onChange={(e) => setKey(keyFromName(e.target.value, "_") || e.target.value.toLowerCase())}
      />
      <Select label={t("studio.relation.from")} value={fromType} onChange={(e) => setFromType(e.target.value)}>
        {app.types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </Select>
      <Select label={t("studio.relation.to")} value={target} onChange={(e) => setTarget(e.target.value)}>
        <optgroup label={app.name}>
          {app.types.map((type) => (
            <option key={type.id} value={`type:${type.id}`}>
              {type.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={t("studio.relation.anyEntity")}>
          {hostTypes.map((type) => (
            <option key={type} value={`entity:${type}`}>
              {t(`entity.${type}` as MessageKey)}
            </option>
          ))}
        </optgroup>
      </Select>
      <Select label={t("studio.relation.cardinality")} value={kind} onChange={(e) => setKind(e.target.value as LiteRelationKind)}>
        <option value="one">{t("studio.relation.one")}</option>
        <option value="many">{t("studio.relation.many")}</option>
      </Select>
    </EntitySheet>
  );
}
