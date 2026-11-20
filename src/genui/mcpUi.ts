/**
 * MCP-UI: UI resources an MCP server returns in a tool result (an embedded resource whose `uri`
 * starts with `ui://`), rendered by the host in a sandboxed iframe. `<McpUiResource/>`
 * (./McpUiResource.tsx) renders one and answers what it asks for, in both of MCP-UI's dialects:
 *
 * - MCP Apps (`text/html;profile=mcp-app`, the SEP that MCP-UI moved to): JSON-RPC 2.0 over
 *   postMessage. The view sends `ui/initialize` (the host answers with its info, capabilities and
 *   context: theme, display mode), then `ui/notifications/initialized`, after which the host sends
 *   `ui/notifications/tool-input` and `ui/notifications/tool-result`. The view may call `tools/call`,
 *   `ui/message` (a prompt), `ui/open-link`, and report `ui/notifications/size-changed`.
 * - The earlier MCP-UI messages (`text/html`, `text/uri-list`): `{type: "tool" | "prompt" | "link" |
 *   "intent" | "notify", messageId?, payload}`, answered with `ui-message-received` and
 *   `ui-message-response`; `ui-lifecycle-iframe-ready` gets `ui-lifecycle-iframe-render-data`, and
 *   `ui-size-change` resizes the frame.
 *
 * Remote DOM resources (`application/vnd.mcp-ui.remote-dom…`) aren't rendered (yet). gondol also
 * renders `application/a2ui+json` resources (A2UI messages, ./a2ui.ts) with its own components.
 */

export type UiResourceContent = {
  uri: string;
  mimeType?: string;
  text?: string;
  /** Base64. */
  blob?: string;
  _meta?: Record<string, unknown>;
};

/** An embedded UI resource, as it comes in a tool result's `content`. */
export type UiResource = { type: "resource"; resource: UiResourceContent };

/** What a view asks the host to do. */
export type UiAction =
  | { type: "tool"; payload: { toolName: string; params: Record<string, unknown> } }
  | { type: "prompt"; payload: { prompt: string } }
  | { type: "link"; payload: { url: string } }
  | { type: "intent"; payload: { intent: string; params: Record<string, unknown> } }
  | { type: "notify"; payload: { message: string } };

/** How the host answers an action: a tool's result, or nothing. A thrown error goes back as one. */
export type UiActionHandler = (action: UiAction) => unknown | Promise<unknown>;

export type UiResourceKind = "html" | "url" | "remote-dom" | "a2ui" | "unknown";

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
export const A2UI_MIME_TYPE = "application/a2ui+json";

/** Whether a tool result's content part is a UI resource. */
export function isUiResource(part: unknown): part is UiResource {
  if (!part || typeof part !== "object") return false;
  const value = part as { type?: unknown; resource?: { uri?: unknown } };
  return value.type === "resource" && typeof value.resource?.uri === "string" && value.resource.uri.startsWith("ui://");
}

/** The UI resources in a tool result (`content`), in order. */
export function uiResourcesOf(result: { content?: unknown } | null | undefined): UiResource[] {
  return Array.isArray(result?.content) ? result.content.filter(isUiResource) : [];
}

export function uiResourceKind(resource: UiResourceContent): UiResourceKind {
  const mime = (resource.mimeType ?? "").toLowerCase().replace(/\s/g, "");
  if (mime.startsWith("text/html")) return "html";
  if (mime.startsWith("text/uri-list")) return "url";
  if (mime.startsWith("application/vnd.mcp-ui.remote-dom")) return "remote-dom";
  if (mime === A2UI_MIME_TYPE || mime === "application/json+a2ui" || mime.includes("a2ui")) return "a2ui";
  return "unknown";
}

function decodeBase64(value: string): string {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

/** The resource's text: `text`, else its decoded `blob`. */
export function uiResourceText(resource: UiResourceContent): string {
  if (typeof resource.text === "string") return resource.text;
  if (typeof resource.blob === "string") return decodeBase64(resource.blob);
  return "";
}

/** A `text/uri-list` resource's address: its first line that isn't a comment, if it is http(s). */
export function uiResourceUrl(resource: UiResourceContent): string | null {
  const line = uiResourceText(resource)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  return line && /^https?:\/\//i.test(line) ? line : null;
}

/** MCP-UI's metadata (`mcpui.dev/ui-…` keys in `_meta`): a preferred frame size and initial render data. */
export function uiResourceMeta(resource: UiResourceContent): { size: [string, string] | null; renderData: Record<string, unknown> | null } {
  const meta = resource._meta ?? {};
  const size = meta["mcpui.dev/ui-preferred-frame-size"];
  const data = meta["mcpui.dev/ui-initial-render-data"];
  return {
    size: Array.isArray(size) && size.length === 2 ? [String(size[0]), String(size[1])] : null,
    renderData: data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null,
  };
}

/** A UI resource from HTML, as an MCP server (or an app of gondol's) would return it. */
export function htmlUiResource(uri: string, html: string, mimeType: string = MCP_APP_MIME_TYPE): UiResource {
  return { type: "resource", resource: { uri: uri.startsWith("ui://") ? uri : `ui://${uri}`, mimeType, text: html } };
}

/** A UI resource that shows a web page (`text/uri-list`). */
export function urlUiResource(uri: string, url: string): UiResource {
  return { type: "resource", resource: { uri: uri.startsWith("ui://") ? uri : `ui://${uri}`, mimeType: "text/uri-list", text: url } };
}

/**
 * What gondol puts at the start of an HTML view: the host's colours as CSS variables and a small
 * helper, `window.mcpUi`, so a view can be written without the postMessage plumbing:
 * `mcpUi.tool(name, params)` (a Promise of the result), `mcpUi.prompt(text)`, `mcpUi.link(url)`,
 * `mcpUi.notify(message)`, `mcpUi.data` (the render data) and `mcpUi.onData(fn)`. It reports the
 * view's height as it changes. Views that bring their own MCP Apps client keep working: this only
 * adds to the page.
 */
export function viewPrelude(theme: "light" | "dark", colors: Record<string, string>): string {
  const vars = Object.entries(colors)
    .map(([name, value]) => `--gondol-${name}:${value};`)
    .join("");
  const script = `(function(){var n=0,w={},d=null,fs=[];function send(m){parent.postMessage(m,"*")}
function req(type,payload){var id="g"+(++n);send({type:type,messageId:id,payload:payload});return new Promise(function(res,rej){w[id]={res:res,rej:rej}})}
addEventListener("message",function(e){var m=e.data;if(!m||typeof m!=="object")return;
if(m.type==="ui-message-response"&&w[m.messageId]){var p=m.payload||{};if(p.error)w[m.messageId].rej(p.error);else w[m.messageId].res(p.response);delete w[m.messageId]}
if(m.type==="ui-lifecycle-iframe-render-data"){d=(m.payload&&m.payload.renderData)||null;window.mcpUi.data=d;fs.forEach(function(f){try{f(d)}catch(x){}})}});
window.mcpUi={data:null,tool:function(t,p){return req("tool",{toolName:t,params:p||{}})},prompt:function(t){return req("prompt",{prompt:t})},
link:function(u){return req("link",{url:u})},intent:function(i,p){return req("intent",{intent:i,params:p||{}})},notify:function(t){return req("notify",{message:t})},
onData:function(f){fs.push(f);if(d)f(d)}};
function size(){send({type:"ui-size-change",payload:{height:Math.ceil(document.documentElement.scrollHeight)}})}
addEventListener("load",function(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.documentElement)});
send({type:"ui-lifecycle-iframe-ready"})})();`;
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${theme}"><style>:root{color-scheme:${theme};${vars}}html,body{margin:0;background:transparent;color:var(--gondol-fg,inherit);font-family:var(--gondol-font,system-ui,sans-serif)}</style><script>${script}</script>`;
}

/** The HTML a frame gets: the prelude, then the view (inside its `<head>` when it has one). */
export function withPrelude(html: string, prelude: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) return `${html.slice(0, head.index + head[0].length)}${prelude}${html.slice(head.index + head[0].length)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return `${doctype[0]}${prelude}${html.slice(doctype[0].length)}`;
  return `<!doctype html>${prelude}${html}`;
}
