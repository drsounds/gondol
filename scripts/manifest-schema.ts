// Regenerates src/apps/manifest.schema.json (the JSON Schema of an app's manifest.json, for
// editors) from the zod schema in src/apps/manifest.ts. Run with bun:
// `bun scripts/manifest-schema.ts`, or with `--check` to fail when it is out of date (CI).
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod/v4";
import { appManifestSchema } from "../src/apps/manifest";

const path = new URL("../src/apps/manifest.schema.json", import.meta.url).pathname;
const schema = {
  ...z.toJSONSchema(appManifestSchema, { io: "input" }),
  $id: "https://github.com/drsounds/gondol/blob/main/src/apps/manifest.schema.json",
  title: "gondol app manifest",
  description: "An app's manifest.json (gondol/apps/manifest.ts); defineApp validates it when the app loads.",
};
const next = `${JSON.stringify(schema, null, 2)}\n`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    // missing
  }
  if (current !== next) {
    console.error("src/apps/manifest.schema.json is out of date: run `bun run manifest-schema`.");
    process.exit(1);
  }
} else {
  writeFileSync(path, next);
}
