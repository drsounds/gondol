import { describe, expect, test } from "bun:test";
import { isFaviconUrl, siteTitle } from "./siteHead";

describe("siteTitle", () => {
  test("puts the site's name where the app's was", () => {
    expect(siteTitle("Apps — Spacify", "My site", "Spacify")).toBe("Apps — My site");
    expect(siteTitle("Spacify", "My site", "Spacify")).toBe("My site");
  });
  test("leaves other titles alone", () => {
    expect(siteTitle("Wiki – My site", "My site", "Spacify")).toBe("Wiki – My site");
    expect(siteTitle("Apps — Spacify", "", "Spacify")).toBe("Apps — Spacify");
    expect(siteTitle("Apps — Spacify", "My site", "")).toBe("Apps — Spacify");
  });
});

describe("isFaviconUrl", () => {
  test("takes http(s) addresses and paths on this host", () => {
    expect(isFaviconUrl("https://example.com/icon.png")).toBe(true);
    expect(isFaviconUrl("/favicon.ico")).toBe(true);
  });
  test("refuses anything else", () => {
    expect(isFaviconUrl("javascript:alert(1)")).toBe(false);
    expect(isFaviconUrl("//evil.example/icon.png")).toBe(false);
    expect(isFaviconUrl("")).toBe(false);
    expect(isFaviconUrl(null)).toBe(false);
  });
});
