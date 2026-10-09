import { Fragment, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { EntityArt } from "./EntityArt";
import { useEntityDropTarget } from "./dragEntity";
import { isKnownEntityType, labelFor, lookupEntity, useEntityLabels } from "./lookup";
import { useEntitySearch } from "../search/entitySearch";
import { useEntityLifecycle } from "./lifecycle";
import { useI18n, type MessageKey } from "../i18n/i18n";
import { isUuid } from "./slugs";
import { entityUriScheme, parseEntityUri, toEntityUri, type EntityType } from "./uri";

/** Something an <EntityPicker/> can offer. */
export interface EntityOption {
  type: EntityType;
  id: string;
  title: string;
  subtitle?: string | null;
  /** Indentation in a tree (projects, organizations, places, …) while nothing is typed. */
  depth?: number;
}

interface BaseProps {
  label?: string;
  /** Accessible name when there's no visible label (e.g. in a table cell). */
  ariaLabel?: string;
  hint?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** A value is needed: the browser validates it, and a single picker can't be cleared. */
  required?: boolean;
  /** The entity types that can be picked. Omit to allow every type. */
  types?: readonly EntityType[];
  /**
   * Pick among these instead of searching every entity the user can see: for when the context
   * narrows the choice down (calendars you can edit, entries of a certain kind, …).
   */
  options?: readonly EntityOption[];
  /** Ids (or spacify: URIs) that can't be picked, e.g. a project itself when picking its parent. */
  exclude?: Iterable<string>;
  /**
   * What values are: row ids ("id", the default when exactly one type is allowed, so a foreign-key
   * column can be bound directly) or spacify: URIs ("uri", the default otherwise).
   */
  valueKind?: "id" | "uri";
  /** How many suggestions to show. */
  limit?: number;
  /**
   * Adds a "Create …" item to the list for when the entity doesn't exist yet; called with what was
   * typed (possibly empty). The caller creates it (or collects a name for it) and sets the value.
   */
  onCreate?: (name: string) => void;
  /**
   * Shown first while nothing is typed, under their own heading (e.g. the library's pinned and
   * saved items), and searched along with everything else.
   */
  suggested?: readonly EntityOption[];
  /** Heading for `suggested`. */
  suggestedLabel?: string;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string | null | undefined;
  onChange: (value: string | null, option: EntityOption | undefined) => void;
}

interface MultipleProps extends BaseProps {
  multiple: true;
  value: readonly string[];
  onChange: (value: string[], options: EntityOption[]) => void;
}

export type EntityPickerProps = SingleProps | MultipleProps;

const optionUri = (o: Pick<EntityOption, "type" | "id">) => toEntityUri(o.type, o.id);

/**
 * The generic picker for relations between entities: a typeahead over the same entity search as
 * @ mentions (search_entities()), restricted to `types`, picking one entity or several
 * (`multiple`). Entities dragged onto it (see "Drag and drop" in CLAUDE.md) are picked too. Use it
 * for every "related entity" field in a form instead of a <select>.
 */
export function EntityPicker(props: EntityPickerProps) {
  const { label, ariaLabel, hint, placeholder, disabled, required, types, options, exclude, limit = 12, onCreate, suggested, suggestedLabel } = props;
  const { t } = useI18n();
  const lifecycle = useEntityLifecycle();
  const generatedId = useId();
  const inputId = props.id ?? generatedId;
  const listId = `${inputId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Titles of what was picked in this session, so a pick shows its name before labels load.
  const [picked, setPicked] = useState<Map<string, EntityOption>>(() => new Map());

  const valueKind = props.valueKind ?? (types?.length === 1 ? "id" : "uri");
  const allowed = useMemo(() => (types ? new Set<string>(types) : null), [types]);

  /** A stored value (an id of the only type, or a URI) as an entity reference. */
  const toRef = (value: string): { type: EntityType; id: string } | null => {
    if (valueKind === "id") return types?.[0] && value ? { type: types[0], id: value } : null;
    const parsed = parseEntityUri(value);
    return parsed && isKnownEntityType(parsed.entityType) ? { type: parsed.entityType, id: parsed.entityId } : null;
  };
  const toValue = (o: EntityOption) => (valueKind === "id" ? o.id : optionUri(o));

  const values = props.multiple ? [...props.value] : props.value ? [props.value] : [];
  const refs = values.map((v) => ({ value: v, ref: toRef(v) }));
  const selectedUris = new Set(refs.flatMap(({ ref }) => (ref ? [optionUri(ref)] : [])));
  const excluded = new Set<string>();
  for (const x of exclude ?? []) {
    const ref = toRef(x) ?? (types?.[0] ? { type: types[0], id: x } : null);
    if (ref) excluded.add(optionUri(ref));
  }

  // Names for the current values: from `options` when given, else looked up by URI.
  const optionByUri = useMemo(() => new Map([...(suggested ?? []), ...(options ?? [])].map((o) => [optionUri(o), o])), [options, suggested]);
  const unresolved = [...selectedUris].filter((uri) => !optionByUri.has(uri) && !picked.has(uri));
  const { data: labels } = useEntityLabels(unresolved);
  const describe = (ref: { type: EntityType; id: string }): EntityOption => {
    const uri = optionUri(ref);
    return optionByUri.get(uri) ?? picked.get(uri) ?? { ...ref, title: labelFor(labels, uri) ?? "…" };
  };

  const search = useEntitySearch(query, { types, limit: limit + selectedUris.size + excluded.size, enabled: open && !options, browse: true });
  const needle = query.trim().toLowerCase();
  const suggestions = useMemo((): EntityOption[] => {
    const pickable = (o: EntityOption) =>
      (!allowed || allowed.has(o.type)) &&
      !excluded.has(optionUri(o)) &&
      !selectedUris.has(optionUri(o)) &&
      !lifecycle.isHidden(optionUri(o));
    if (options) {
      const matching = options.filter(
        (o) => pickable(o) && (!needle || o.title.toLowerCase().includes(needle) || o.subtitle?.toLowerCase().includes(needle)),
      );
      // Keep the given (tree) order while browsing; put leading matches first while searching.
      const sorted = needle
        ? [...matching].sort((a, b) => Number(!a.title.toLowerCase().startsWith(needle)) - Number(!b.title.toLowerCase().startsWith(needle)))
        : matching;
      return sorted.slice(0, needle ? limit : Math.max(limit, 50)).map((o) => (needle ? { ...o, depth: 0 } : o));
    }
    // A pasted spacify: URI or app URL comes back from the search as just that entity.
    const found = search.results.map((r): EntityOption => ({ type: r.entity_type, id: r.entity_id, title: r.title, subtitle: r.subtitle }));
    const suggestedHere = (suggested ?? []).filter(
      (o) => !needle || o.title.toLowerCase().includes(needle) || o.subtitle?.toLowerCase().includes(needle),
    );
    const seen = new Set<string>();
    return [...suggestedHere, ...found]
      .filter((o) => pickable(o) && !seen.has(optionUri(o)) && !!seen.add(optionUri(o)))
      .slice(0, limit + (needle ? 0 : suggestedHere.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sets are rebuilt every render from these
  }, [options, suggested, search.results, query, limit, allowed, values.join("\n"), [...excluded].join("\n"), lifecycle]);

  const loading = !options && search.loading && suggestions.length === 0;
  // The "Create …" item comes after the suggestions in keyboard order.
  const itemCount = suggestions.length + (onCreate ? 1 : 0);

  function create() {
    if (!onCreate) return;
    onCreate(query.trim());
    setQuery("");
    setActive(0);
    setOpen(false);
    inputRef.current?.blur();
  }
  const multipleTypes = !types || types.length > 1;
  const suggestedUris = new Set((suggested ?? []).map(optionUri));
  const isSuggested = (o: EntityOption) => suggestedUris.has(optionUri(o));

  function remember(o: EntityOption) {
    // A pasted URI has no name yet; let the label lookup find it.
    if (o.title.trim().toLowerCase().startsWith(`${entityUriScheme()}:`)) return;
    setPicked((prev) => new Map(prev).set(optionUri(o), o));
  }

  function pick(o: EntityOption | undefined) {
    if (!o) return;
    remember(o);
    setQuery("");
    setActive(0);
    if (props.multiple) {
      const next = [...props.value, toValue(o)];
      props.onChange(next, [...refs.flatMap(({ ref }) => (ref ? [describe(ref)] : [])), o]);
      inputRef.current?.focus();
    } else {
      props.onChange(toValue(o), o);
      setOpen(false);
    }
  }

  function remove(value: string) {
    if (props.multiple) {
      const next = props.value.filter((v) => v !== value);
      props.onChange(next, next.map((v) => toRef(v)).flatMap((r) => (r ? [describe(r)] : [])));
    } else {
      props.onChange(null, undefined);
    }
  }

  const drop = useEntityDropTarget((d) => {
    if (disabled) return;
    const parsed = parseEntityUri(d.uri);
    if (!parsed || !isKnownEntityType(parsed.entityType) || (allowed && !allowed.has(parsed.entityType))) return;
    const add = (o: EntityOption) => {
      if (excluded.has(optionUri(o)) || selectedUris.has(optionUri(o))) return;
      pick(o);
    };
    if (isUuid(parsed.entityId)) add({ type: parsed.entityType, id: parsed.entityId, title: d.label });
    // A dropped URI text can address its row by slug or identifier (as "Copy URI" copies it).
    else
      void lookupEntity(parsed.entityType, parsed.entityId).then((found) => {
        if (found) add({ type: parsed.entityType, id: found.id, title: found.title });
      });
  });

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      const n = Math.max(itemCount, 1);
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      // Enter picks a suggestion instead of submitting the sheet.
      if (open && itemCount > 0) {
        e.preventDefault();
        const i = Math.min(active, itemCount - 1);
        if (i < suggestions.length) pick(suggestions[i]);
        else create();
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery("");
    } else if (e.key === "Backspace" && !query && props.multiple && props.value.length > 0) {
      remove(props.value[props.value.length - 1]);
    }
  }

  const single = !props.multiple ? refs[0] : undefined;
  const singleOption = single?.ref ? describe(single.ref) : undefined;
  const typeLabel = (type: EntityType) => t(`entity.${type}` as MessageKey);
  const subFor = (o: EntityOption) => [multipleTypes ? typeLabel(o.type) : null, o.subtitle].filter(Boolean).join(" · ");
  const editingSingle = !props.multiple && open;

  return (
    <div
      className={["bungalow-field", "entity-picker", drop.over ? "entity-picker--drop" : "", disabled ? "entity-picker--disabled" : ""]
        .filter(Boolean)
        .join(" ")}
      {...drop.props}
    >
      {label ? (
        <label className="bungalow-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      {props.multiple && refs.length > 0 ? (
        <ul className="entity-picker__chips">
          {refs.map(({ value, ref }) => {
            const o = ref ? describe(ref) : undefined;
            return (
              <li key={value} className="entity-picker__chip" style={o && lifecycle.isDimmed(optionUri(o)) ? { opacity: 0.2 } : undefined}>
                {o ? <EntityArt type={o.type} title={o.title} size="sm" uri={optionUri(o)} /> : null}
                <span className="entity-picker__chip-label">{o?.title ?? value}</span>
                {!disabled ? (
                  <button
                    type="button"
                    className="entity-picker__remove"
                    aria-label={t("picker.remove", { name: o?.title ?? value })}
                    onClick={() => remove(value)}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="entity-picker__control">
        {singleOption && !editingSingle ? <EntityArt type={singleOption.type} title={singleOption.title} size="sm" uri={optionUri(singleOption)} /> : null}
        <input
          ref={inputRef}
          id={inputId}
          className="bungalow-input entity-picker__input"
          value={editingSingle || props.multiple ? query : (singleOption?.title ?? "")}
          placeholder={
            editingSingle && singleOption ? singleOption.title : (placeholder ?? t(props.multiple ? "picker.placeholderMany" : "picker.placeholder"))
          }
          disabled={disabled}
          required={required && values.length === 0}
          autoComplete="off"
          aria-label={label ? undefined : ariaLabel}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active < itemCount ? `${listId}-${active}` : undefined}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {!props.multiple && singleOption && !disabled && !required ? (
          <button
            type="button"
            className="entity-picker__clear"
            aria-label={t("picker.clear")}
            // Keep focus where it is, so clearing doesn't open the list.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => remove(single!.value)}
          >
            ×
          </button>
        ) : null}
        {open ? (
          <div id={listId} className="entity-picker__list" role="listbox">
            {suggestions.map((o, i) => (
              <Fragment key={optionUri(o)}>
                {!needle && !options && (i === 0 || isSuggested(suggestions[i - 1]) !== isSuggested(o)) ? (
                  <div className="rt-suggest__head">{isSuggested(o) ? (suggestedLabel ?? t("picker.suggested")) : t("picker.recent")}</div>
                ) : null}
                <button
                  id={`${listId}-${i}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  className="rt-suggest__item entity-picker__option"
                  style={{
                    ...(o.depth ? { paddingInlineStart: `${0.5 + o.depth * 1}rem` } : {}),
                    ...(lifecycle.isDimmed(optionUri(o)) ? { opacity: 0.2 } : {}),
                  }}
                  // Pick on mousedown, before the input's blur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <EntityArt type={o.type} title={o.title} size="sm" uri={optionUri(o)} />
                  <span className="rt-suggest__label">{o.title}</span>
                  <span className="rt-suggest__sub">{subFor(o)}</span>
                </button>
              </Fragment>
            ))}
            {suggestions.length === 0 ? (
              <div className="rt-suggest__empty">{loading ? t("picker.searching") : t("picker.noMatches")}</div>
            ) : null}
            {onCreate ? (
              <button
                id={`${listId}-${suggestions.length}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={active === suggestions.length}
                className="rt-suggest__item entity-picker__option entity-picker__create"
                onMouseDown={(e) => {
                  e.preventDefault();
                  create();
                }}
                onMouseEnter={() => setActive(suggestions.length)}
              >
                <span className="entity-picker__create-icon" aria-hidden="true">
                  +
                </span>
                <span className="rt-suggest__label">{query.trim() ? t("picker.create", { name: query.trim() }) : t("picker.createNew")}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {hint ? <span className="bungalow-help">{hint}</span> : null}
    </div>
  );
}
