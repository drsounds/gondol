import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ComponentType, type ReactNode } from "react";
import { Button, Card, Checkbox, Icon, type IconName } from "../design-system/bungalow-79d923";
import {
  boundPath,
  buildA2uiState,
  childrenOf,
  componentType,
  DEFAULT_SURFACE,
  resolveContext,
  resolveText,
  resolveValue,
  setAt,
  type A2uiComponent,
  type A2uiMessage,
  type A2uiSurface,
  type A2uiUserAction,
} from "./a2ui";

/**
 * Renders an A2UI surface (./a2ui.ts) with gondol's components: the v0.8 standard catalogue (Text,
 * Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs, Divider, Modal, Button, CheckBox,
 * TextField, DateTimeInput, MultipleChoice, Slider) plus gondol's `Table` (`columns`: `[{key,
 * label}]`, `rows`: a bound list), and any components the host adds with `catalog`.
 *
 * Inputs write to the surface's data model as the user types (two-way, locally); a Button's action
 * goes to `onAction` as a `userAction` with its context resolved. The host decides what an action
 * does: send it back to the agent, run it itself, or both.
 */

export type A2uiActionHandler = (action: A2uiUserAction) => void | Promise<void>;

/** What a catalogue component gets: its own properties and the means to render children and act. */
export type A2uiComponentProps = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  /** The data path the component renders in (a template's item), or null at the root. */
  scope: string | null;
  data: Record<string, unknown>;
  /** Writes to the data model. */
  setData: (path: string, value: unknown) => void;
  /** Renders another component of the surface (`scope` defaults to this one's). */
  renderChild: (id: string, scope?: string | null) => ReactNode;
  /** Sends a user action from this component. */
  emit: (name: string, context?: Record<string, unknown>) => void;
};

export type A2uiCatalog = Record<string, ComponentType<A2uiComponentProps>>;

/** A2UI's standard icon names, drawn with the closest bungalow glyph (bungalow names work too). */
const ICONS: Record<string, IconName> = {
  accountCircle: "user",
  person: "user",
  add: "plus",
  arrowBack: "skip-to-prev",
  arrowForward: "forward",
  attachFile: "link",
  calendarToday: "calendar",
  event: "calendar",
  call: "phone",
  phone: "phone",
  camera: "image",
  photo: "image",
  check: "check",
  close: "minus",
  delete: "recycle-bin",
  download: "box",
  upload: "box",
  edit: "edit",
  error: "warning",
  warning: "warning",
  favorite: "like-fill",
  favoriteOff: "like",
  folder: "folder-open",
  help: "lightbulb",
  info: "lightbulb",
  home: "home",
  locationOn: "compass",
  lock: "shield",
  lockOpen: "shield",
  mail: "chat",
  send: "forward",
  menu: "three-dots-v",
  moreVert: "three-dots-v",
  moreHoriz: "three-dots-h",
  notifications: "broadcast",
  notificationsOff: "broadcast",
  payment: "credit-card",
  print: "document",
  refresh: "repeat",
  search: "magnifying-glass",
  settings: "settings",
  share: "link",
  shoppingCart: "box",
  star: "star",
  starHalf: "star",
  starOff: "star",
  visibility: "eye",
  visibilityOff: "eye",
};

const JUSTIFY: Record<string, CSSProperties["justifyContent"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
};
const ALIGN: Record<string, CSSProperties["alignItems"]> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };

/** Only web and inline image/video/audio addresses are loaded. */
function safeUrl(value: string): string | null {
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || /^data:(image|video|audio)\//i.test(url) || url.startsWith("/")) return url;
  return null;
}

const MAX_DEPTH = 40;

function Unknown({ type }: { type: string }) {
  return <div className="genui-unknown">{type ? `Unsupported component: ${type}` : "Empty component"}</div>;
}

/** Tabs keep their own selection. */
function TabsView({ items, render }: { items: { title: string; child: string }[]; render: (id: string) => ReactNode }) {
  const [active, setActive] = useState(0);
  const current = items[Math.min(active, items.length - 1)];
  return (
    <div className="genui-tabs">
      <div className="genui-tabs__list" role="tablist">
        {items.map((item, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === active}
            className={`genui-tabs__tab${index === active ? " genui-tabs__tab--active" : ""}`}
            onClick={() => setActive(index)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="genui-tabs__panel" role="tabpanel">
        {current ? render(current.child) : null}
      </div>
    </div>
  );
}

function ModalView({ entry, content }: { entry: ReactNode; content: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="genui-modal__entry" onClickCapture={() => setOpen(true)}>
        {entry}
      </span>
      {open ? (
        <div className="genui-modal" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="genui-modal__content" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="genui-modal__close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
            {content}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChoiceView({
  options,
  selected,
  max,
  chips,
  filterable,
  onChange,
}: {
  options: { label: string; value: string }[];
  selected: string[];
  max: number | null;
  chips: boolean;
  filterable: boolean;
  onChange: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = filter ? options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase())) : options;
  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else if (max === 1) onChange([value]);
    else if (max === null || selected.length < max) onChange([...selected, value]);
  };
  return (
    <div className={`genui-choice${chips ? " genui-choice--chips" : ""}`}>
      {filterable ? <input className="bungalow-input genui-choice__filter" value={filter} placeholder="…" onChange={(e) => setFilter(e.target.value)} /> : null}
      {shown.map((option) =>
        chips ? (
          <button
            key={option.value}
            type="button"
            className={`genui-chip${selected.includes(option.value) ? " genui-chip--on" : ""}`}
            aria-pressed={selected.includes(option.value)}
            onClick={() => toggle(option.value)}
          >
            {option.label}
          </button>
        ) : (
          <Checkbox key={option.value} label={option.label} checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
        ),
      )}
    </div>
  );
}

function TableView({ columns, rows, emitRow }: { columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; emitRow?: (row: Record<string, unknown>) => void }) {
  const keys = columns.length ? columns : Object.keys(rows[0] ?? {}).map((key) => ({ key, label: key }));
  const cell = (value: unknown) => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
  return (
    <table className="data-table genui-table">
      <thead>
        <tr>
          {keys.map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} onClick={emitRow ? () => emitRow(row) : undefined} className={emitRow ? "genui-table__row--action" : undefined}>
            {keys.map((column) => (
              <td key={column.key}>{cell(row[column.key])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Renders one surface. Keep it keyed by the surface id; its data starts from `surface.data`. */
export function A2uiSurfaceView({
  surface,
  onAction,
  catalog,
  onDataChange,
}: {
  surface: A2uiSurface;
  onAction?: A2uiActionHandler;
  catalog?: A2uiCatalog;
  /** Told about every change the user makes to the data model. */
  onDataChange?: (data: Record<string, unknown>) => void;
}) {
  const [data, setDataState] = useState(surface.data);
  // New data from the agent (or the host) replaces what the user had.
  useEffect(() => setDataState(surface.data), [surface.data]);
  const setData = useCallback(
    (path: string, value: unknown) =>
      setDataState((previous) => {
        const next = setAt(previous, path, value);
        onDataChange?.(next);
        return next;
      }),
    [onDataChange],
  );

  const emit = useCallback(
    (sourceComponentId: string, name: string, context: Record<string, unknown>) => {
      void onAction?.({ name, surfaceId: surface.id, sourceComponentId, timestamp: new Date().toISOString(), context });
    },
    [onAction, surface.id],
  );

  const render = (id: string, scope: string | null, trail: readonly string[]): ReactNode => {
    const entry: A2uiComponent | undefined = surface.components[id];
    if (!entry) return <Unknown key={id} type={`#${id}`} />;
    if (trail.length > MAX_DEPTH || trail.includes(`${id}|${scope ?? ""}`)) return null;
    const next = [...trail, `${id}|${scope ?? ""}`];
    const { type, props } = componentType(entry);
    const child = (childId: unknown, childScope: string | null = scope) => (typeof childId === "string" ? render(childId, childScope, next) : null);
    const text = (value: unknown) => resolveText(value, data, scope);
    // A weight applies in a Row or Column, on the item that holds the component (itemStyle).
    const wrap = (node: ReactNode) => node;

    const Extension = catalog?.[type];
    if (Extension) {
      return wrap(
        <Extension
          id={id}
          type={type}
          props={props}
          scope={scope}
          data={data}
          setData={setData}
          renderChild={(childId, childScope) => child(childId, childScope === undefined ? scope : childScope)}
          emit={(name, context) => emit(id, name, context ?? {})}
        />,
      );
    }

    switch (type) {
      case "Text": {
        const value = text(props.text);
        const hint = String(props.usageHint ?? "body");
        if (/^h[1-5]$/.test(hint)) {
          const Tag = hint as "h1";
          return wrap(<Tag className={`genui-text genui-text--${hint}`}>{value}</Tag>);
        }
        return wrap(<p className={`genui-text genui-text--${hint === "caption" ? "caption" : "body"}`}>{value}</p>);
      }
      case "Image": {
        const url = safeUrl(text(props.url));
        if (!url) return null;
        return wrap(
          <img
            className={`genui-image genui-image--${String(props.usageHint ?? "mediumFeature")}`}
            src={url}
            alt={text(props.altText)}
            style={{ objectFit: (props.fit as CSSProperties["objectFit"]) ?? "cover" }}
          />,
        );
      }
      case "Icon": {
        const name = text(props.name);
        return wrap(<Icon className="genui-icon" name={(ICONS[name] ?? name ?? "three-dots-h") as IconName} />);
      }
      case "Video": {
        const url = safeUrl(text(props.url));
        return url ? wrap(<video className="genui-video" src={url} controls />) : null;
      }
      case "AudioPlayer": {
        const url = safeUrl(text(props.url));
        const description = text(props.description);
        return url
          ? wrap(
              <figure className="genui-audio">
                {description ? <figcaption>{description}</figcaption> : null}
                <audio src={url} controls />
              </figure>,
            )
          : null;
      }
      case "Row":
      case "Column":
      case "List": {
        const horizontal = type === "Row" || (type === "List" && props.direction === "horizontal");
        const items = childrenOf(props.children, data, scope);
        return wrap(
          <div
            className={`genui-${type.toLowerCase()}${horizontal ? " genui-horizontal" : ""}`}
            style={{ justifyContent: JUSTIFY[String(props.distribution)], alignItems: ALIGN[String(props.alignment)] }}
          >
            {items.map((item) => (
              <div key={item.key} className="genui-item" style={itemStyle(surface.components[item.id])}>
                {render(item.id, item.scope, next)}
              </div>
            ))}
          </div>,
        );
      }
      case "Card":
        return wrap(<Card className="genui-card">{child(props.child)}</Card>);
      case "Tabs": {
        const items = (Array.isArray(props.tabItems) ? props.tabItems : [])
          .filter((tab): tab is { title: unknown; child: string } => !!tab && typeof tab === "object" && typeof (tab as { child?: unknown }).child === "string")
          .map((tab) => ({ title: text(tab.title), child: tab.child }));
        return wrap(<TabsView items={items} render={(childId) => child(childId)} />);
      }
      case "Divider":
        return <hr className={`genui-divider${props.axis === "vertical" ? " genui-divider--vertical" : ""}`} />;
      case "Modal":
        return wrap(<ModalView entry={child(props.entryPointChild)} content={child(props.contentChild)} />);
      case "Button": {
        const action = (props.action ?? {}) as { name?: unknown; context?: unknown };
        const name = typeof action.name === "string" ? action.name : id;
        return wrap(
          <Button
            type="button"
            size="sm"
            tone={props.primary ? "primary" : "default"}
            variant={props.primary ? "solid" : "outline"}
            className="genui-button"
            onClick={() => emit(id, name, resolveContext(action.context, data, scope))}
          >
            {child(props.child)}
          </Button>,
        );
      }
      case "CheckBox": {
        const path = boundPath(props.value, scope);
        return wrap(
          <Checkbox
            label={text(props.label)}
            checked={resolveValue(props.value, data, scope) === true}
            onChange={(e) => (path ? setData(path, e.target.checked) : undefined)}
          />,
        );
      }
      case "TextField": {
        const path = boundPath(props.text, scope);
        const value = text(props.text);
        const kind = String(props.textFieldType ?? "shortText");
        const pattern = typeof props.validationRegexp === "string" ? props.validationRegexp : undefined;
        let invalid = false;
        if (pattern && value) {
          try {
            invalid = !new RegExp(pattern).test(value);
          } catch {
            invalid = false;
          }
        }
        const label = text(props.label);
        const onChange = (next: string) => (path ? setData(path, kind === "number" && next !== "" && !Number.isNaN(Number(next)) ? Number(next) : next) : undefined);
        return wrap(
          <label className={`genui-field${invalid ? " genui-field--invalid" : ""}`}>
            {label ? <span className="genui-field__label">{label}</span> : null}
            {kind === "longText" ? (
              <textarea className="bungalow-input genui-field__input" rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
            ) : (
              <input
                className="bungalow-input genui-field__input"
                type={kind === "number" ? "number" : kind === "date" ? "date" : kind === "obscured" ? "password" : "text"}
                value={value}
                aria-invalid={invalid || undefined}
                onChange={(e) => onChange(e.target.value)}
              />
            )}
          </label>,
        );
      }
      case "DateTimeInput": {
        const path = boundPath(props.value, scope);
        const date = props.enableDate !== false;
        const time = props.enableTime === true;
        return wrap(
          <input
            className="bungalow-input genui-field__input"
            type={date && time ? "datetime-local" : time ? "time" : "date"}
            value={text(props.value)}
            onChange={(e) => (path ? setData(path, e.target.value) : undefined)}
          />,
        );
      }
      case "MultipleChoice": {
        const path = boundPath(props.selections, scope);
        const raw = resolveValue(props.selections, data, scope);
        const selected = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" && raw ? [raw] : [];
        const options = (Array.isArray(props.options) ? props.options : [])
          .filter((o): o is { label: unknown; value: unknown } => !!o && typeof o === "object")
          .map((o) => ({ label: text(o.label) || String(o.value ?? ""), value: String(o.value ?? "") }));
        const max = typeof props.maxAllowedSelections === "number" ? props.maxAllowedSelections : null;
        return wrap(
          <ChoiceView
            options={options}
            selected={selected}
            max={max}
            chips={props.variant === "chips"}
            filterable={props.filterable === true}
            onChange={(nextValue) => (path ? setData(path, nextValue) : undefined)}
          />,
        );
      }
      case "Slider": {
        const path = boundPath(props.value, scope);
        const value = Number(resolveValue(props.value, data, scope) ?? 0);
        const label = text(props.label);
        return wrap(
          <label className="genui-field genui-slider">
            {label ? <span className="genui-field__label">{label}</span> : null}
            <input
              type="range"
              min={typeof props.minValue === "number" ? props.minValue : 0}
              max={typeof props.maxValue === "number" ? props.maxValue : 100}
              value={Number.isFinite(value) ? value : 0}
              onChange={(e) => (path ? setData(path, Number(e.target.value)) : undefined)}
            />
            <span className="genui-slider__value">{Number.isFinite(value) ? value : 0}</span>
          </label>,
        );
      }
      case "Table": {
        const rowsValue =
          props.rows && typeof props.rows === "object" && "literalJson" in (props.rows as object)
            ? (props.rows as { literalJson: unknown }).literalJson
            : resolveValue(props.rows, data, scope);
        const rows = Array.isArray(rowsValue)
          ? rowsValue.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
          : rowsValue && typeof rowsValue === "object"
            ? Object.values(rowsValue as Record<string, unknown>).filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
            : [];
        const columns = (Array.isArray(props.columns) ? props.columns : [])
          .map((c) => (typeof c === "string" ? { key: c, label: c } : c && typeof c === "object" ? { key: String((c as { key?: unknown }).key ?? ""), label: text((c as { label?: unknown }).label) || String((c as { key?: unknown }).key ?? "") } : null))
          .filter((c): c is { key: string; label: string } => !!c && !!c.key);
        const rowAction = (props.rowAction ?? null) as { name?: unknown } | null;
        return wrap(
          <TableView
            columns={columns}
            rows={rows}
            emitRow={rowAction && typeof rowAction.name === "string" ? (row) => emit(id, rowAction.name as string, { row }) : undefined}
          />,
        );
      }
      default:
        return wrap(<Unknown type={type} />);
    }
  };

  if (!surface.root) return null;
  return (
    <div className="genui-surface" data-surface={surface.id}>
      {render(surface.root, null, [])}
    </div>
  );
}

function itemStyle(entry: A2uiComponent | undefined): CSSProperties | undefined {
  return typeof entry?.weight === "number" ? { flexGrow: entry.weight, flexBasis: 0, minWidth: 0 } : undefined;
}

/**
 * Renders A2UI messages: every surface they build, in order (one, usually). `data` is merged into
 * every surface's data model (a host's own values, e.g. an app's records).
 */
export function A2uiView({
  messages,
  data,
  onAction,
  catalog,
  surfaceId,
}: {
  messages: readonly A2uiMessage[];
  data?: Record<string, unknown>;
  onAction?: A2uiActionHandler;
  catalog?: A2uiCatalog;
  /** Only this surface (default: all). */
  surfaceId?: string;
}) {
  const state = useMemo(() => buildA2uiState(messages, data), [messages, data]);
  const surfaces = Object.values(state).filter((surface) => (surfaceId ? surface.id === surfaceId : true));
  if (!surfaces.length) return <div className="genui-unknown">Nothing to show</div>;
  return (
    <>
      {surfaces.map((surface) => (
        <A2uiSurfaceView key={surface.id || DEFAULT_SURFACE} surface={surface} onAction={onAction} catalog={catalog} />
      ))}
    </>
  );
}
