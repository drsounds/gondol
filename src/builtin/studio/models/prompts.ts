import type { LiteAppTree, LitePage } from "./types";

/**
 * What the studio sends an agent: the user's request, the app as it is now (when changing one) and
 * how to build it with the studio's tools (`studio__*` on the app router's /mcp; the formats are in
 * the studio manifest's MCP instructions, which the agent also reads).
 */

/** An app as an agent reads it: everything but the page documents' bulk and the bookkeeping. */
export function appSummary(app: LiteAppTree): Record<string, unknown> {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    instructions: app.instructions,
    in_menu: app.in_menu,
    pages: app.pages.map((page) => ({ key: page.key, title: page.title, format: page.format, in_menu: page.in_menu, position: page.position })),
    types: app.types.map((type) => ({ key: type.key, name: type.name, plural_name: type.plural_name, title_field: type.title_field, fields: type.fields })),
    relations: app.relations.map((relation) => ({
      key: relation.key,
      label: relation.label,
      from_type: app.types.find((type) => type.id === relation.from_type_id)?.key ?? null,
      to_type: relation.to_type_id ? (app.types.find((type) => type.id === relation.to_type_id)?.key ?? null) : null,
      to_entity_type: relation.to_entity_type,
      kind: relation.kind,
    })),
  };
}

const STEPS = [
  "Build it with the App Studio tools (studio__save_app, studio__save_entity_type, studio__save_relation, studio__save_page; studio__get_app reads an app back).",
  "Give the app entity types for the things it keeps, with typed fields, and relations between them (or to any other entity type).",
  "Make one page per view, in A2UI (preferred), Open-JSON-UI or MCP-UI HTML. A list page (RecordList) and a form (RecordForm or TextFields with a create_record button) are a good start.",
  "Keep pages in the main menu unless they are details reached from another page.",
  "When you're done, answer with a short summary of what you built.",
];

/** The request to build a new app, or (with `app`) to change one. */
export function buildAgentPrompt({ request, app }: { request: string; app?: LiteAppTree | null }): string {
  const parts = [app ? `Please change my App Studio app "${app.name}" (id ${app.id}).` : "Please build me a new app in the App Studio.", "", request.trim(), ""];
  if (app) parts.push("The app as it is now:", "```json", JSON.stringify(appSummary(app), null, 2), "```", "");
  if (app?.instructions?.trim()) parts.push(`What the app is for: ${app.instructions.trim()}`, "");
  parts.push(...STEPS.map((step) => `- ${step}`));
  if (!app) parts.push("- Set yourself as the app's builder (builder_uri) so the actions its pages don't run themselves come to you.");
  return parts.join("\n");
}

/** A user's action on a page that the app doesn't run itself, for the agent that built it. */
export function userActionPrompt(app: LiteAppTree, page: LitePage, action: unknown): string {
  return [
    `A user acted on the page "${page.title}" (${page.key}) of the App Studio app "${app.name}" (id ${app.id}), and the app doesn't handle it itself:`,
    "```json",
    JSON.stringify(action, null, 2),
    "```",
    "Do what the action asks with the tools you have (the app's records are studio__list_records / studio__save_record), and change the app if it should handle this itself.",
  ].join("\n");
}
