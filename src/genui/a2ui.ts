/**
 * A2UI (Agent to UI, v0.8): an agent describes a UI as JSON messages and the client renders it with
 * its own components. This is the protocol's state: surfaces, their flat list of components (an
 * adjacency list: containers name their children by id) and their data model, which components bind
 * to by path. `<A2uiSurfaceView/>` (./A2uiSurface.tsx) renders a surface with gondol's components.
 *
 * Messages (one key each): `surfaceUpdate` (components), `dataModelUpdate` (data at a path),
 * `beginRendering` (the root component, the surface may show) and `deleteSurface`. User actions go
 * back as `userAction` (name, surfaceId, sourceComponentId, timestamp, context).
 *
 * gondol reads a little more than the spec, to be forgiving with what models write: a data entry's
 * `valueJson` (any JSON, so lists can be sent as lists), bare literals where a bound value is
 * expected, and paths without a leading slash in dataModelUpdate (as the spec's own example has). A
 * dataModelUpdate merges into what is at its path (the root included) rather than replacing it.
 */

export type A2uiJson = string | number | boolean | null | A2uiJson[] | { [key: string]: A2uiJson };

/** A value a component property takes: a literal, a path into the data model, or both (initialization). */
export type A2uiBoundValue = {
  path?: string;
  literalString?: string;
  literalNumber?: number;
  literalBoolean?: boolean;
  literalArray?: string[];
};

/** A container's children: a fixed list of ids, or a template repeated over a list in the data model. */
export type A2uiChildren = {
  explicitList?: string[];
  template?: { componentId: string; dataBinding: string };
};

/** One component of a surface: `component` holds exactly one key, its type (`{"Text": {...}}`). */
export type A2uiComponent = {
  id: string;
  weight?: number;
  component: Record<string, Record<string, unknown>>;
};

export type A2uiDataEntry = {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: A2uiDataEntry[];
  /** gondol: any JSON value (lists included). */
  valueJson?: A2uiJson;
};

export type A2uiMessage = {
  beginRendering?: { surfaceId: string; root: string; catalogId?: string; styles?: Record<string, unknown> };
  surfaceUpdate?: { surfaceId: string; components: A2uiComponent[] };
  dataModelUpdate?: { surfaceId: string; path?: string; contents: A2uiDataEntry[] };
  deleteSurface?: { surfaceId: string };
};

/** What the client sends back when the user acts on a component (a Button's `action`). */
export type A2uiUserAction = {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
};

export type A2uiSurface = {
  id: string;
  /** The root component's id, once `beginRendering` came. */
  root: string | null;
  catalogId?: string;
  styles?: Record<string, unknown>;
  components: Record<string, A2uiComponent>;
  data: Record<string, unknown>;
};

/** Every surface, by id. */
export type A2uiState = Record<string, A2uiSurface>;

/** The surface id messages without one go to (and that converted formats use). */
export const DEFAULT_SURFACE = "main";

const emptySurface = (id: string): A2uiSurface => ({ id, root: null, components: {}, data: {} });

// ---- Paths ------------------------------------------------------------------------------------

/** "/a/b/0" → ["a", "b", "0"]. */
export function pathSegments(path: string): string[] {
  return path.split("/").filter((part) => part !== "" && part !== ".");
}

/**
 * An absolute path: `/x` as it is, anything else relative to `scope` (the item a template renders),
 * where `..` steps up. Without a scope, a relative path is taken from the root.
 */
export function resolvePath(path: string, scope?: string | null): string {
  if (path.startsWith("/")) return path;
  const parts = scope ? pathSegments(scope) : [];
  for (const part of pathSegments(path)) {
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** The value at an absolute path ("/" is the whole model). */
export function getAt(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const part of pathSegments(path)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) current = current[Number(part)];
    else if (typeof current === "object") current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current;
}

/** A copy of `data` with `value` at `path` (objects are created on the way; "/" replaces it all). */
export function setAt(data: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = pathSegments(path);
  if (!parts.length) return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const write = (node: unknown, index: number): unknown => {
    const key = parts[index];
    const last = index === parts.length - 1;
    if (Array.isArray(node) && /^\d+$/.test(key)) {
      const copy = [...node];
      copy[Number(key)] = last ? value : write(copy[Number(key)], index + 1);
      return copy;
    }
    const base = node && typeof node === "object" && !Array.isArray(node) ? (node as Record<string, unknown>) : {};
    return { ...base, [key]: last ? value : write(base[key], index + 1) };
  };
  return write(data, 0) as Record<string, unknown>;
}

// ---- Values -----------------------------------------------------------------------------------

/** A data entry list (adjacency list) as a plain object. */
export function contentsToObject(contents: readonly A2uiDataEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of contents ?? []) {
    if (!entry || typeof entry.key !== "string") continue;
    out[entry.key] = entryValue(entry);
  }
  return out;
}

function entryValue(entry: A2uiDataEntry): unknown {
  if (entry.valueJson !== undefined) return entry.valueJson;
  if (entry.valueString !== undefined) return entry.valueString;
  if (entry.valueNumber !== undefined) return entry.valueNumber;
  if (entry.valueBoolean !== undefined) return entry.valueBoolean;
  if (Array.isArray(entry.valueMap)) return contentsToObject(entry.valueMap);
  // Models sometimes write `value`.
  return (entry as { value?: unknown }).value ?? null;
}

/** A plain object as data entries (lists and nested values go as `valueJson`), for converted formats. */
export function objectToContents(data: Record<string, unknown>): A2uiDataEntry[] {
  return Object.entries(data).map(([key, value]) => {
    if (typeof value === "string") return { key, valueString: value };
    if (typeof value === "number") return { key, valueNumber: value };
    if (typeof value === "boolean") return { key, valueBoolean: value };
    return { key, valueJson: (value ?? null) as A2uiJson };
  });
}

function isBoundValue(value: unknown): value is A2uiBoundValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => key === "path" || key.startsWith("literal"));
}

function literalOf(value: A2uiBoundValue): unknown {
  if (value.literalString !== undefined) return value.literalString;
  if (value.literalNumber !== undefined) return value.literalNumber;
  if (value.literalBoolean !== undefined) return value.literalBoolean;
  if (value.literalArray !== undefined) return value.literalArray;
  return undefined;
}

/**
 * A property's value now: a bound value's data (or its literal), or the property itself when a model
 * wrote a bare literal.
 */
export function resolveValue(value: unknown, data: Record<string, unknown>, scope?: string | null): unknown {
  if (!isBoundValue(value)) return value;
  if (typeof value.path === "string") {
    const found = getAt(data, resolvePath(value.path, scope));
    return found === undefined ? literalOf(value) : found;
  }
  return literalOf(value);
}

/** The absolute path a bound property writes to (inputs), if it has one. */
export function boundPath(value: unknown, scope?: string | null): string | null {
  return isBoundValue(value) && typeof value.path === "string" ? resolvePath(value.path, scope) : null;
}

export function resolveText(value: unknown, data: Record<string, unknown>, scope?: string | null): string {
  const resolved = resolveValue(value, data, scope);
  if (resolved === null || resolved === undefined) return "";
  return typeof resolved === "object" ? JSON.stringify(resolved) : String(resolved);
}

/** A Button's action context with every bound value resolved. */
export function resolveContext(context: unknown, data: Record<string, unknown>, scope?: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(context)) {
    for (const item of context) {
      if (item && typeof item === "object" && typeof (item as { key?: unknown }).key === "string") {
        out[(item as { key: string }).key] = resolveValue((item as { value?: unknown }).value, data, scope);
      }
    }
  } else if (context && typeof context === "object") {
    for (const [key, value] of Object.entries(context)) out[key] = resolveValue(value, data, scope);
  }
  return out;
}

/** The component's type and properties. */
export function componentType(entry: A2uiComponent): { type: string; props: Record<string, unknown> } {
  const [type] = Object.keys(entry.component ?? {});
  const props = type ? entry.component[type] : {};
  return { type: type ?? "", props: props && typeof props === "object" ? props : {} };
}

/** The ids and data scopes a container's children render with (templates repeat over a list or map). */
export function childrenOf(
  children: unknown,
  data: Record<string, unknown>,
  scope?: string | null,
): { id: string; key: string; scope: string | null }[] {
  if (Array.isArray(children)) return children.filter((id): id is string => typeof id === "string").map((id) => ({ id, key: id, scope: scope ?? null }));
  if (!children || typeof children !== "object") return [];
  const value = children as A2uiChildren;
  if (Array.isArray(value.explicitList)) {
    return value.explicitList.filter((id) => typeof id === "string").map((id) => ({ id, key: id, scope: scope ?? null }));
  }
  if (value.template && typeof value.template.componentId === "string" && typeof value.template.dataBinding === "string") {
    const base = resolvePath(value.template.dataBinding, scope);
    const list = getAt(data, base);
    const keys = Array.isArray(list) ? list.map((_, index) => String(index)) : list && typeof list === "object" ? Object.keys(list) : [];
    const prefix = base === "/" ? "" : base;
    return keys.map((key) => ({ id: value.template!.componentId, key: `${value.template!.componentId}@${key}`, scope: `${prefix}/${key}` }));
  }
  return [];
}

// ---- Messages ---------------------------------------------------------------------------------

/**
 * Sets the data a bound value with both a path and a literal initializes (when nothing is there yet),
 * as the spec has it.
 */
function initializeData(surface: A2uiSurface, components: A2uiComponent[]): Record<string, unknown> {
  let data = surface.data;
  const visit = (value: unknown) => {
    if (isBoundValue(value)) {
      const literal = literalOf(value);
      if (typeof value.path === "string" && value.path.startsWith("/") && literal !== undefined && getAt(data, value.path) === undefined) {
        data = setAt(data, value.path, literal);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  for (const component of components) visit(component.component);
  return data;
}

/** The state after one message. Unknown or malformed messages change nothing. */
export function applyA2uiMessage(state: A2uiState, message: A2uiMessage): A2uiState {
  if (!message || typeof message !== "object") return state;
  if (message.surfaceUpdate) {
    const id = message.surfaceUpdate.surfaceId || DEFAULT_SURFACE;
    const surface = state[id] ?? emptySurface(id);
    const list = (message.surfaceUpdate.components ?? []).filter(
      (c): c is A2uiComponent => !!c && typeof c.id === "string" && !!c.component && typeof c.component === "object",
    );
    const components = { ...surface.components };
    for (const component of list) components[component.id] = component;
    return { ...state, [id]: { ...surface, components, data: initializeData(surface, list) } };
  }
  if (message.dataModelUpdate) {
    const id = message.dataModelUpdate.surfaceId || DEFAULT_SURFACE;
    const surface = state[id] ?? emptySurface(id);
    const value = contentsToObject(message.dataModelUpdate.contents ?? []);
    const path = message.dataModelUpdate.path ? resolvePath(message.dataModelUpdate.path) : "/";
    // At the root the update is merged too, so values components initialized (path + literal) stay.
    const data = path === "/" ? { ...surface.data, ...value } : setAt(surface.data, path, { ...((getAt(surface.data, path) as object) ?? {}), ...value });
    return { ...state, [id]: { ...surface, data } };
  }
  if (message.beginRendering) {
    const id = message.beginRendering.surfaceId || DEFAULT_SURFACE;
    const surface = state[id] ?? emptySurface(id);
    return {
      ...state,
      [id]: { ...surface, root: message.beginRendering.root, catalogId: message.beginRendering.catalogId, styles: message.beginRendering.styles },
    };
  }
  if (message.deleteSurface) {
    const { [message.deleteSurface.surfaceId]: _gone, ...rest } = state;
    return rest;
  }
  return state;
}

export function applyA2uiMessages(state: A2uiState, messages: readonly A2uiMessage[]): A2uiState {
  return messages.reduce(applyA2uiMessage, state);
}

const MESSAGE_KEYS = ["beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface"] as const;

const isMessage = (value: unknown): value is A2uiMessage =>
  !!value && typeof value === "object" && !Array.isArray(value) && MESSAGE_KEYS.some((key) => key in (value as object));

/**
 * A2UI messages from what an agent wrote: a list of messages, one message, `{messages: […]}`, or
 * JSON Lines (one message per line, as the protocol streams them). Text is parsed first.
 * Anything else gives an empty list.
 */
export function parseA2ui(input: unknown): A2uiMessage[] {
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return [];
    try {
      return parseA2ui(JSON.parse(text));
    } catch {
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const out: A2uiMessage[] = [];
      for (const line of lines) {
        try {
          out.push(...parseA2ui(JSON.parse(line)));
        } catch {
          return [];
        }
      }
      return out;
    }
  }
  if (Array.isArray(input)) return input.flatMap((item) => parseA2ui(item));
  if (isMessage(input)) return [input];
  if (input && typeof input === "object" && Array.isArray((input as { messages?: unknown }).messages)) {
    return parseA2ui((input as { messages: unknown[] }).messages);
  }
  return [];
}

/** Whether `input` reads as A2UI (at least one message). */
export function looksLikeA2ui(input: unknown): boolean {
  return parseA2ui(input).length > 0;
}

/**
 * The surfaces a list of messages builds. A surface that got components but no `beginRendering`
 * renders from a component named `root`, else its first component, so a model that forgot the
 * message still shows something.
 */
export function buildA2uiState(messages: readonly A2uiMessage[], data?: Record<string, unknown>): A2uiState {
  let state = applyA2uiMessages({}, messages);
  for (const surface of Object.values(state)) {
    let next = surface;
    if (!next.root) {
      const ids = Object.keys(next.components);
      next = { ...next, root: next.components.root ? "root" : (ids[0] ?? null) };
    }
    if (data) next = { ...next, data: { ...next.data, ...data } };
    state = { ...state, [surface.id]: next };
  }
  return state;
}
