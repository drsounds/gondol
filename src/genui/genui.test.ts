import { describe, expect, test } from "bun:test";
import { buildA2uiState, childrenOf, getAt, parseA2ui, resolveContext, resolvePath, resolveText, setAt, type A2uiMessage } from "./a2ui";
import { openJsonUiToA2ui, readOpenJsonUi } from "./openJsonUi";
import { isUiResource, uiResourceKind, uiResourceText, uiResourceUrl, uiResourcesOf, withPrelude } from "./mcpUi";

const restaurant: A2uiMessage[] = [
  {
    surfaceUpdate: {
      surfaceId: "s",
      components: [
        { id: "root", component: { Column: { children: { explicitList: ["title", "list"] } } } },
        { id: "title", component: { Text: { text: { literalString: "Places" }, usageHint: "h1" } } },
        { id: "list", component: { List: { children: { template: { componentId: "item", dataBinding: "/places" } } } } },
        { id: "item", component: { Text: { text: { path: "name" } } } },
        { id: "name-field", component: { TextField: { label: { literalString: "Name" }, text: { path: "/form/name", literalString: "Guest" } } } },
      ],
    },
  },
  {
    dataModelUpdate: {
      surfaceId: "s",
      contents: [{ key: "places", valueMap: [{ key: "a", valueMap: [{ key: "name", valueString: "Akkurat" }] }] }],
    },
  },
  { beginRendering: { surfaceId: "s", root: "root" } },
];

describe("A2UI", () => {
  test("paths resolve against a template's item", () => {
    expect(resolvePath("name", "/places/a")).toBe("/places/a/name");
    expect(resolvePath("../b/name", "/places/a")).toBe("/places/b/name");
    expect(resolvePath("/x", "/places/a")).toBe("/x");
  });

  test("set and get keep lists as lists", () => {
    const data = setAt({ list: [{ n: 1 }, { n: 2 }] }, "/list/1/n", 3);
    expect(getAt(data, "/list/1/n")).toBe(3);
    expect(Array.isArray(data.list)).toBe(true);
  });

  test("messages build a surface with its root, data and initialized bindings", () => {
    const state = buildA2uiState(restaurant);
    expect(state.s.root).toBe("root");
    expect(getAt(state.s.data, "/places/a/name")).toBe("Akkurat");
    // Path + literal initializes the data model.
    expect(getAt(state.s.data, "/form/name")).toBe("Guest");
  });

  test("templates repeat over maps and lists with item scopes", () => {
    const state = buildA2uiState(restaurant);
    const items = childrenOf({ template: { componentId: "item", dataBinding: "/places" } }, state.s.data);
    expect(items).toEqual([{ id: "item", key: "item@a", scope: "/places/a" }]);
    expect(resolveText({ path: "name" }, state.s.data, items[0].scope)).toBe("Akkurat");
    const list = childrenOf({ template: { componentId: "item", dataBinding: "/rows" } }, { rows: [{ name: "x" }, { name: "y" }] });
    expect(list.map((i) => i.scope)).toEqual(["/rows/0", "/rows/1"]);
  });

  test("an action's context is resolved", () => {
    const context = resolveContext(
      [
        { key: "name", value: { path: "/form/name" } },
        { key: "count", value: { literalNumber: 2 } },
      ],
      { form: { name: "Ada" } },
    );
    expect(context).toEqual({ name: "Ada", count: 2 });
  });

  test("parsing takes lists, one message, {messages} and JSON Lines", () => {
    expect(parseA2ui(restaurant)).toHaveLength(3);
    expect(parseA2ui({ messages: restaurant })).toHaveLength(3);
    expect(parseA2ui(restaurant.map((m) => JSON.stringify(m)).join("\n"))).toHaveLength(3);
    expect(parseA2ui({ type: "card" })).toHaveLength(0);
    expect(parseA2ui("not json")).toHaveLength(0);
  });

  test("a surface without beginRendering renders from `root`", () => {
    const state = buildA2uiState([restaurant[0]]);
    expect(state.s.root).toBe("root");
  });

  test("deleteSurface removes it", () => {
    const state = buildA2uiState([...restaurant, { deleteSurface: { surfaceId: "s" } }]);
    expect(state.s).toBeUndefined();
  });
});

describe("Open-JSON-UI", () => {
  const doc = {
    type: "open-json-ui",
    version: "1.0",
    data: { todos: [{ title: "Milk" }] },
    spec: {
      type: "card",
      title: "Todo",
      children: [
        { type: "input", label: "New", name: "draft" },
        { type: "button", label: "Add", variant: "primary", action: { name: "add", context: { title: { path: "/draft" } } } },
        { type: "list", items: { path: "/todos" }, template: { type: "text", text: { path: "title" } } },
      ],
    },
  };

  test("envelopes and bare trees read", () => {
    expect(readOpenJsonUi(doc)?.nodes).toHaveLength(1);
    expect(readOpenJsonUi({ type: "text", text: "hi" })?.nodes[0].type).toBe("text");
    expect(readOpenJsonUi([{ type: "text" }, { type: "divider" }])?.nodes).toHaveLength(2);
    expect(readOpenJsonUi({ type: "open-json-ui" })).toBeNull();
    expect(readOpenJsonUi(42)).toBeNull();
  });

  test("it converts to A2UI that renders the same", () => {
    const messages = openJsonUiToA2ui(doc);
    const state = buildA2uiState(messages);
    const surface = state.main;
    expect(surface.root).toBeTruthy();
    const types = Object.values(surface.components).map((c) => Object.keys(c.component)[0]);
    expect(types).toContain("Card");
    expect(types).toContain("TextField");
    expect(types).toContain("Button");
    expect(types).toContain("List");
    const button = Object.values(surface.components).find((c) => "Button" in c.component)!;
    expect((button.component.Button.action as { name: string }).name).toBe("add");
    expect(resolveContext(button.component.Button.action && (button.component.Button.action as { context: unknown }).context, { draft: "Bread" })).toEqual({ title: "Bread" });
    expect(getAt(surface.data, "/todos/0/title")).toBe("Milk");
  });

  test("unknown types pass through as extension components", () => {
    const state = buildA2uiState(openJsonUiToA2ui({ type: "EntityList", entityType: "recipe" }));
    const only = Object.values(state.main.components)[0];
    expect(only.component.EntityList).toEqual({ entityType: "recipe" });
  });
});

describe("MCP-UI", () => {
  const html = { type: "resource", resource: { uri: "ui://hello/1", mimeType: "text/html;profile=mcp-app", text: "<p>Hi</p>" } };
  const blob = { type: "resource", resource: { uri: "ui://hello/2", mimeType: "text/html", blob: btoa("<b>B</b>") } };
  const url = { type: "resource", resource: { uri: "ui://site/1", mimeType: "text/uri-list", text: "# comment\nhttps://example.com/x" } };

  test("finds UI resources in a tool result", () => {
    expect(isUiResource(html)).toBe(true);
    expect(isUiResource({ type: "resource", resource: { uri: "file:///x" } })).toBe(false);
    expect(uiResourcesOf({ content: [{ type: "text", text: "x" }, html, url] })).toHaveLength(2);
  });

  test("reads kinds, text, blobs and uri lists", () => {
    expect(uiResourceKind(html.resource)).toBe("html");
    expect(uiResourceKind(url.resource)).toBe("url");
    expect(uiResourceKind({ uri: "ui://x", mimeType: "application/vnd.mcp-ui.remote-dom+javascript; framework=react" })).toBe("remote-dom");
    expect(uiResourceText(blob.resource)).toBe("<b>B</b>");
    expect(uiResourceUrl(url.resource)).toBe("https://example.com/x");
    expect(uiResourceUrl({ uri: "ui://x", mimeType: "text/uri-list", text: "javascript:alert(1)" })).toBeNull();
  });

  test("the prelude goes in the head, or before the page", () => {
    expect(withPrelude("<html><head><title>x</title></head></html>", "<!--p-->")).toBe("<html><head><!--p--><title>x</title></head></html>");
    expect(withPrelude("<!doctype html><p>x</p>", "<!--p-->")).toBe("<!doctype html><!--p--><p>x</p>");
    expect(withPrelude("<p>x</p>", "<!--p-->")).toBe("<!doctype html><!--p--><p>x</p>");
  });
});
