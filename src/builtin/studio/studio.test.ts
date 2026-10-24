import { describe, expect, test } from "bun:test";
import manifest from "./manifest.json";
import { parseManifest } from "../../apps/manifest";
import { buildA2uiState, parseA2ui } from "../../genui/a2ui";
import { coerceRecordValues, keyFromName, missingFields, pageDataModel } from "./models/studio";
import { buildAgentPrompt, userActionPrompt } from "./models/prompts";
import { sampleDocument } from "./models/samples";
import type { LiteAppTree, LiteEntityType, LiteRecord } from "./models/types";

const stamp = { user_id: "u", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z" };
const plant: LiteEntityType = {
  ...stamp,
  id: "t1",
  app_id: "a1",
  key: "plant",
  name: "Plant",
  plural_name: "Plants",
  icon_name: null,
  title_field: null,
  position: 0,
  fields: [
    { key: "name", type: "text", required: true },
    { key: "water_every", type: "integer" },
    { key: "indoor", type: "boolean" },
    { key: "tags", type: "multiselect", options: ["a", "b"] },
  ],
};
const app: LiteAppTree = {
  ...stamp,
  id: "a1",
  identifier: "abc",
  slug: "plants",
  name: "Plants",
  description: null,
  icon_name: null,
  hue: null,
  in_menu: true,
  menu_order: null,
  instructions: "Track my plants",
  builder_uri: null,
  soft_deleted_at: null,
  pages: [{ ...stamp, id: "p1", app_id: "a1", key: "list", title: "List", icon_name: null, position: 0, in_menu: true, format: "a2ui", document: [] }],
  types: [plant],
  relations: [],
};
const record: LiteRecord = { ...stamp, id: "r1", identifier: "r1i", slug: "fern", app_id: "a1", type_id: "t1", title: "Fern", data: { name: "Fern" }, soft_deleted_at: null };

describe("studio", () => {
  test("its manifest is valid, with a tool per function", () => {
    const parsed = parseManifest(manifest);
    expect(Object.keys(parsed.functions ?? {}).length).toBe(parsed.mcp?.tools?.length ?? 0);
  });

  test("a page's data model has the app, its types and records by type", () => {
    const data = pageDataModel(app, app.pages[0], [record]);
    const [fern] = (data.records as Record<string, Array<{ title: string; uri: string }>>).plant;
    expect(fern).toMatchObject({ title: "Fern", name: "Fern", key: "fern" });
    expect(fern.uri).toEndWith(":lite_record:r1");
    expect((data.page as { key: string }).key).toBe("list");
  });

  test("form values become typed record data, and required fields are checked", () => {
    const values = coerceRecordValues(plant, { name: "Fern", water_every: "3.7", indoor: "on", tags: "a, b" });
    expect(values).toEqual({ name: "Fern", water_every: 3, indoor: true, tags: ["a", "b"] });
    expect(missingFields(plant, { water_every: 3 }).map((f) => f.key)).toEqual(["name"]);
  });

  test("keys from names", () => {
    expect(keyFromName("Mina växter")).toBe("mina-vaxter");
    expect(keyFromName("Water every (days)", "_")).toBe("water_every_days");
    expect(keyFromName("3 rooms")).toBe("x-3-rooms");
  });

  test("the sample A2UI page renders the type's list and form", () => {
    const state = buildA2uiState(parseA2ui(sampleDocument("a2ui", app, "Plants")));
    const surface = state.main;
    expect(surface.root).toBe("root");
    expect(Object.values(surface.components).some((c) => "RecordList" in c.component)).toBe(true);
  });

  test("prompts carry the request and, when changing an app, the app", () => {
    expect(buildAgentPrompt({ request: "A plant tracker" })).toContain("A plant tracker");
    const change = buildAgentPrompt({ request: "Add a page", app });
    expect(change).toContain('"slug": "plants"');
    expect(change).toContain("Track my plants");
    expect(userActionPrompt(app, app.pages[0], { userAction: { name: "water" } })).toContain('"water"');
  });
});
