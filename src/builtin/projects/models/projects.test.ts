import { describe, expect, test } from "bun:test";
import { projectSlug } from "./projects";

describe("project model helpers", () => {
  test("normalizes project names into slugs", () => {
    expect(projectSlug("My First Project")).toBe("my-first-project");
    expect(projectSlug("Café & Notes")).toBe("cafe-notes");
    expect(projectSlug("🎨")).toBe("project");
  });
});
