import { DEFAULT_SURFACE, objectToContents, type A2uiComponent, type A2uiMessage } from "./a2ui";

/**
 * Open-JSON-UI: a UI as one nested JSON tree of typed nodes, the declarative shape OpenAI's
 * generative UI uses (`{"type": "card", "children": [...]}`). There is no published canonical schema,
 * so gondol reads the common shape generously and renders it by turning it into A2UI messages
 * (./a2ui.ts), so both formats share one renderer, data binding and actions.
 *
 * A document is a node, a list of nodes, or an envelope: `{type: "open-json-ui", spec | root |
 * components, data}` or `{version, root | component | ui, data}`. A node is
 * `{type, id?, props?, children?, ...props}`; `children` is a list of nodes or a string.
 *
 * Values may be bound to the data with `{"path": "/x"}` (or `{"bind": "/x"}`). Types (case and
 * dashes don't matter): text/paragraph/markdown/label, heading/title (with `level`), caption, badge,
 * image, icon, video, audio, row/hstack, column/vstack/stack/container/section/form/box, card (with
 * `title`), list (`items` + `template` repeats a node over a list in the data), divider, button
 * (`label`, `action`: a name or `{name, context}`, `variant: "primary"`), input/textfield/textarea,
 * checkbox/switch/toggle, select/radio/multiselect (`options`), slider, date/datetime, tabs (`tabs`:
 * `[{title, children}]`) and table (`columns`, `rows`). Any other type passes through as a component
 * of that name, so catalogue extensions (an app's own components) work as well.
 */

export type OpenJsonUiNode = {
  type: string;
  id?: string;
  props?: Record<string, unknown>;
  children?: OpenJsonUiNode[] | string;
  [key: string]: unknown;
};

const ENVELOPE_KEYS = ["spec", "root", "component", "ui", "components", "body", "content"] as const;

const kind = (type: unknown) => (typeof type === "string" ? type.toLowerCase().replace(/[-_\s]/g, "") : "");

function isNode(value: unknown): value is OpenJsonUiNode {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { type?: unknown }).type === "string";
}

/** The nodes and data of a document, or null when it isn't one. */
export function readOpenJsonUi(input: unknown): { nodes: OpenJsonUiNode[]; data: Record<string, unknown> } | null {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    const nodes = value.filter(isNode);
    return nodes.length ? { nodes, data: {} } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const data = (record.data ?? record.dataModel ?? record.state) as Record<string, unknown> | undefined;
  const envelope = kind(record.type) === "openjsonui" || "version" in record || !isNode(record);
  if (envelope) {
    for (const key of ENVELOPE_KEYS) {
      const inner = record[key];
      if (Array.isArray(inner) && inner.some(isNode)) return { nodes: inner.filter(isNode), data: data && typeof data === "object" ? data : {} };
      if (isNode(inner)) return { nodes: [inner], data: data && typeof data === "object" ? data : {} };
    }
    if (!isNode(record) || kind(record.type) === "openjsonui") return null;
  }
  return { nodes: [record as OpenJsonUiNode], data: data && typeof data === "object" ? data : {} };
}

/** Whether `input` reads as an Open-JSON-UI document. */
export function looksLikeOpenJsonUi(input: unknown): boolean {
  return readOpenJsonUi(input) !== null;
}

/** A literal or a binding, as an A2UI bound value. */
function bound(value: unknown, as: "string" | "number" | "boolean" | "array" = "string"): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const path = typeof v.path === "string" ? v.path : typeof v.bind === "string" ? v.bind : typeof v.$bind === "string" ? v.$bind : null;
    if (path) return { path };
    if (Object.keys(v).some((key) => key.startsWith("literal"))) return v;
  }
  if (as === "array" && Array.isArray(value)) return { literalArray: value.map(String) };
  if (as === "number" && typeof value === "number") return { literalNumber: value };
  if (as === "boolean" && typeof value === "boolean") return { literalBoolean: value };
  if (typeof value === "number") return { literalNumber: value };
  if (typeof value === "boolean") return { literalBoolean: value };
  return { literalString: typeof value === "string" ? value : JSON.stringify(value) };
}

function actionOf(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return { name: value };
  if (typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const name = [v.name, v.action, v.type, v.id].find((x) => typeof x === "string") as string | undefined;
  if (!name) return undefined;
  const raw = (v.context ?? v.params ?? v.payload ?? v.args) as unknown;
  const context = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.entries(raw as Record<string, unknown>).map(([key, item]) => ({ key, value: bound(item) ?? { literalString: "" } }))
      : undefined;
  return { name, ...(context?.length ? { context } : {}) };
}

class Converter {
  components: A2uiComponent[] = [];
  private used = new Set<string>();
  private counter = 0;

  private id(node: OpenJsonUiNode | null, hint: string): string {
    const wanted = node && typeof node.id === "string" && node.id.trim() ? node.id.trim() : null;
    if (wanted && !this.used.has(wanted)) {
      this.used.add(wanted);
      return wanted;
    }
    let next: string;
    do next = `${hint}-${++this.counter}`;
    while (this.used.has(next));
    this.used.add(next);
    return next;
  }

  private add(id: string, type: string, props: Record<string, unknown>, weight?: unknown): string {
    const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined));
    this.components.push({ id, component: { [type]: clean }, ...(typeof weight === "number" ? { weight } : {}) });
    return id;
  }

  private text(text: unknown, usageHint?: string, node: OpenJsonUiNode | null = null): string {
    return this.add(this.id(node, "text"), "Text", { text: bound(text) ?? { literalString: "" }, usageHint });
  }

  private kids(node: OpenJsonUiNode, props: Record<string, unknown>): string[] {
    const children = node.children ?? props.children;
    if (typeof children === "string") return [this.text(children)];
    if (!Array.isArray(children)) return [];
    return children.map((child) => (isNode(child) ? this.node(child) : this.text(child)));
  }

  /** Converts a node (and its children); returns its component id. */
  node(node: OpenJsonUiNode): string {
    const props: Record<string, unknown> = { ...node, ...(node.props ?? {}) };
    delete props.type;
    delete props.id;
    delete props.props;
    const k = kind(node.type);
    const label = props.label ?? props.text ?? props.title ?? props.content ?? props.value;
    const weight = props.weight ?? props.flex;

    const container = (type: "Row" | "Column" | "List", extra: Record<string, unknown> = {}) => {
      const template = props.template;
      const items = props.items ?? props.dataBinding;
      if (isNode(template) && items && typeof (bound(items) as { path?: string } | undefined)?.path === "string") {
        const templateId = this.node(template);
        return this.add(this.id(node, k || "list"), type, {
          children: { template: { componentId: templateId, dataBinding: (bound(items) as { path: string }).path } },
          ...extra,
        }, weight);
      }
      const id = this.id(node, k || "box");
      const children = this.kids(node, props);
      return this.add(id, type, { children: { explicitList: children }, ...extra }, weight);
    };
    const layout = {
      distribution: props.distribution ?? props.justify ?? props.justifyContent,
      alignment: props.alignment ?? props.align ?? props.alignItems,
    };

    switch (k) {
      case "text":
      case "paragraph":
      case "markdown":
      case "label":
      case "span":
      case "p":
        return this.text(label, "body", node);
      case "heading":
      case "title":
      case "header":
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5": {
        const level = /^h[1-5]$/.test(k) ? k : `h${Math.min(5, Math.max(1, Number(props.level) || (k === "title" ? 1 : 2)))}`;
        return this.text(label, level, node);
      }
      case "caption":
      case "badge":
      case "chip":
      case "tag":
      case "small":
        return this.text(label, "caption", node);
      case "image":
      case "img":
        return this.add(this.id(node, "image"), "Image", {
          url: bound(props.src ?? props.url) ?? { literalString: "" },
          altText: bound(props.alt ?? props.altText),
          fit: props.fit,
          usageHint: props.usageHint ?? props.size,
        }, weight);
      case "icon":
        return this.add(this.id(node, "icon"), "Icon", { name: bound(props.name ?? props.icon ?? label) ?? { literalString: "" } });
      case "video":
        return this.add(this.id(node, "video"), "Video", { url: bound(props.src ?? props.url) ?? { literalString: "" } });
      case "audio":
        return this.add(this.id(node, "audio"), "AudioPlayer", { url: bound(props.src ?? props.url) ?? { literalString: "" }, description: bound(props.description ?? props.title) });
      case "row":
      case "hstack":
      case "horizontal":
      case "inline":
      case "flexrow":
        return container("Row", layout);
      case "list":
        return container("List", { direction: props.direction ?? (props.horizontal ? "horizontal" : undefined), alignment: layout.alignment });
      case "card":
      case "panel": {
        const id = this.id(node, "card");
        const children = this.kids(node, props);
        if (props.title !== undefined && typeof props.title !== "object") children.unshift(this.text(props.title, "h3"));
        if (props.subtitle !== undefined) children.splice(props.title !== undefined ? 1 : 0, 0, this.text(props.subtitle, "caption"));
        const inner = children.length === 1 ? children[0] : this.add(this.id(null, "card-body"), "Column", { children: { explicitList: children } });
        return this.add(id, "Card", { child: inner }, weight);
      }
      case "divider":
      case "separator":
      case "hr":
        return this.add(this.id(node, "divider"), "Divider", { axis: props.axis ?? (props.vertical ? "vertical" : undefined) });
      case "button":
      case "link": {
        const id = this.id(node, "button");
        const child = this.text(props.label ?? props.text ?? props.title ?? (typeof node.children === "string" ? node.children : "OK"));
        const action =
          actionOf(props.action ?? props.onClick ?? props.onPress ?? props.onSelect) ??
          (k === "link" && (props.href || props.url) ? { name: "open_uri", context: [{ key: "uri", value: bound(props.href ?? props.url) }] } : { name: id });
        return this.add(id, "Button", { child, primary: props.primary === true || props.variant === "primary" || props.tone === "primary", action }, weight);
      }
      case "input":
      case "textfield":
      case "textinput":
      case "textarea":
      case "field": {
        const type = String(props.inputType ?? props.kind ?? props.variant ?? (k === "textarea" ? "longText" : "shortText"));
        const textFieldType = (
          { textarea: "longText", multiline: "longText", longtext: "longText", number: "number", date: "date", password: "obscured", obscured: "obscured" } as Record<string, string>
        )[type.toLowerCase()] ?? (props.multiline ? "longText" : "shortText");
        return this.add(this.id(node, "field"), "TextField", {
          label: bound(props.label ?? props.placeholder ?? props.name) ?? { literalString: "" },
          text: bound(props.value ?? props.bind ?? (props.name ? { path: `/${props.name}` } : undefined)),
          textFieldType,
          validationRegexp: props.pattern ?? props.validationRegexp,
        }, weight);
      }
      case "checkbox":
      case "switch":
      case "toggle":
        return this.add(this.id(node, "check"), "CheckBox", {
          label: bound(props.label ?? props.text) ?? { literalString: "" },
          value: bound(props.checked ?? props.value ?? (props.name ? { path: `/${props.name}` } : false), "boolean") ?? { literalBoolean: false },
        }, weight);
      case "select":
      case "dropdown":
      case "radio":
      case "radiogroup":
      case "multiselect":
      case "choice":
      case "choices": {
        const options = (Array.isArray(props.options) ? props.options : []).map((option) =>
          option && typeof option === "object"
            ? { label: bound((option as Record<string, unknown>).label ?? (option as Record<string, unknown>).value) ?? { literalString: "" }, value: String((option as Record<string, unknown>).value ?? (option as Record<string, unknown>).label ?? "") }
            : { label: { literalString: String(option) }, value: String(option) },
        );
        const multiple = k === "multiselect" || props.multiple === true;
        const value = props.value ?? props.selected ?? props.selections ?? (props.name ? { path: `/${props.name}` } : undefined);
        return this.add(this.id(node, "choice"), "MultipleChoice", {
          selections: Array.isArray(value) ? { literalArray: value.map(String) } : (bound(value) ?? { literalArray: [] }),
          options,
          maxAllowedSelections: multiple ? props.max : 1,
          variant: props.variant === "chips" || props.chips ? "chips" : undefined,
          filterable: props.filterable,
        }, weight);
      }
      case "slider":
      case "range":
        return this.add(this.id(node, "slider"), "Slider", {
          label: bound(props.label),
          value: bound(props.value ?? (props.name ? { path: `/${props.name}` } : 0), "number") ?? { literalNumber: 0 },
          minValue: props.min ?? props.minValue,
          maxValue: props.max ?? props.maxValue,
        }, weight);
      case "date":
      case "datetime":
      case "datepicker":
      case "time":
        return this.add(this.id(node, "date"), "DateTimeInput", {
          value: bound(props.value ?? (props.name ? { path: `/${props.name}` } : "")) ?? { literalString: "" },
          enableDate: k !== "time",
          enableTime: k === "datetime" || k === "time" || props.time === true,
        }, weight);
      case "tabs": {
        const id = this.id(node, "tabs");
        const source = Array.isArray(props.tabs) ? props.tabs : Array.isArray(props.items) ? props.items : Array.isArray(node.children) ? node.children : [];
        const tabItems = source
          .filter((tab): tab is Record<string, unknown> => !!tab && typeof tab === "object")
          .map((tab, index) => {
            const content = tab.children ?? tab.content ?? tab.body;
            let child: string;
            if (isNode(content)) child = this.node(content);
            else if (Array.isArray(content)) child = this.add(this.id(null, "tab"), "Column", { children: { explicitList: content.map((c) => (isNode(c) ? this.node(c) : this.text(c))) } });
            else if (content === undefined && isNode(tab) && kind(tab.type) !== "tab") child = this.node(tab);
            else child = this.text(content ?? "");
            return { title: bound(tab.title ?? tab.label ?? `Tab ${index + 1}`) ?? { literalString: "" }, child };
          });
        return this.add(id, "Tabs", { tabItems });
      }
      case "table": {
        return this.add(this.id(node, "table"), "Table", {
          columns: props.columns,
          rows: Array.isArray(props.rows) ? { literalJson: props.rows } : bound(props.rows ?? props.data),
        }, weight);
      }
      case "column":
      case "vstack":
      case "stack":
      case "container":
      case "section":
      case "form":
      case "box":
      case "view":
      case "div":
      case "group":
      case "page":
      case "flexcolumn":
      case "":
        return container("Column", layout);
      default: {
        // An extension component (an app's catalogue): its props as they are, children as a list.
        const id = this.id(node, k || "component");
        const children = Array.isArray(node.children) ? this.kids(node, props) : undefined;
        const { children: _children, ...rest } = props;
        return this.add(id, node.type, { ...rest, ...(children ? { children: { explicitList: children } } : {}) }, weight);
      }
    }
  }
}

/**
 * An Open-JSON-UI document as A2UI messages for one surface (`surfaceId`, default "main"): its
 * components, its data (as `valueJson` entries) and `beginRendering` with its root. Several top-level
 * nodes go in a column.
 */
export function openJsonUiToA2ui(input: unknown, surfaceId = DEFAULT_SURFACE): A2uiMessage[] {
  const doc = readOpenJsonUi(input);
  if (!doc) return [];
  const converter = new Converter();
  const ids = doc.nodes.map((node) => converter.node(node));
  let root = ids[0];
  if (ids.length !== 1) {
    root = "open-json-ui-root";
    converter.components.push({ id: root, component: { Column: { children: { explicitList: ids } } } });
  }
  const messages: A2uiMessage[] = [{ surfaceUpdate: { surfaceId, components: converter.components } }];
  if (Object.keys(doc.data).length) messages.push({ dataModelUpdate: { surfaceId, contents: objectToContents(doc.data) } });
  messages.push({ beginRendering: { surfaceId, root } });
  return messages;
}
