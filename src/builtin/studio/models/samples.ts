import type { Json } from "../../../supabase/types";
import type { GenUiFormat } from "../../../genui/GenerativeUi";
import type { LiteAppTree } from "./types";

/**
 * A page to start from in each format: a heading and, when the app has an entity type, the list of
 * its records and a form to add one.
 */
export function sampleDocument(format: GenUiFormat, app: Pick<LiteAppTree, "name" | "types">, title: string): Json {
  const type = app.types[0];
  const heading = title || app.name;
  switch (format) {
    case "a2ui": {
      const components: Json[] = [
        { id: "root", component: { Column: { children: { explicitList: type ? ["title", "list", "form"] : ["title", "intro"] } } } },
        { id: "title", component: { Text: { usageHint: "h2", text: { literalString: heading } } } },
      ];
      if (type) {
        components.push(
          { id: "list", component: { RecordList: { type: { literalString: type.key } } } },
          { id: "form", component: { Card: { child: "form-body" } } },
          { id: "form-body", component: { RecordForm: { type: { literalString: type.key } } } },
        );
      } else {
        components.push({ id: "intro", component: { Text: { text: { path: "/app/description" } } } });
      }
      return [{ surfaceUpdate: { surfaceId: "main", components } }, { beginRendering: { surfaceId: "main", root: "root" } }];
    }
    case "open_json_ui":
      return {
        type: "column",
        children: [
          { type: "heading", props: { text: heading } },
          type ? { type: "RecordList", props: { type: type.key } } : { type: "text", props: { text: { path: "/app/description" } } },
          ...(type ? [{ type: "card", children: [{ type: "RecordForm", props: { type: type.key } }] }] : []),
        ],
      };
    case "mcp_ui":
      return [
        "<!doctype html>",
        "<html><body style=\"font-family: system-ui; margin: 16px\">",
        `<h2>${heading.replace(/[<&]/g, "")}</h2>`,
        "<ul id=\"list\"></ul>",
        "<script>",
        "window.mcpUi.onData((data) => {",
        "  const list = document.getElementById('list');",
        "  list.innerHTML = '';",
        "  for (const records of Object.values(data.records || {}))",
        "    for (const record of records) list.append(Object.assign(document.createElement('li'), { textContent: record.title }));",
        "});",
        "</script>",
        "</body></html>",
      ].join("\n");
  }
}
