import { describe, expect, test } from "bun:test";
import { createApiGateway, rpcArgName, validate, type ApiCaller, type TokenGrant } from "./gateway";
import { buildOpenApiDocument } from "./openapi";

const document = buildOpenApiDocument([
  {
    id: "streams",
    api: {
      scopes: { "streams:write": { en: "Start and end streams" } },
      schemas: {
        Stream: { type: "object", properties: { id: { type: "string" } } },
      },
      paths: {
        "/streams": {
          post: {
            operationId: "startStream",
            rpc: "api_start_stream",
            scopes: ["streams:write"],
            requestBody: {
              required: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["object_uri"],
                properties: { object_uri: { type: "string", format: "uri" }, quantity: { type: "number", minimum: 0 } },
              },
            },
            responses: { "201": { description: "Started", schema: { $ref: "#/components/schemas/Stream" } } },
          },
        },
        "/streams/{id}": {
          patch: {
            operationId: "updateStream",
            rpc: "api_update_stream",
            scopes: ["streams:write"],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
            requestBody: { schema: { type: "object", properties: { endedAt: { type: "string", format: "date-time" }, id: { type: "string" } } } },
          },
        },
        "/ping": { get: { operationId: "ping", rpc: "api_ping", scopes: [] } },
      },
    },
  },
]);

const caller: ApiCaller = { userId: "u1", clientId: "c1", scopes: ["streams:write"] };
const calls: { rpc: string; args: Record<string, unknown> }[] = [];
const grants: TokenGrant[] = [];
const handle = createApiGateway({
  document,
  basePath: "/app-api",
  authorizeUrl: "https://app.example.com/oauth/authorize",
  authenticate: async (token) => (token === "good" ? caller : token === "narrow" ? { ...caller, scopes: [] } : null),
  token: async (grant) => {
    grants.push(grant);
    return grant.clientSecret === "s3cret" ? { access_token: "a", token_type: "Bearer", expires_in: 3600, refresh_token: "r" } : { error: "invalid_client" };
  },
  invoke: async ({ rpc, args }) => {
    calls.push({ rpc, args });
    if (args.p_id === "00000000-0000-0000-0000-000000000000") return { error: { status: 404, message: "No such stream" } };
    return { data: { id: "s1", ...args } };
  },
});

const url = (path: string) => `https://db.example.com/functions/v1/app-api${path}`;
const post = (path: string, body: unknown, token = "good") =>
  handle(new Request(url(path), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));

describe("gateway", () => {
  test("runs an operation's function with p_ arguments and its 2xx status", async () => {
    const response = await post("/streams", { object_uri: "spacify:recording:abc", quantity: 2 });
    expect(response.status).toBe(201);
    expect(calls.at(-1)).toEqual({ rpc: "api_start_stream", args: { p_object_uri: "spacify:recording:abc", p_quantity: 2 } });
  });

  test("validates the body", async () => {
    const response = await post("/streams", { quantity: -1, extra: true });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect([...body.errors].sort()).toEqual(["body.extra: is not a known field", "body.object_uri: is required", "body.quantity: must be at least 0"]);
  });

  test("needs a token with the operation's scopes", async () => {
    expect((await post("/streams", { object_uri: "a:b" }, "bad")).status).toBe(401);
    const narrow = await post("/streams", { object_uri: "a:b" }, "narrow");
    expect(narrow.status).toBe(403);
    expect(narrow.headers.get("WWW-Authenticate")).toContain("insufficient_scope");
    expect((await handle(new Request(url("/ping")))).status).toBe(200);
  });

  test("path parameters, camelCase and a body can't retarget the row", async () => {
    const id = "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";
    const response = await handle(
      new Request(url(`/streams/${id}`), {
        method: "PATCH",
        headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
        body: JSON.stringify({ endedAt: "2026-10-23T12:00:00Z", id: "other" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(calls.at(-1)?.args).toEqual({ p_id: id, p_ended_at: "2026-10-23T12:00:00Z" });
    expect((await handle(new Request(url("/streams/not-a-uuid"), { method: "PATCH", headers: { Authorization: "Bearer good" } }))).status).toBe(422);
  });

  test("maps errors, unknown paths and methods", async () => {
    const missing = await handle(new Request(url("/streams/00000000-0000-0000-0000-000000000000"), { method: "PATCH", headers: { Authorization: "Bearer good" } }));
    expect(missing.status).toBe(404);
    expect((await handle(new Request(url("/nothing")))).status).toBe(404);
    const wrong = await handle(new Request(url("/streams"), { method: "GET" }));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toBe("POST");
  });

  test("token endpoint: form body and Basic credentials", async () => {
    const response = await handle(
      new Request(url("/oauth/token"), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa("c1:s3cret")}` },
        body: "grant_type=authorization_code&code=xyz&redirect_uri=https%3A%2F%2Fapp%2Fcb&code_verifier=v",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(grants.at(-1)).toEqual({ grantType: "authorization_code", clientId: "c1", clientSecret: "s3cret", code: "xyz", redirectUri: "https://app/cb", codeVerifier: "v" });
    const bad = await handle(new Request(url("/oauth/token"), { method: "POST", body: "grant_type=password&client_id=c1" }));
    expect((await bad.json()).error).toBe("unsupported_grant_type");
  });

  test("serves the document and redirects authorize", async () => {
    const doc = await (await handle(new Request(url("/openapi.json")))).json();
    expect(doc.servers).toEqual([{ url: "https://db.example.com/functions/v1/app-api" }]);
    expect(doc.components.securitySchemes.oauth2.flows.authorizationCode.tokenUrl).toBe("https://db.example.com/functions/v1/app-api/oauth/token");
    expect(doc.components.securitySchemes.oauth2.flows.authorizationCode.scopes).toEqual({ "streams:write": "Start and end streams" });
    const redirect = await handle(new Request(url("/oauth/authorize?client_id=c1&state=x")));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe("https://app.example.com/oauth/authorize?client_id=c1&state=x");
  });
});

describe("validate and naming", () => {
  test("formats", () => {
    expect(validate({ type: "string", format: "uri" }, "spacify:user:1")).toEqual([]);
    expect(validate({ type: "string", format: "uri" }, "not a uri")).toHaveLength(1);
    expect(validate({ type: ["string", "null"], format: "date-time" }, null)).toEqual([]);
  });
  test("rpcArgName", () => {
    expect(rpcArgName("startedAt")).toBe("p_started_at");
    expect(rpcArgName("context_uri")).toBe("p_context_uri");
  });
});

describe("buildOpenApiDocument", () => {
  test("refuses clashes and undeclared scopes", () => {
    const op = { operationId: "a", rpc: "f", scopes: ["nope"] };
    expect(() => buildOpenApiDocument([{ id: "x", api: { paths: { "/a": { get: op } } } }])).toThrow(/no app declares the scope "nope"/);
    const plain = { operationId: "a", rpc: "f" };
    expect(() =>
      buildOpenApiDocument([
        { id: "x", api: { paths: { "/a": { get: plain } } } },
        { id: "y", api: { paths: { "/a": { get: { ...plain, operationId: "b" } } } } },
      ]),
    ).toThrow(/also defined by app "x"/);
    expect(() => buildOpenApiDocument([{ id: "x", api: { paths: { "/oauth/token": { post: plain } } } }])).toThrow(/gateway's own/);
  });
});

describe("authorization server metadata", () => {
  test("names the endpoints and scopes", async () => {
    const handler = createApiGateway({
      document,
      basePath: "/app-api",
      authorizeUrl: "https://app.example.com/oauth/authorize",
      authenticate: async () => null,
      token: async () => ({ error: "invalid_grant" }),
      invoke: async () => ({ data: null }),
    });
    const response = await handler(new Request("https://x.example/functions/v1/app-api/.well-known/oauth-authorization-server"));
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe("https://x.example/functions/v1/app-api");
    expect(body.authorization_endpoint).toBe("https://app.example.com/oauth/authorize");
    expect(body.token_endpoint).toBe("https://x.example/functions/v1/app-api/oauth/token");
    expect(body.scopes_supported).toEqual(["streams:write"]);
  });
});
