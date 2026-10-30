import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createGondolSystem } from "../apps/remote/system";
import { parseArgs } from "./cli.mjs";
import { buildAppPackage } from "./build.mjs";
import { secretFor, startAppsRuntime } from "./server.mjs";
import { isSharedSpecifier, scanExports, shimSource, stripCommentsAndStrings } from "../vite/remoteApp.mjs";

const repo = resolve(import.meta.dir, "../..");
const example = join(repo, "examples/remote-hello");

/** The example app in a folder of its own, with node_modules pointing at this checkout. */
function exampleCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "gondol-remote-"));
  cpSync(example, dir, { recursive: true, filter: (path) => !path.includes("node_modules") && !path.includes("/dist") });
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(repo, join(dir, "node_modules/gondol"));
  for (const name of ["react", "react-dom", "@tanstack", "vite", "scheduler"]) {
    if (existsSync(join(repo, "node_modules", name))) symlinkSync(join(repo, "node_modules", name), join(dir, "node_modules", name));
  }
  return dir;
}

describe("the build plugin", () => {
  test("knows what the host shares", () => {
    expect(isSharedSpecifier("react")).toBe(true);
    expect(isSharedSpecifier("react/jsx-runtime")).toBe(true);
    expect(isSharedSpecifier("gondol/entities/EntitySheet")).toBe(true);
    expect(isSharedSpecifier("gondol/builtin/library/models")).toBe(true);
    expect(isSharedSpecifier("gondol/builtin/library")).toBe(false);
    expect(isSharedSpecifier("gondol/vite/apps")).toBe(false);
    expect(isSharedSpecifier("gondol/runtime/server")).toBe(false);
    expect(isSharedSpecifier("gondol/apps/manifest.schema.json")).toBe(false);
    expect(isSharedSpecifier("gondol/styles/base.css")).toBe(true);
    expect(isSharedSpecifier("lodash")).toBe(false);
    expect(isSharedSpecifier("@acme/models", ["@acme/models"])).toBe(true);
  });

  test("finds a module's exports, not the ones in comments, strings or types", () => {
    const dir = mkdtempSync(join(tmpdir(), "gondol-scan-"));
    writeFileSync(
      join(dir, "a.ts"),
      [
        "// export const notMe = 1;",
        "/* export function norMe() {} */",
        "const example = `export const inTemplate = 1`;",
        "const re = /`[\"']/g;",
        "export const one = 1, ignored = 2;",
        "export async function two() {}",
        "export function* three() {}",
        "export class Four {}",
        "export type Five = string;",
        "export interface Six {}",
        "export enum Seven { A }",
        "const eight = 8, nine = 9;",
        "export { eight, nine as Nine, type Ten };",
        "export type { Eleven } from './b';",
        "export * from './b';",
        "export * as bee from './b';",
        "export default one;",
      ].join("\n"),
    );
    writeFileSync(join(dir, "b.ts"), "export const fromB = 1;\nexport default 2;\n");
    expect([...scanExports(join(dir, "a.ts"))].sort()).toEqual(["Four", "Nine", "Seven", "bee", "default", "eight", "fromB", "one", "three", "two"]);
    expect(stripCommentsAndStrings("a / b; // c")).toBe("a / b; ");
    rmSync(dir, { recursive: true });
  });

  test("scans gondol's own modules as they really are", async () => {
    for (const path of ["apps/defineApp.ts", "apps/registry.ts", "entities/uri.ts", "apps/contributions.ts", "sites/capabilities.ts"]) {
      const file = join(repo, "src", path);
      const actual = Object.keys(await import(file)).sort();
      expect([...scanExports(file)].sort()).toEqual(actual);
    }
  });

  test("a shim takes every export from the host", () => {
    const code = shimSource("react", new Set(["default", "useState"]));
    expect(code).toContain('await g.import("react")');
    expect(code).toContain("export default m.default;");
    expect(code).toContain('export const useState = m["useState"];');
  });
});

describe("the CLI", () => {
  test("parses its arguments", () => {
    expect(parseArgs(["dev", "apps", "--port", "5181"])).toEqual({ command: "dev", paths: ["apps"], port: 5181, host: undefined });
    expect(parseArgs(["serve", "--host=0.0.0.0"])).toEqual({ command: "serve", paths: ["."], port: undefined, host: "0.0.0.0" });
  });

  test("secrets per app, else for the runtime", () => {
    expect(secretFor("my-app", { GONDOL_APP_SECRET_MY_APP: "a", GONDOL_APPS_SECRET: "b" })).toBe("a");
    expect(secretFor("other", { GONDOL_APPS_SECRET: "b" })).toBe("b");
    expect(secretFor("other", {})).toBeNull();
  });
});

describe("building and serving an app", () => {
  let dir: string;
  let runtime: Awaited<ReturnType<typeof startAppsRuntime>>;
  const quiet = { error: () => undefined };

  beforeAll(async () => {
    dir = exampleCopy();
    await buildAppPackage(dir, { logLevel: "silent" });
    runtime = await startAppsRuntime({ paths: [dir], port: 0, host: "127.0.0.1", env: { GONDOL_APPS_SECRET: "s3cret" }, log: quiet });
  }, 120_000);

  afterAll(async () => {
    await runtime?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("the build is ES modules with no bare imports left", () => {
    const chunkDir = join(dir, "dist/chunks");
    const chunks = [join(dir, "dist/client.mjs"), ...readdirSync(chunkDir).filter((f) => f.endsWith(".mjs")).map((f) => join(chunkDir, f))]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(chunks).not.toMatch(/from\s*["'](react|gondol)[/"']/);
    expect(chunks).toContain("GondolSystem");
    expect(existsSync(join(dir, "dist/server.mjs"))).toBe(true);
    expect(existsSync(join(dir, "dist/client.css"))).toBe(true);
  });

  test("the built client runs against the host's modules", async () => {
    const asked: string[] = [];
    const system = createGondolSystem({
      react: () => import("react"),
      "react/jsx-runtime": () => import("react/jsx-runtime"),
      "gondol/apps/defineApp": () => import("../apps/defineApp"),
      "gondol/api/client": () => import("../api/client"),
    });
    globalThis.GondolSystem = { ...system, import: (specifier: string) => (asked.push(specifier), system.import(specifier)) };
    const module = await import(pathToFileURL(join(dir, "dist/client.mjs")).href);
    expect(module.default.id).toBe("hello");
    expect(module.default.isInternal).toBe(true);
    expect(module.default.features.map((f: { path: string }) => f.path)).toEqual(["hello"]);
    expect(asked).toContain("gondol/apps/defineApp");
    globalThis.GondolSystem = undefined;
  });

  test("serves the index, the manifest and the client, but not the server module", async () => {
    const index = await (await fetch(`${runtime.url}/gondol-apps.json`)).json();
    expect(index).toEqual({
      format: "gondol-apps",
      version: 1,
      apps: [
        {
          id: "hello",
          version: "0.1.0",
          name: "Hello",
          manifest: "apps/hello/manifest.json",
          client: "apps/hello/dist/client.mjs",
          styles: ["apps/hello/dist/client.css"],
          functions: ["greet"],
          functionsUrl: "apps/hello/functions",
        },
      ],
    });
    const manifest = await fetch(`${runtime.url}/apps/hello/manifest.json`);
    expect((await manifest.json()).id).toBe("hello");
    const client = await fetch(`${runtime.url}/apps/hello/dist/client.mjs`);
    expect(client.headers.get("content-type")).toContain("text/javascript");
    expect(client.headers.get("access-control-allow-origin")).toBe("*");
    expect((await fetch(`${runtime.url}/apps/hello/dist/server.mjs`)).status).toBe(404);
    expect((await fetch(`${runtime.url}/apps/hello/package.json`)).status).toBe(404);
    expect((await fetch(`${runtime.url}/apps/hello/dist/../src/server.ts`)).status).toBe(404);
  });

  test("runs functions only with the secret", async () => {
    const call = (headers: Record<string, string>, body: unknown = { name: "Ada" }) =>
      fetch(`${runtime.url}/apps/hello/functions/greet`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await call({})).status).toBe(401);
    expect((await call({ Authorization: "Bearer wrong" })).status).toBe(401);
    const ok = await call({ Authorization: "Bearer s3cret", "x-gondol-user": "u1" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ text: "Hello, Ada!", user: "u1" });
    const tooLong = await call({ Authorization: "Bearer s3cret" }, { name: "x".repeat(81) });
    expect(tooLong.status).toBe(422);
    expect((await tooLong.json()).detail).toBe("That name is too long");
    expect((await fetch(`${runtime.url}/apps/hello/functions/nope`, { method: "POST", headers: { Authorization: "Bearer s3cret" } })).status).toBe(404);
  });
});

describe("dev mode", () => {
  let dir: string;
  let runtime: Awaited<ReturnType<typeof startAppsRuntime>>;

  beforeAll(async () => {
    dir = exampleCopy();
    runtime = await startAppsRuntime({ paths: [dir], port: 0, host: "127.0.0.1", dev: true, env: {}, log: { error: () => undefined } });
  }, 60_000);

  afterAll(async () => {
    await runtime?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("serves the source through Vite, with shared imports as shims", async () => {
    const index = await (await fetch(`${runtime.url}/gondol-apps.json`)).json();
    expect(index.dev).toBe(true);
    expect(index.apps[0].client).toBe("apps/hello/src/index.ts");
    const entry = await (await fetch(`${runtime.url}/apps/hello/src/index.ts`)).text();
    expect(entry).toContain("gondol-shared:gondol/apps/defineApp");
    const page = await (await fetch(`${runtime.url}/apps/hello/src/HelloPage.tsx`)).text();
    expect(page).toContain("gondol-shared:react");
    expect(page).not.toMatch(/node_modules\/\.vite\/deps\/react/);
    const shimUrl = /["']([^"']*gondol-shared:react\/jsx-runtime[^"']*)["']/.exec(page)?.[1];
    expect(shimUrl).toBeTruthy();
    const shim = await (await fetch(new URL(shimUrl!, `${runtime.url}/apps/hello/src/HelloPage.tsx`))).text();
    expect(shim).toContain('await g.import("react/jsx-runtime")');
    expect(shim).toContain("export const jsx =");
  });

  test("calls functions from the source without a secret", async () => {
    const response = await fetch(`${runtime.url}/apps/hello/functions/greet`, { method: "POST", headers: { "x-gondol-user": "u2" }, body: JSON.stringify({ name: "Bo" }) });
    expect(await response.json()).toEqual({ text: "Hello, Bo!", user: "u2" });
  });
});
