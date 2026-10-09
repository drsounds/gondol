// Regenerates package.json "exports" from src/: one subpath per module (gondol/entities/uri ->
// src/entities/uri.ts), plus every stylesheet and the design system's assets as they are.
// `node scripts/exports.mjs --check` fails when package.json is out of date (CI).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "src");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const exports = { ".": "./src/index.ts" };
for (const file of walk(src).sort()) {
  const rel = relative(src, file).split("\\").join("/");
  if (rel === "index.ts") continue;
  if (/\.(tsx?)$/.test(rel) && !rel.endsWith(".d.ts")) {
    const subpath = rel.replace(/\.(tsx?)$/, "").replace(/\/index$/, "");
    exports[`./${subpath}`] = `./src/${rel}`;
  }
}
exports["./styles/*"] = "./src/styles/*";
exports["./design-system/*"] = "./src/design-system/*";
exports["./assets/*"] = "./src/assets/*";
exports["./package.json"] = "./package.json";

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const next = JSON.stringify({ ...pkg, exports }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(pkgPath, "utf8") !== next) {
    console.error("package.json exports are out of date: run `bun run exports`.");
    process.exit(1);
  }
} else {
  writeFileSync(pkgPath, next);
}
