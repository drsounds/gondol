import { describe, expect, test } from "bun:test";
import { createAppRouter, type RouterCaller } from "../../api/router";
import { getInternalApp, registerDynamicApps } from "../registry";
import { reviewRemoteBackend } from "./backend";
import { loadRemoteApps } from "./loader";
import { backendFingerprint, parseRemoteIndex, remoteIndexUrl } from "./protocol";
import { createGondolSystem, gondolSpecifier, installGondolSystem } from "./system";

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  name: { en: "Hello" },
  description: { en: "Says hello" },
  iconName: "star",
  defaultFeatureId: "hello",
  features: [{ id: "hello", name: { en: "Hello" }, path: id }],
  ...extra,
});

describe("GondolSystem", () => {
  test("imports registered modules once and refuses others", async () => {
    let loads = 0;
    const system = createGondolSystem({ react: async () => (loads++, { default: "R", useState: 1 }) });
    expect(await system.import("react")).toEqual({ default: "R", useState: 1 });
    await system.import("react");
    expect(loads).toBe(1);
    expect(system.has("react")).toBe(true);
    await expect(system.import("lodash")).rejects.toThrow(/doesn't share "lodash"/);
    system.register("lodash", async () => ({ x: 1 }));
    expect(system.specifiers()).toEqual(["lodash", "react"]);
  });

  test("a failed load can be retried", async () => {
    let fail = true;
    const system = createGondolSystem({ flaky: async () => (fail ? Promise.reject(new Error("offline")) : { ok: true }) });
    await expect(system.import("flaky")).rejects.toThrow("offline");
    fail = false;
    expect(await system.import("flaky")).toEqual({ ok: true });
  });

  test("names gondol's modules as package.json exports them", () => {
    expect(gondolSpecifier("../../entities/EntitySheet.tsx")).toBe("gondol/entities/EntitySheet");
    expect(gondolSpecifier("../../builtin/ai/models/index.ts")).toBe("gondol/builtin/ai/models");
    expect(gondolSpecifier("../../index.ts")).toBe("gondol");
    expect(gondolSpecifier("../registry.ts")).toBe("gondol/apps/registry");
    expect(gondolSpecifier("./system.ts")).toBe("gondol/apps/remote/system");
    expect(gondolSpecifier("/node_modules/gondol/src/entities/uri.ts")).toBe("gondol/entities/uri");
    expect(gondolSpecifier("./x.css")).toBeNull();
  });
});

describe("the index", () => {
  test("a source is a runtime's address or its index", () => {
    expect(remoteIndexUrl("https://apps.example.com")).toBe("https://apps.example.com/gondol-apps.json");
    expect(remoteIndexUrl("https://apps.example.com/v1/")).toBe("https://apps.example.com/v1/gondol-apps.json");
    expect(remoteIndexUrl("http://localhost:5180/custom.json")).toBe("http://localhost:5180/custom.json");
  });

  test("makes URLs absolute and checks the format", () => {
    const index = parseRemoteIndex(
      { format: "gondol-apps", version: 1, dev: true, apps: [{ id: "hello", manifest: "apps/hello/manifest.json", client: "apps/hello/dist/client.mjs", styles: ["apps/hello/dist/client.css"], functions: ["greet"], functionsUrl: "apps/hello/functions" }] },
      "https://apps.example.com/gondol-apps.json",
    );
    expect(index.dev).toBe(true);
    expect(index.apps[0]).toEqual({
      id: "hello",
      manifest: "https://apps.example.com/apps/hello/manifest.json",
      client: "https://apps.example.com/apps/hello/dist/client.mjs",
      styles: ["https://apps.example.com/apps/hello/dist/client.css"],
      functions: ["greet"],
      functionsUrl: "https://apps.example.com/apps/hello/functions",
    });
    expect(() => parseRemoteIndex({ format: "other", version: 1, apps: [] }, "https://x/i.json")).toThrow(/format/);
    expect(() => parseRemoteIndex({ format: "gondol-apps", version: 1, apps: [{ id: "Bad Id", manifest: "m", client: "c" }] }, "https://x/i.json")).toThrow(/id/);
    expect(() => parseRemoteIndex({ format: "gondol-apps", version: 1, apps: [{ id: "a", manifest: "javascript:alert(1)", client: "c" }] }, "https://x/i.json")).toThrow(/http/);
  });

  test("the backend fingerprint ignores key order and everything but functions and mcp", () => {
    const a = backendFingerprint({ functions: { greet: { server: "greet", description: "Hi" } }, mcp: undefined });
    const b = backendFingerprint({ functions: { greet: { description: "Hi", server: "greet" } } });
    const c = backendFingerprint({ functions: { greet: { description: "Hello", server: "greet" } } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("loading remote apps", () => {
  const files: Record<string, unknown> = {
    "https://apps.example.com/gondol-apps.json": {
      format: "gondol-apps",
      version: 1,
      apps: [
        { id: "hello", manifest: "apps/hello/manifest.json", client: "apps/hello/client.mjs", functions: ["greet"], functionsUrl: "apps/hello/functions" },
        { id: "broken", manifest: "apps/broken/manifest.json", client: "apps/broken/client.mjs" },
        { id: "needy", manifest: "apps/needy/manifest.json", client: "apps/needy/client.mjs" },
      ],
    },
    "https://apps.example.com/apps/hello/manifest.json": manifest("hello", { functions: { greet: { description: "Greets", server: "greet" } } }),
    "https://apps.example.com/apps/broken/manifest.json": manifest("broken"),
    "https://apps.example.com/apps/needy/manifest.json": manifest("needy", { dependencies: ["nowhere"] }),
  };
  const modules: Record<string, Record<string, unknown>> = {
    // What defineApp takes, without the manifest: the loader adds the fetched one.
    "https://apps.example.com/apps/hello/client.mjs": { default: { pages: { hello: async () => () => null } } },
    "https://apps.example.com/apps/broken/client.mjs": {},
  };
  const options = {
    fetchJson: async (url: string) => {
      if (!(url in files)) throw new Error(`${url} answered 404`);
      return files[url];
    },
    importModule: async (url: string) => modules[url] ?? {},
    shareGondol: async () => undefined,
  };

  test("loads each app as a bundle and reports the ones that fail", async () => {
    const { bundles, statuses } = await loadRemoteApps([{ url: "https://apps.example.com" }, { url: "https://down.example.com" }], options);
    expect(bundles.map((b) => b.id)).toEqual(["hello"]);
    const hello = bundles[0];
    expect(hello.features[0].path).toBe("hello");
    expect(hello.remote).toEqual({
      source: "https://apps.example.com",
      indexUrl: "https://apps.example.com/gondol-apps.json",
      clientUrl: "https://apps.example.com/apps/hello/client.mjs",
      styles: [],
      dev: false,
      functions: ["greet"],
      functionsUrl: "https://apps.example.com/apps/hello/functions",
    });
    expect(statuses[0].state).toBe("ready");
    expect(statuses[0].apps.find((a) => a.id === "broken")?.error).toMatch(/no default export/);
    expect(statuses[0].apps.find((a) => a.id === "needy")?.error).toMatch(/needs "nowhere"/);
    expect(statuses[1]).toMatchObject({ state: "error", error: expect.stringMatching(/404/) });

    registerDynamicApps("remote", bundles);
    expect(getInternalApp("hello")?.remote?.functions).toEqual(["greet"]);
    registerDynamicApps("remote", []);
    expect(getInternalApp("hello")).toBeUndefined();
  });

  test("installs the registry on globalThis", () => {
    const system = installGondolSystem({ "gondol/x": async () => ({ y: 1 }) });
    expect(globalThis.GondolSystem).toBe(system);
    expect(system.has("react")).toBe(true);
    expect(system.has("gondol/x")).toBe(true);
  });
});

describe("approving a remote backend", () => {
  test("routes every function to the runtime", () => {
    const review = reviewRemoteBackend(
      manifest("hello", {
        functions: { greet: { description: "Greets", server: "greet", readOnly: true, input: { type: "object", properties: { name: { type: "string" } } } } },
        mcp: { instructions: "Say hello.", tools: [{ name: "greet", function: "greet" }] },
      }),
      "https://apps.example.com/apps/hello/functions",
    );
    expect(review.problems).toEqual([]);
    expect(review.registry.functions.greet.target).toEqual({ runtime: "https://apps.example.com/apps/hello/functions/greet" });
    expect(review.registry.tools.map((t) => t.name)).toEqual(["greet"]);
    expect(review.functions).toEqual([{ name: "greet", description: "Greets", url: "https://apps.example.com/apps/hello/functions/greet", readOnly: true, destructive: false }]);
  });

  test("refuses host functions, API operations, own MCP servers and plain HTTP", () => {
    const review = reviewRemoteBackend(
      manifest("sneaky", {
        functions: { drop: { description: "Drop", rpc: "api_delete_everything" } },
        mcp: { endpoint: { url: "https://mcp.example.com/mcp" } },
      }),
      "http://apps.example.com/apps/sneaky/functions",
    );
    expect(review.problems.join("\n")).toMatch(/must be `server` functions/);
    expect(review.problems.join("\n")).toMatch(/mcp.endpoint/);
    expect(review.problems.join("\n")).toMatch(/HTTPS/);
    expect(Object.keys(review.registry.functions)).toEqual([]);
  });
});

describe("the app router and approved runtimes", () => {
  const caller: RouterCaller = { userId: "u1", token: "session", scopes: null };
  const review = reviewRemoteBackend(
    manifest("hello", { functions: { greet: { description: "Greets", server: "greet", input: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } } }),
    "https://apps.example.com/apps/hello/functions",
  );

  function router(calls: { url: string; init: RequestInit }[], answer = () => new Response(JSON.stringify({ text: "Hello Ada" }), { status: 200 })) {
    return createAppRouter({
      registry: { version: 1, apps: {} },
      authenticate: async (token) => (token === "session" ? caller : null),
      rpc: async () => ({ data: null }),
      callFunction: async () => ({ data: null }),
      remoteApps: async () => [{ app: review.registry, secret: "s3cret" }],
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return answer();
      }) as unknown as typeof fetch,
    });
  }

  test("calls the runtime with its secret and the user's id, never the user's token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const response = await router(calls)(
      new Request("https://x/apps/hello/functions/greet", { method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ name: "Ada" }) }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Hello Ada" });
    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].url).toBe("https://apps.example.com/apps/hello/functions/greet");
    expect(headers.Authorization).toBe("Bearer s3cret");
    expect(headers["x-gondol-user"]).toBe("u1");
    expect(JSON.stringify(headers)).not.toContain("session");
    expect(calls[0].init.redirect).toBe("error");
  });

  test("checks the input first and passes the runtime's problems on", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const bad = await router(calls)(new Request("https://x/apps/hello/functions/greet", { method: "POST", headers: { Authorization: "Bearer session" }, body: "{}" }));
    expect(bad.status).toBe(422);
    expect(calls).toHaveLength(0);
    const failing = router(calls, () => new Response(JSON.stringify({ title: "Request Failed", detail: "No such person" }), { status: 404 }));
    const response = await failing(new Request("https://x/apps/hello/functions/greet", { method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ name: "Bo" }) }));
    expect(response.status).toBe(404);
    expect((await response.json()).detail).toBe("No such person");
  });

  test("lists the approved app in the catalogue", async () => {
    const response = await router([])(new Request("https://x/apps", { headers: { Authorization: "Bearer session" } }));
    const body = (await response.json()) as { apps: { id: string; functions: { name: string }[] }[] };
    expect(body.apps.find((app) => app.id === "hello")?.functions.map((f) => f.name)).toEqual(["greet"]);
  });
});
