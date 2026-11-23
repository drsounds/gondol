import { describe, expect, test } from "bun:test";
import { availableOAuthScopes } from "./oauth";

describe("OAuth credential scopes", () => {
  test("offers only the account, site and workspace targets that exist", () => {
    expect(availableOAuthScopes({ user: "user-1", site: "site-1", workspace: "workspace-1" })).toEqual([
      { scope: "user", scopeId: "user-1" },
      { scope: "site", scopeId: "site-1" },
      { scope: "workspace", scopeId: "workspace-1" },
    ]);
  });

  test("returns no targets when there is no active account or context", () => {
    expect(availableOAuthScopes({ user: null, site: null, workspace: null })).toEqual([]);
  });
});
