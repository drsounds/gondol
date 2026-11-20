import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { A2uiView, type A2uiActionHandler, type A2uiCatalog } from "./A2uiSurface";
import { parseA2ui } from "./a2ui";
import {
  uiResourceKind,
  uiResourceMeta,
  uiResourceText,
  uiResourceUrl,
  viewPrelude,
  withPrelude,
  type UiAction,
  type UiActionHandler,
  type UiResourceContent,
} from "./mcpUi";

/**
 * Renders an MCP-UI resource (./mcpUi.ts) and answers what its view asks for. HTML runs in an iframe
 * sandboxed without `allow-same-origin`, so it can't reach the app, its storage or its session;
 * a `text/uri-list` page loads in a frame of its own origin. Only messages from the frame's own
 * window are read.
 *
 * `onAction` decides what a tool call, prompt, link, intent or notification does; a tool call's
 * answer (or error) goes back to the view. `toolInput`/`toolResult` are what the view was made for
 * (MCP Apps' `ui/notifications/tool-input` and `tool-result`), `renderData` what the earlier
 * dialect's views get with `ui-lifecycle-iframe-render-data` (and `mcpUi.data`).
 */

const SANDBOX_HTML = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
const SANDBOX_URL = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";
const MCP_APPS_PROTOCOL = "2025-11-21";
const MAX_HEIGHT = 2400;

type Rpc = { jsonrpc: "2.0"; id?: string | number; method?: string; params?: Record<string, unknown> };

/** The host's colours where the frame sits (so it follows a fixed-dark preview pane too). */
function useHostColors(ref: React.RefObject<HTMLElement | null>) {
  // Null until measured, so the frame loads once, with the right colours.
  const [colors, setColors] = useState<{ theme: "light" | "dark"; vars: Record<string, string> } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof getComputedStyle === "undefined") return;
    const style = getComputedStyle(element);
    const read = (name: string) => style.getPropertyValue(`--bungalow-color-${name}`).trim();
    const vars: Record<string, string> = {};
    for (const [key, token] of [
      ["fg", "ink"],
      ["bg", "canvas"],
      ["surface", "surface"],
      ["muted", "muted"],
      ["border", "border"],
      ["accent", "primary"],
      ["accent-contrast", "primary-contrast"],
      ["danger", "danger"],
    ] as const) {
      const value = read(token);
      if (value) vars[key] = value;
    }
    // Light or dark from the canvas's luminance, read as the browser resolves it.
    const probe = document.createElement("span");
    probe.style.color = "var(--bungalow-color-canvas)";
    element.appendChild(probe);
    const match = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(getComputedStyle(probe).color);
    probe.remove();
    const luminance = match ? (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255 : 1;
    setColors({ theme: luminance < 0.5 ? "dark" : "light", vars });
  }, [ref]);
  return colors;
}

export function McpUiResource({
  resource,
  onAction,
  toolName,
  toolInput,
  toolResult,
  renderData,
  title,
  catalog,
  onA2uiAction,
  minHeight = 120,
}: {
  resource: UiResourceContent;
  onAction?: UiActionHandler;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  renderData?: Record<string, unknown> | null;
  title?: string;
  /** For `application/a2ui+json` resources. */
  catalog?: A2uiCatalog;
  onA2uiAction?: A2uiActionHandler;
  minHeight?: number;
}) {
  const kind = uiResourceKind(resource);
  const holder = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const measured = useHostColors(holder);
  const colors = measured ?? { theme: "light" as const, vars: {} };
  const meta = useMemo(() => uiResourceMeta(resource), [resource]);
  const [height, setHeight] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ onAction, toolInput, toolResult, renderData, toolName, theme: colors.theme });
  latest.current = { onAction, toolInput, toolResult, renderData, toolName, theme: colors.theme };

  const srcDoc = useMemo(() => {
    if (kind !== "html" || !measured) return undefined;
    return withPrelude(uiResourceText(resource), viewPrelude(colors.theme, colors.vars));
  }, [kind, resource, measured]);
  const src = kind === "url" ? uiResourceUrl(resource) : null;

  useEffect(() => {
    if (kind !== "html" && kind !== "url") return;
    const post = (message: unknown) => frame.current?.contentWindow?.postMessage(message, "*");
    const renderPayload = () => ({ renderData: latest.current.renderData ?? meta.renderData ?? null, toolInput: latest.current.toolInput ?? null, toolOutput: latest.current.toolResult ?? null });
    const act = async (action: UiAction): Promise<unknown> => {
      if (!latest.current.onAction) {
        if (action.type === "link") window.open(action.payload.url, "_blank", "noopener,noreferrer");
        else if (action.type === "notify") setNotice(action.payload.message);
        return undefined;
      }
      return latest.current.onAction(action);
    };

    const onMessage = async (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;

      // MCP Apps: JSON-RPC 2.0.
      if (data.jsonrpc === "2.0" && typeof data.method === "string") {
        const rpc = data as Rpc;
        const params = (rpc.params ?? {}) as Record<string, unknown>;
        const reply = (result: unknown) => (rpc.id !== undefined ? post({ jsonrpc: "2.0", id: rpc.id, result: result ?? {} }) : undefined);
        const fail = (message: string, code = -32603) => (rpc.id !== undefined ? post({ jsonrpc: "2.0", id: rpc.id, error: { code, message } }) : undefined);
        try {
          switch (rpc.method) {
            case "ui/initialize":
              return reply({
                protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_APPS_PROTOCOL,
                hostInfo: { name: "gondol", version: "1.0.0" },
                hostCapabilities: { openLinks: {}, serverTools: {}, logging: {} },
                hostContext: { theme: latest.current.theme, displayMode: "inline", availableDisplayModes: ["inline"], toolInfo: latest.current.toolName ? { tool: { name: latest.current.toolName } } : undefined },
              });
            case "ui/notifications/initialized":
              if (latest.current.toolInput) post({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: latest.current.toolInput } });
              if (latest.current.toolResult !== undefined) post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: latest.current.toolResult });
              return;
            case "ui/notifications/size-changed":
              if (typeof params.height === "number") setHeight(Math.min(MAX_HEIGHT, Math.max(minHeight, Math.ceil(params.height))));
              return;
            case "tools/call":
              return reply(await act({ type: "tool", payload: { toolName: String(params.name ?? ""), params: (params.arguments as Record<string, unknown>) ?? {} } }));
            case "ui/message": {
              const content = Array.isArray(params.content) ? params.content : [];
              const text = content
                .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
                .filter(Boolean)
                .join("\n");
              await act({ type: "prompt", payload: { prompt: text } });
              return reply({});
            }
            case "ui/open-link":
              await act({ type: "link", payload: { url: String(params.url ?? "") } });
              return reply({});
            case "notifications/message":
              return;
            case "ping":
              return reply({});
            default:
              return fail(`The host doesn't do ${rpc.method}`, -32601);
          }
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      }

      // MCP-UI's earlier messages.
      const type = data.type;
      const messageId = typeof data.messageId === "string" ? data.messageId : undefined;
      const payload = (data.payload ?? {}) as Record<string, unknown>;
      if (type === "ui-lifecycle-iframe-ready") {
        post({ type: "ui-lifecycle-iframe-render-data", payload: renderPayload() });
        return;
      }
      if (type === "ui-size-change") {
        if (typeof payload.height === "number") setHeight(Math.min(MAX_HEIGHT, Math.max(minHeight, Math.ceil(payload.height))));
        return;
      }
      if (type === "ui-request-render-data") {
        post({ type: "ui-lifecycle-iframe-render-data", messageId, payload: renderPayload() });
        return;
      }
      if (type === "tool" || type === "prompt" || type === "link" || type === "intent" || type === "notify") {
        if (messageId) post({ type: "ui-message-received", messageId });
        try {
          const response = await act({ type, payload } as UiAction);
          if (messageId) post({ type: "ui-message-response", messageId, payload: { response } });
        } catch (error) {
          if (messageId) post({ type: "ui-message-response", messageId, payload: { error: error instanceof Error ? error.message : String(error) } });
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [kind, meta, minHeight]);

  // A new result or input for a view that's already running.
  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (!target) return;
    if (toolResult !== undefined) target.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: toolResult }, "*");
    if (renderData) target.postMessage({ type: "ui-lifecycle-iframe-render-data", payload: { renderData } }, "*");
  }, [toolResult, renderData]);

  if (kind === "a2ui") {
    return (
      <div ref={holder} className="genui-resource">
        <A2uiView messages={parseA2ui(uiResourceText(resource))} catalog={catalog} onAction={onA2uiAction} data={renderData ?? undefined} />
      </div>
    );
  }
  if (kind === "remote-dom" || kind === "unknown" || (kind === "url" && !src)) {
    return (
      <div ref={holder} className="genui-resource genui-unknown">
        {kind === "remote-dom" ? "This view uses Remote DOM, which isn't supported here yet." : `Can't show ${resource.mimeType ?? "this resource"}.`}
      </div>
    );
  }
  const preferred = meta.size;
  return (
    <div ref={holder} className="genui-resource">
      {kind === "html" && !srcDoc ? null : (
      <iframe
        ref={frame}
        className="genui-frame"
        title={title ?? resource.uri}
        sandbox={kind === "url" ? SANDBOX_URL : SANDBOX_HTML}
        srcDoc={srcDoc}
        src={src ?? undefined}
        referrerPolicy="no-referrer"
        style={{ height: height ?? (preferred ? preferred[1] : 360), width: preferred ? preferred[0] : "100%" }}
      />
      )}
      {notice ? <div className="genui-resource__notice">{notice}</div> : null}
    </div>
  );
}
