# Generative UI

Gondol renders user interfaces that a language model, an MCP server or a stored document describes,
in three formats (`src/genui`):

| Format | What it is | Rendered by |
| --- | --- | --- |
| **A2UI** (`a2ui`) | Google's Agent-to-UI protocol, v0.8: a stream of JSON messages (`surfaceUpdate`, `dataModelUpdate`, `beginRendering`, `deleteSurface`) describing a flat list of components and a data model. | `A2uiView` / `A2uiSurfaceView` |
| **Open-JSON-UI** (`open_json_ui`) | A nested `{type, props, children}` tree. | Converted to A2UI (`openJsonUiToA2ui`), then `A2uiView` |
| **MCP-UI** (`mcp_ui`) | MCP-UI / MCP Apps UI resources: `{type: "resource", resource: {uri: "ui://…", mimeType, text \| blob}}` with HTML (`text/html`, `text/html;profile=mcp-app`) or a URL (`text/uri-list`). | `McpUiResource`, in a sandboxed iframe |

`GenerativeUi` takes any of them (`format="auto"` detects which) and is what apps usually render.

## A2UI

```tsx
import { A2uiView } from "gondol/genui/A2uiSurface";

<A2uiView messages={messages} data={{ trip: { nights: 5 } }} onAction={(action) => …} />;
```

- Every standard component: Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs,
  Divider, Modal, Button, CheckBox, TextField, DateTimeInput, MultipleChoice and Slider, plus a
  `Table` (`columns: [{key, label}]`, `rows` bound to a list).
- Values are literals or data bindings (`{path: "/trip/nights"}`); a path with a literal sets the
  value first. Lists repeat a `template` over the items at a path, with paths relative to the item.
- Inputs write back to the surface's data model, and a Button sends a `userAction`
  (`{name, surfaceId, sourceComponentId, timestamp, context}`) to `onAction`.
- `catalog` adds components of your own (`A2uiCatalog`): the studio app adds `RecordList` and
  `RecordForm`. Unknown components show a small notice instead of failing.
- Gondol merges a `dataModelUpdate` into what is at its path (the root included) rather than
  replacing it, so a model can send its data in parts. `valueJson` is accepted next to the
  standard `valueString`/`valueNumber`/`valueBoolean`/`valueMap`.

## Open-JSON-UI

There is no published schema, so `readOpenJsonUi` reads generously: an envelope
(`{type: "open-json-ui", spec | root | component | ui | components, data}`), a bare node or a list of
nodes. Node types map to A2UI components (`text`, `heading`, `caption`, `badge`, `image`, `icon`,
`video`, `audio`, `row`, `column`/`stack`, `list`, `card`, `divider`, `button`, `input`/`textfield`,
`textarea`, `checkbox`, `select`, `multiselect`, `slider`, `date`, `datetime`, `tabs`, `table`); other
types are passed through as components of the same name, so a catalogue can answer them.

## MCP-UI and MCP Apps

```tsx
import { McpUiResource } from "gondol/genui/McpUiResource";

<McpUiResource resource={resource} toolName="weather__forecast" toolResult={result} onAction={handle} />;
```

- HTML views run in an iframe sandboxed with `allow-scripts allow-forms allow-popups` and never
  `allow-same-origin`, so they can't read the app's cookies, storage or DOM.
- Both dialects are spoken: MCP Apps' JSON-RPC (`ui/initialize`, `tools/call`, `ui/message`,
  `ui/open-link`, `ui/notifications/tool-input`, `tool-result`, `size-changed`) and the earlier
  MCP-UI messages (`tool`, `prompt`, `link`, `intent`, `notify`, `ui-lifecycle-iframe-ready`,
  `ui-size-change`). Actions arrive at `onAction` as `UiAction`s; return a value (or a Promise) to
  answer a tool call.
- Gondol adds a prelude to the view: the host's colours as CSS variables (`--gondol-fg`, `-bg`,
  `-surface`, `-muted`, `-border`, `-accent`, `-accent-contrast`) and `window.mcpUi`
  (`tool(name, params)`, `prompt(text)`, `link(url)`, `intent(name, params)`, `notify(text)`, `data`
  and `onData(fn)`), so a view needs no postMessage plumbing.
- `text/uri-list` resources load the URL (http and https only). Remote DOM resources aren't
  supported yet and show a notice.

## In the AI chat

The ai app's answers render generative UI in two ways:

- A fenced code block in `a2ui`, `open-json-ui` or `mcp-ui` (or `json`/`jsonl` that reads as A2UI
  or Open-JSON-UI) renders as the UI. A user action is sent back as the user's next message.
- A tool result with UI resources (an MCP server's, or an app's) shows them under the answer (at
  most four per answer). The model gets a short note instead of the resource. Tool calls from a
  view ask first, like the model's own, for tools that change something.
