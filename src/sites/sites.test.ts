import { describe, expect, test } from "bun:test";
import { siteBrowserMetadata } from "./sites";

describe("site browser metadata", () => {
  test("uses the site's name and domain favicon", () => {
    const metadata = siteBrowserMetadata({ name: "  Notes  ", domain: "WWW.Example.com/path" });

    expect(metadata?.title).toBe("Notes");
    expect(new URL(metadata!.faviconUrl!).searchParams.get("domain_url")).toBe("https://example.com");
  });

  test("falls back to the domain when the site has no name", () => {
    expect(siteBrowserMetadata({ name: " ", domain: "example.com" })?.title).toBe("example.com");
  });

  test("returns no metadata without a site", () => {
    expect(siteBrowserMetadata(null)).toBeNull();
  });
});
