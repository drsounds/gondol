import { describe, expect, test } from "bun:test";
import { buildAppRegistry } from "../../../api/functions";
import manifest from "../manifest.json";
import {
  appIdFrom,
  codeWorkspacePrompt,
  githubFullName,
  gondolAppFiles,
  portRange,
  previewAddress,
  releaseIndex,
  repositoryFolder,
  shellQuote,
  workspacePath,
} from "../../../../supabase/functions/_shared/codeWorkspace.ts";

describe("agent coding helpers", () => {
  test("paths stay inside the workspace", () => {
    expect(workspacePath("/w/gondol/1", "apps/x/../y")).toBe("/w/gondol/1/apps/y");
    expect(workspacePath("/w/gondol/1/", "")).toBe("/w/gondol/1");
    expect(workspacePath("/w/gondol/1", "/w/gondol/1/src")).toBe("/w/gondol/1/src");
    expect(() => workspacePath("/w/gondol/1", "../2")).toThrow();
    expect(() => workspacePath("/w/gondol/1", "/etc/passwd")).toThrow();
    expect(() => workspacePath("/w/gondol/1", "/w/gondol/10")).toThrow();
  });

  test("shell quoting", () => {
    expect(shellQuote("it's")).toBe(`'it'"'"'s'`);
  });

  test("GitHub names, folders, ids and ports", () => {
    expect(githubFullName("https://github.com/drsounds/gondol.git")).toBe("drsounds/gondol");
    expect(githubFullName("git@github.com:drsounds/spacify.git")).toBe("drsounds/spacify");
    expect(githubFullName("https://gitlab.com/a/b")).toBeNull();
    expect(repositoryFolder("../My Repo.git")).toBe("My-Repo");
    expect(appIdFrom(" My Cool App! ")).toBe("my-cool-app");
    expect(portRange("5180-5182")).toEqual([5180, 5181, 5182]);
    expect(portRange(null, [1, 2])).toEqual([1, 2]);
    expect(previewAddress("https://{port}.sb.example.com/", 5181)).toBe("https://5181.sb.example.com");
    expect(previewAddress("", 1)).toBeNull();
  });

  test("a new gondol app package", () => {
    const files = gondolAppFiles({ id: "todo-list", name: "Todo list", gondol: "git+https://github.com/drsounds/gondol.git" });
    const pkg = JSON.parse(files["package.json"]);
    const appManifest = JSON.parse(files["manifest.json"]);
    expect(pkg.gondol.source.client).toBe("./src/index.ts");
    expect(appManifest.id).toBe("todo-list");
    expect(appManifest.features[0].path).toBe("todo-list");
    expect(files["src/TodoListPage.tsx"]).toContain("export function TodoListPage");
    expect(files["src/index.ts"]).toContain('"todo-list": () => import("./TodoListPage")');
  });

  test("a release's index", () => {
    expect(releaseIndex({ id: "a", version: "1.0.0", name: "A", styles: ["dist/client.css"] }).apps[0]).toEqual({
      id: "a",
      version: "1.0.0",
      name: "A",
      manifest: "manifest.json",
      client: "dist/client.mjs",
      styles: ["dist/client.css"],
    });
  });

  test("the agent is told about its workspace", () => {
    const text = codeWorkspacePrompt({
      id: "ws-1",
      title: "Site",
      root_path: "/workspace/gondol/ws-1",
      status: "ready",
      sandbox_url: null,
      repositories: [{ name: "site", full_name: "me/site", path: "/workspace/gondol/ws-1/site", branch: null, cloned: true }],
    });
    expect(text).toContain("ws-1");
    expect(text).toContain("me/site at /workspace/gondol/ws-1/site");
  });

  test("the coding tools are app router functions of the agents app", () => {
    const registry = buildAppRegistry([manifest as never]);
    const app = registry.apps.agents;
    expect(JSON.stringify(app.functions.code_run_command.target)).toContain("agent-code");
    expect(app.functions.code_read_file.readOnly).toBe(true);
    expect(app.tools.map((t) => t.name)).toContain("code_prepare_release");
  });
});
