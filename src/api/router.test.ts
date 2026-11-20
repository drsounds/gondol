import { describe, expect, test } from "bun:test";
import { buildAppRegistry } from "./functions";
import { createAppRouter, mayCall, splitToolName, type AppRouterOptions, type RouterCaller } from "./router";

const registry = buildAppRegistry([
  {
    id: "ideas",
    name: { en: "Ideas" },
    description: { en: "Note ideas" },
    functions: {
      create_idea: {
        description: "Create an idea",
        rpc: "api_create_idea",
        input: { type: "object", required: ["title"], additionalProperties: false, properties: { title: { type: "string", minLength: 1 }, relatedUris: { type: "array" } } },
        scopes: ["ideas:write"],
      },
      summarize: { description: "Summarize ideas", function: "ideas-summary", readOnly: true },
      ping: { description: "Public", rpc: "api_ping", scopes: [] },
    },
    mcp: {
      instructions: "Use ideas for things the user wants to remember.",
      tools: [
        { name: "create_idea", function: "create_idea" },
        { name: "summarize", function: "summarize" },
      ],
    },
    api: {
      scopes: { "ideas:write": { en: "Write ideas" }, "ideas:read": { en: "Read ideas" } },
      schemas: { Idea: { type: "object", properties: { id: { type: "string" } } } },
      paths: {
        "/ideas/{id}": {
          get: {
            operationId: "getIdea",
            summary: "Read an idea",
            rpc: "api_get_idea",
            scopes: ["ideas:read"],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
            responses: { "200": { description: "The idea", schema: { $ref: "#/components/schemas/Idea" } } },
          },
        },
      },
    },
  },
  {
    id: "remote",
    name: { en: "Remote" },
    mcp: { endpoint: { url: "https://mcp.example.com/mcp", headers: { Authorization: "REMOTE_TOKEN" } } },
  },
  {
    id: "tasks",
    name: { en: "Tasks" },
    description: { en: "Things to do" },
    features: [
      {
        id: "tasks",
        name: { en: "Tasks", sv: "Uppgifter" },
        path: "tasks",
        entityTypes: ["task_list"],
        actions: [{ id: "tasks.new", title: "New task", navigate: "/tasks/new", shortcut: "Mod+Alt+T" }],
      },
    ],
    entities: { task: { slug: "task", edit: "/tasks/{key}/edit" } },
  },
]);

const user: RouterCaller = { userId: "u1", token: "session.jwt.token", scopes: null };
const client: RouterCaller = { userId: "u1", token: "opaque", scopes: ["ideas:read"], clientId: "c1" };

type Call = { kind: string; [key: string]: unknown };

function router(extra: Partial<AppRouterOptions> = {}) {
  const calls: Call[] = [];
  const remoteCalls: { method: string; headers: Record<string, string> }[] = [];
  const handler = createAppRouter({
    registry,
    basePath: "/app-router",
    authenticate: async (token) => (token === user.token ? user : token === client.token ? client : null),
    rpc: async ({ rpc, args, caller }) => {
      calls.push({ kind: "rpc", rpc, args, caller: caller?.userId ?? null });
      if (rpc === "entity_api_types") return { data: [{ type: "task" }, { type: "task_list" }, { type: "note" }] };
      return rpc === "api_create_idea" ? { data: { id: "i1", title: args.p_title } } : { data: { ok: true } };
    },
    callFunction: async ({ function: name, input }) => {
      calls.push({ kind: "function", name, input });
      return { data: ["a", "b"] };
    },
    secret: (name) => (name === "REMOTE_TOKEN" ? "Bearer remote-secret" : undefined),
    fetch: (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      if (init.method === "DELETE") return new Response(null, { status: 405 });
      const message = JSON.parse(init.body as string);
      remoteCalls.push({ method: message.method, headers });
      if (!("id" in message)) return new Response(null, { status: 202 });
      const result =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "r", version: "1" } }
          : message.method === "tools/list"
            ? { tools: [{ name: "lookup", description: "Look up", inputSchema: { type: "object" } }] }
            : { content: [{ type: "text", text: `called ${message.params.name}` }] };
      // Answers as an event stream, with a session.
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`, {
        headers: { "Content-Type": "text/event-stream", "Mcp-Session-Id": "s1" },
      });
    }) as typeof fetch,
    ...extra,
  });
  return { handler, calls, remoteCalls };
}

const post = (path: string, body: unknown, token?: string) =>
  new Request(`https://x.example/functions/v1/app-router${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: "2.0", ...(id !== null ? { id } : {}), method, ...(params ? { params } : {}) });

describe("buildAppRegistry", () => {
  test("resolves tools to their functions and API operations", () => {
    const built = buildAppRegistry([
      {
        id: "ideas",
        mcp: { tools: [{ name: "get_idea", operation: "getIdea" }] },
        api: {
          scopes: { "ideas:read": { en: "Read" } },
          schemas: { Idea: { type: "object", properties: { id: { type: "string" } } } },
          paths: {
            "/ideas/{id}": {
              get: {
                operationId: "getIdea",
                summary: "Read an idea",
                rpc: "api_get_idea",
                scopes: ["ideas:read"],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "The idea", schema: { $ref: "#/components/schemas/Idea" } } },
              },
            },
          },
        },
      },
    ]);
    const tool = built.apps.ideas.tools[0];
    expect(tool.target).toEqual({ rpc: "api_get_idea" });
    expect(tool.input).toEqual({ type: "object", properties: { id: { type: "string" } }, required: ["id"] });
    expect(tool.output).toEqual({ type: "object", properties: { id: { type: "string" } } });
    expect(tool.readOnly).toBe(true);
    expect(tool.scopes).toEqual(["ideas:read"]);
  });

  test("refuses unknown functions, operations and scopes", () => {
    expect(() => buildAppRegistry([{ id: "a", mcp: { tools: [{ name: "x", function: "nope" }] } }])).toThrow(/no function "nope"/);
    expect(() => buildAppRegistry([{ id: "a", mcp: { tools: [{ name: "x", operation: "nope" }] } }])).toThrow(/no operation "nope"/);
    expect(() => buildAppRegistry([{ id: "a", functions: { f: { description: "f", rpc: "f", scopes: ["x:y"] } } }])).toThrow(/scope "x:y"/);
  });
});

describe("helpers", () => {
  test("splitToolName and mayCall", () => {
    expect(splitToolName("ideas__create_idea")).toEqual({ app: "ideas", tool: "create_idea" });
    expect(splitToolName("nothing")).toBeNull();
    expect(mayCall(null, [])).toBe(true);
    expect(mayCall(null, undefined)).toBe(false);
    expect(mayCall(user, ["anything"])).toBe(true);
    expect(mayCall(client, ["ideas:write"])).toBe(false);
    expect(mayCall(client, ["ideas:read"])).toBe(true);
  });
});

describe("functions", () => {
  test("runs a Postgres function with p_ arguments as the caller", async () => {
    const { handler, calls } = router();
    const response = await handler(post("/apps/ideas/functions/create_idea", { title: "Fly", relatedUris: [] }, user.token));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "i1", title: "Fly" });
    expect(calls[0]).toEqual({ kind: "rpc", rpc: "api_create_idea", args: { p_title: "Fly", p_related_uris: [] }, caller: "u1" });
  });

  test("forwards to an edge function", async () => {
    const { handler, calls } = router();
    const response = await handler(post("/apps/ideas/functions/summarize", { since: "2026-01-01" }, user.token));
    expect(await response.json()).toEqual(["a", "b"]);
    expect(calls[0]).toEqual({ kind: "function", name: "ideas-summary", input: { since: "2026-01-01" } });
  });

  test("checks the token, its scopes and the input", async () => {
    const { handler, calls } = router();
    expect((await handler(post("/apps/ideas/functions/create_idea", { title: "x" }))).status).toBe(401);
    expect((await handler(post("/apps/ideas/functions/create_idea", { title: "x" }, "bad"))).status).toBe(401);
    expect((await handler(post("/apps/ideas/functions/create_idea", { title: "x" }, client.token))).status).toBe(403);
    const invalid = await handler(post("/apps/ideas/functions/create_idea", { title: "" }, user.token));
    expect(invalid.status).toBe(422);
    expect((await handler(post("/apps/ideas/functions/nope", {}, user.token))).status).toBe(404);
    expect(calls).toEqual([]);
    expect((await handler(post("/apps/ideas/functions/ping", {}))).status).toBe(200);
  });

  test("lists the apps for the caller", async () => {
    const { handler } = router();
    const response = await handler(new Request("https://x.example/functions/v1/app-router/apps", { headers: { Authorization: `Bearer ${client.token}` } }));
    const body = (await response.json()) as { mcp: string; apps: { id: string; functions: { name: string; url: string }[]; tools: { name: string }[] }[] };
    expect(body.mcp).toBe("https://x.example/functions/v1/app-router/mcp");
    const ideas = body.apps.find((a) => a.id === "ideas")!;
    // The client may not create ideas; ping is public.
    expect(ideas.functions.map((f) => f.name)).toEqual(["summarize", "ping"]);
    expect(ideas.functions[0].url).toBe("https://x.example/functions/v1/app-router/apps/ideas/functions/summarize");
    expect(ideas.tools.map((t) => t.name)).toEqual(["ideas__summarize"]);
  });
});

describe("mcp", () => {
  test("initialize names the apps' instructions; notifications get 202", async () => {
    const { handler } = router();
    const response = await handler(post("/mcp", rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }), user.token));
    const body = (await response.json()) as { result: { protocolVersion: string; instructions: string; capabilities: unknown } };
    expect(body.result.protocolVersion).toBe("2025-03-26");
    expect(body.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(body.result.instructions).toContain("Ideas (tools ideas__…): Use ideas");
    expect((await handler(post("/mcp", rpc("notifications/initialized", undefined, null), user.token))).status).toBe(202);
  });

  test("asks for a token with the resource metadata", async () => {
    const { handler } = router();
    const response = await handler(post("/mcp", rpc("tools/list")));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain('resource_metadata="https://x.example/functions/v1/app-router/.well-known/oauth-protected-resource"');
  });

  test("lists every app's tools, an app's own server's too", async () => {
    const { handler, remoteCalls } = router();
    const response = await handler(post("/mcp", rpc("tools/list"), user.token));
    const body = (await response.json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    const tools = body.result.tools.filter((t) => !t.name.startsWith("apps__"));
    expect(tools.map((t) => t.name)).toEqual(["ideas__create_idea", "ideas__summarize", "remote__lookup"]);
    expect(tools[1].annotations.readOnlyHint).toBe(true);
    expect(remoteCalls.map((c) => c.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(remoteCalls[0].headers.Authorization).toBe("Bearer remote-secret");
  });

  test("calls a tool, and proxies one of an app's own server", async () => {
    const { handler, calls } = router();
    const local = (await (await handler(post("/mcp", rpc("tools/call", { name: "ideas__create_idea", arguments: { title: "Fly" } }), user.token))).json()) as {
      result: { content: { text: string }[]; structuredContent: unknown };
    };
    expect(local.result.structuredContent).toEqual({ id: "i1", title: "Fly" });
    expect(JSON.parse(local.result.content[0].text)).toEqual({ id: "i1", title: "Fly" });
    expect(calls[0].rpc).toBe("api_create_idea");

    const remote = (await (await handler(post("/mcp", rpc("tools/call", { name: "remote__lookup", arguments: {} }), user.token))).json()) as { result: { content: { text: string }[] } };
    expect(remote.result.content[0].text).toBe("called lookup");
  });

  test("tool errors are results; unknown tools and methods are JSON-RPC errors", async () => {
    const { handler } = router();
    const denied = (await (await handler(post("/mcp", rpc("tools/call", { name: "ideas__create_idea", arguments: { title: "x" } }), client.token))).json()) as { result: { isError: boolean } };
    expect(denied.result.isError).toBe(true);
    const invalid = (await (await handler(post("/mcp", rpc("tools/call", { name: "ideas__create_idea", arguments: {} }), user.token))).json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(invalid.result.isError).toBe(true);
    expect(invalid.result.content[0].text).toContain("input.title: is required");
    const unknown = (await (await handler(post("/mcp", rpc("tools/call", { name: "ideas__nope" }), user.token))).json()) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32602);
    const method = (await (await handler(post("/mcp", rpc("sampling/createMessage"), user.token))).json()) as { error: { code: number } };
    expect(method.error.code).toBe(-32601);
  });

  test("one app's server names its tools without the prefix", async () => {
    const { handler } = router();
    const list = (await (await handler(post("/apps/ideas/mcp", rpc("tools/list"), user.token))).json()) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["create_idea", "summarize"]);
    const call = (await (await handler(post("/apps/ideas/mcp", rpc("tools/call", { name: "summarize", arguments: {} }), user.token))).json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(call.result.content[0].text)).toEqual(["a", "b"]);
  });

  test("GET is not an event stream", async () => {
    const { handler } = router();
    const response = await handler(new Request("https://x.example/app-router/mcp", { headers: { Authorization: `Bearer ${user.token}` } }));
    expect(response.status).toBe(405);
  });
});

const postWith = (path: string, body: unknown, token: string, headers: Record<string, string>) =>
  new Request(`https://x.example/functions/v1/app-router${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });

type ToolList = { result: { tools: { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[] } };
type ToolCall = { result: { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> } };

describe("gondol's own tools", () => {
  test("apps__ and, when on, entities__ tools, for the user's own session only", async () => {
    const { handler } = router({ entities: true });
    const own = (await (await handler(post("/mcp", rpc("tools/list"), user.token))).json()) as ToolList;
    const names = own.result.tools.map((t) => t.name);
    expect(names.slice(0, 3)).toEqual(["apps__list_apps", "apps__describe_app", "apps__call_function"]);
    expect(names).toContain("entities__create");
    const byName = Object.fromEntries(own.result.tools.map((t) => [t.name, t.annotations]));
    expect(byName.entities__list.readOnlyHint).toBe(true);
    expect(byName.entities__create.readOnlyHint).toBe(false);
    expect(byName.entities__delete.destructiveHint).toBe(true);
    expect(byName.apps__call_function.readOnlyHint).toBe(false);

    const oauth = (await (await handler(post("/mcp", rpc("tools/list"), client.token))).json()) as ToolList;
    expect(oauth.result.tools.some((t) => t.name.startsWith("apps__") || t.name.startsWith("entities__"))).toBe(false);

    const init = (await (await handler(post("/mcp", rpc("initialize", { protocolVersion: "2025-06-18" }), user.token))).json()) as { result: { instructions: string } };
    expect(init.result.instructions).toContain("Entities (tools entities__…)");
    expect(init.result.instructions).not.toContain("Tasks (tools tasks__…)");

    const off = router({ discovery: false });
    const none = (await (await off.handler(post("/mcp", rpc("tools/list"), user.token))).json()) as ToolList;
    expect(none.result.tools.some((t) => t.name.startsWith("apps__") || t.name.startsWith("entities__"))).toBe(false);
  });

  test("entity tools run the entity API as the user, narrowed to the site's types", async () => {
    const { handler, calls } = router({ entities: true });
    const created = (await (
      await handler(postWith("/mcp", rpc("tools/call", { name: "entities__create", arguments: { type: "task", values: { title: "Fly" } } }), user.token, { "x-gondol-entity-types": "task, note,bad type" }))
    ).json()) as ToolCall;
    expect(created.result.isError).toBeUndefined();
    expect(calls.at(-1)).toEqual({ kind: "rpc", rpc: "entity_api_create", args: { p_type: "task", p_values: { title: "Fly" }, p_allowed_types: ["task", "note"] }, caller: "u1" });

    const types = (await (await handler(post("/mcp", rpc("tools/call", { name: "entities__list_types", arguments: {} }), user.token))).json()) as ToolCall;
    expect(types.result.structuredContent).toEqual({ types: [{ type: "task", app: "tasks" }, { type: "task_list", app: "tasks" }, { type: "note" }] });
    expect(calls.at(-1)?.args).toEqual({ p_allowed_types: null });

    const bad = (await (await handler(post("/mcp", rpc("tools/call", { name: "entities__update", arguments: { uri: "spacify:task:1" } }), user.token))).json()) as ToolCall;
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toContain("arguments.values: is required");
  });

  test("apps__ tools describe the apps and run any of their functions", async () => {
    const { handler, calls } = router();
    const list = (await (await handler(post("/mcp", rpc("tools/call", { name: "apps__list_apps", arguments: {} }), user.token))).json()) as ToolCall;
    const apps = (list.result.structuredContent as { apps: { id: string; features: unknown[]; entity_types: string[]; functions: string[] }[] }).apps;
    expect(apps.map((a) => a.id)).toEqual(["ideas", "remote", "tasks"]);
    expect(apps[2].features).toEqual([{ name: "Tasks", path: "/tasks" }]);
    expect(apps[2].entity_types).toEqual(["task", "task_list"]);
    expect(apps[0].functions).toEqual(["create_idea", "summarize", "ping"]);

    const described = (await (await handler(post("/mcp", rpc("tools/call", { name: "apps__describe_app", arguments: { app: "tasks" } }), user.token))).json()) as ToolCall;
    const tasks = described.result.structuredContent as { features: { actions: unknown[] }[]; entities: unknown };
    expect(tasks.features[0].actions).toEqual([{ id: "tasks.new", title: "New task", navigate: "/tasks/new", shortcut: "Mod+Alt+T" }]);
    expect(tasks.entities).toEqual({ task: { slug: "task", edit: "/tasks/{key}/edit" } });

    // ping isn't a tool, but the model can still run it.
    const ran = (await (await handler(post("/mcp", rpc("tools/call", { name: "apps__call_function", arguments: { app: "ideas", function: "ping" } }), user.token))).json()) as ToolCall;
    expect(ran.result.structuredContent).toEqual({ ok: true });
    expect(calls.at(-1)?.rpc).toBe("api_ping");
    const invalid = (await (await handler(post("/mcp", rpc("tools/call", { name: "apps__call_function", arguments: { app: "ideas", function: "create_idea", input: {} } }), user.token))).json()) as ToolCall;
    expect(invalid.result.content[0].text).toContain("input.title: is required");
  });

  test("x-gondol-apps limits the apps, their tools and the catalogue", async () => {
    const { handler } = router();
    const headers = { "x-gondol-apps": "tasks" };
    const list = (await (await handler(postWith("/mcp", rpc("tools/list"), user.token, headers))).json()) as ToolList;
    expect(list.result.tools.map((t) => t.name)).toEqual(["apps__list_apps", "apps__describe_app", "apps__call_function"]);
    const call = (await (await handler(postWith("/mcp", rpc("tools/call", { name: "apps__call_function", arguments: { app: "ideas", function: "ping" } }), user.token, headers))).json()) as ToolCall;
    expect(call.result.isError).toBe(true);
    const catalog = (await (
      await handler(new Request("https://x.example/app-router/apps", { headers: { Authorization: `Bearer ${user.token}`, ...headers } }))
    ).json()) as { apps: { id: string; builtin?: boolean }[] };
    expect(catalog.apps.map((a) => a.id)).toEqual(["apps", "tasks"]);
    expect(catalog.apps[0].builtin).toBe(true);
  });
});

describe("buildAppRegistry and gondol's own tools", () => {
  test("no app may take their ids", () => {
    expect(() => buildAppRegistry([{ id: "entities", features: [{ id: "x", name: { en: "X" }, path: "x" }] }])).toThrow("gondol's own tools");
  });
});
