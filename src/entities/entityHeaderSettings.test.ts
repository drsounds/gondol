import { describe, expect, test } from "bun:test";
import { resolveEntityHeader, sanitizeEntityHeaderOverride, sanitizeEntityHeaderTypes } from "./entityHeaderSettings";

describe("resolveEntityHeader", () => {
  test("defaults to the standard layout with subjects by screen size", () => {
    expect(resolveEntityHeader({ type: "release", own: {}, site: null })).toEqual({ layout: "standard", subjects: "auto", hideArt: false });
  });

  test("the most specific level wins: entity, own type, site type, own global, site global", () => {
    const site = { headerLayout: "standard" as const, entityHeaders: { release: { subjects: "byline" as const } } };
    const own = { headerLayout: "vertical" as const, entityHeaders: { book: { layout: "standard" as const } } };
    expect(resolveEntityHeader({ type: "release", own, site }).layout).toBe("vertical");
    expect(resolveEntityHeader({ type: "release", own, site }).subjects).toBe("byline");
    expect(resolveEntityHeader({ type: "book", own, site }).layout).toBe("standard");
    expect(resolveEntityHeader({ type: "book", own, site, entity: { layout: "vertical", hideArt: true } })).toEqual({
      layout: "vertical",
      subjects: "auto",
      hideArt: true,
    });
  });

  test("a site lock wins over the visitor and the entity", () => {
    const site = { headerLayout: "vertical" as const, locked: ["headerLayout" as const] };
    expect(resolveEntityHeader({ type: "release", own: { headerLayout: "standard" }, site, entity: { layout: "standard" } }).layout).toBe("vertical");
    const typed = { entityHeaders: { release: { layout: "standard" as const } }, headerLayout: "vertical" as const, locked: ["entityHeaders" as const] };
    expect(resolveEntityHeader({ type: "release", own: { headerLayout: "vertical" }, site: typed }).layout).toBe("standard");
    // Types the locked map leaves out are still the visitor's.
    expect(resolveEntityHeader({ type: "book", own: { headerLayout: "standard" }, site: typed }).layout).toBe("standard");
  });
});

describe("sanitizing stored settings", () => {
  test("drops anything malformed", () => {
    expect(sanitizeEntityHeaderTypes({ a: { layout: "sideways" }, b: { subjects: "sections", x: 1 }, c: "no" })).toEqual({ b: { subjects: "sections" } });
    expect(sanitizeEntityHeaderOverride({ hideArt: "yes" })).toBeNull();
    expect(sanitizeEntityHeaderOverride({ hideArt: true, layout: "vertical" })).toEqual({ hideArt: true, layout: "vertical" });
  });
});
