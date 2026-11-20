import { useMemo } from "react";
import { A2uiView, type A2uiActionHandler, type A2uiCatalog } from "./A2uiSurface";
import { parseA2ui, type A2uiMessage } from "./a2ui";
import { McpUiResource } from "./McpUiResource";
import { isUiResource, MCP_APP_MIME_TYPE, type UiActionHandler, type UiResourceContent } from "./mcpUi";
import { looksLikeOpenJsonUi, openJsonUiToA2ui } from "./openJsonUi";

/**
 * One way to render a generated UI in whichever of the formats gondol reads: A2UI messages, an
 * Open-JSON-UI tree or an MCP-UI resource (or plain HTML, as one). `format: "auto"` tells them
 * apart: a UI resource or a string starting with `<` is MCP-UI, A2UI messages are A2UI, and a
 * typed node tree is Open-JSON-UI.
 */

export type GenUiFormat = "a2ui" | "open_json_ui" | "mcp_ui";

export const GENUI_FORMATS: readonly GenUiFormat[] = ["a2ui", "open_json_ui", "mcp_ui"];

/** The format a document is in, or null when it's none of them. */
export function detectGenUiFormat(document: unknown): GenUiFormat | null {
  if (isUiResource(document)) return "mcp_ui";
  if (document && typeof document === "object" && typeof (document as { uri?: unknown }).uri === "string" && "mimeType" in (document as object)) return "mcp_ui";
  if (typeof document === "string" && document.trim().startsWith("<")) return "mcp_ui";
  if (parseA2ui(document).length) return "a2ui";
  if (looksLikeOpenJsonUi(document)) return "open_json_ui";
  return null;
}

/** A document's A2UI messages (Open-JSON-UI converted), for A2UI and Open-JSON-UI documents. */
export function genUiMessages(format: GenUiFormat, document: unknown): A2uiMessage[] {
  if (format === "a2ui") return parseA2ui(document);
  if (format === "open_json_ui") return openJsonUiToA2ui(document);
  return [];
}

/** An MCP-UI document as a resource: a UI resource, its content, or HTML (`url` for a web page). */
export function genUiResource(document: unknown, fallbackUri = "ui://gondol/view"): UiResourceContent | null {
  if (isUiResource(document)) return document.resource;
  if (document && typeof document === "object" && typeof (document as { uri?: unknown }).uri === "string") return document as UiResourceContent;
  if (typeof document === "string" && document.trim()) {
    const text = document.trim();
    if (/^https?:\/\/\S+$/i.test(text)) return { uri: fallbackUri, mimeType: "text/uri-list", text };
    return { uri: fallbackUri, mimeType: MCP_APP_MIME_TYPE, text };
  }
  return null;
}

export function GenerativeUi({
  format = "auto",
  document,
  data,
  catalog,
  onAction,
  onUiAction,
  renderData,
  title,
}: {
  format?: GenUiFormat | "auto";
  document: unknown;
  /** Merged into A2UI / Open-JSON-UI data models. */
  data?: Record<string, unknown>;
  catalog?: A2uiCatalog;
  /** A2UI user actions (A2UI and Open-JSON-UI). */
  onAction?: A2uiActionHandler;
  /** MCP-UI actions. */
  onUiAction?: UiActionHandler;
  /** What an MCP-UI view gets as render data (and as the tool result's structured content). */
  renderData?: Record<string, unknown> | null;
  title?: string;
}) {
  const resolved = format === "auto" ? detectGenUiFormat(document) : format;
  const messages = useMemo(() => (resolved && resolved !== "mcp_ui" ? genUiMessages(resolved, document) : []), [resolved, document]);
  const resource = useMemo(() => (resolved === "mcp_ui" ? genUiResource(document) : null), [resolved, document]);
  const toolResult = useMemo(
    () => (renderData ? { content: [{ type: "text", text: JSON.stringify(renderData) }], structuredContent: renderData } : undefined),
    [renderData],
  );

  if (!resolved) return <div className="genui-unknown">This isn't A2UI, Open-JSON-UI or MCP-UI.</div>;
  if (resolved === "mcp_ui") {
    if (!resource) return <div className="genui-unknown">Nothing to show</div>;
    return <McpUiResource resource={resource} onAction={onUiAction} renderData={renderData} toolResult={toolResult} title={title} catalog={catalog} onA2uiAction={onAction} />;
  }
  return <A2uiView messages={messages} data={data} catalog={catalog} onAction={onAction} />;
}
