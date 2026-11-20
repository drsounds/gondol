import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  fillTemplate,
  installFields,
  missingFields,
  placeholders,
  registryApiBase,
  resolveInstall,
  serverNameFromPath,
  serverPath,
  serverReach,
  serverTitle,
} from "./registryApi";
import type { RegistryRemote } from "./types";

describe("registryApiBase", () => {
  test("adds /v0 unless a version is named", () => {
    expect(registryApiBase("https://registry.modelcontextprotocol.io")).toBe("https://registry.modelcontextprotocol.io/v0");
    expect(registryApiBase("https://registry.modelcontextprotocol.io/")).toBe("https://registry.modelcontextprotocol.io/v0");
    expect(registryApiBase("https://example.com/api/v0.1/")).toBe("https://example.com/api/v0.1");
  });
});

describe("templates", () => {
  test("placeholders are found once each", () => {
    expect(placeholders("https://{tenant}.example.com/{tenant}/mcp?k={key}")).toEqual(["tenant", "key"]);
  });
  test("fillTemplate keeps unknown ones", () => {
    expect(fillTemplate("Bearer {api_key} {other}", { api_key: "abc" })).toBe("Bearer abc {other}");
  });
});

const smithery: RegistryRemote = {
  type: "streamable-http",
  url: "https://{region}.example.com/mcp",
  variables: { region: { description: "Where", default: "eu" } },
  headers: [
    { name: "Authorization", value: "Bearer {smithery_api_key}", isSecret: true, isRequired: true },
    { name: "X-Fixed", value: "yes" },
    { name: "X-Team", description: "Your team" },
  ],
};

describe("installFields / resolveInstall", () => {
  test("asks for URL variables, header variables and bare headers", () => {
    const fields = installFields(smithery);
    expect(fields.map((f) => f.key)).toEqual(["url:region", "header:Authorization:smithery_api_key", "header:X-Team"]);
    expect(fields[0].defaultValue).toBe("eu");
    expect(fields[1].secret).toBe(true);
    expect(fields[1].required).toBe(true);
    expect(fields[2].required).toBe(false);
  });

  test("fills them in and leaves empty headers out", () => {
    const { url, headers } = resolveInstall(smithery, { "url:region": "us", "header:Authorization:smithery_api_key": " k1 " });
    expect(url).toBe("https://us.example.com/mcp");
    expect(headers).toEqual({ Authorization: "Bearer k1", "X-Fixed": "yes" });
  });

  test("missingFields lists the required empty ones", () => {
    expect(missingFields(installFields(smithery), { "url:region": "eu" }).map((f) => f.key)).toEqual(["header:Authorization:smithery_api_key"]);
  });
});

describe("servers", () => {
  test("reach", () => {
    expect(serverReach({ name: "a/b", remotes: [{ type: "streamable-http", url: "https://x/mcp" }] })).toBe("remote");
    expect(serverReach({ name: "a/b", remotes: [{ type: "sse", url: "https://x/sse" }] })).toBe("sse");
    expect(serverReach({ name: "a/b", packages: [{ registryType: "npm" }] })).toBe("local");
    expect(serverReach({ name: "a/b" })).toBe("none");
  });
  test("title falls back to the last part of the name", () => {
    expect(serverTitle({ name: "io.github.acme/weather" })).toBe("weather");
    expect(serverTitle({ name: "io.github.acme/weather", title: "Weather" })).toBe("Weather");
  });
  test("paths round-trip", () => {
    const path = serverPath("io.github.acme/weather mcp");
    expect(path).toBe("/service-finder/servers/io.github.acme/weather%20mcp");
    expect(serverNameFromPath(path)).toBe("io.github.acme/weather mcp");
    expect(serverNameFromPath("/service-finder")).toBeNull();
  });
  test("compareVersions", () => {
    expect(compareVersions("1.10.0", "1.9.2")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });
});
