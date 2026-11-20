import { describe, expect, test } from "bun:test";
import { moveBlock, placeShown, settle } from "./itemOrder";
import { pastedTokens, recallCopied, rememberCopied } from "./clipboard";

const items = (ids: string) => ids.split("").map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((i) => i.id).join("");

describe("settle", () => {
  test("restores the list and keeps items added since at the end", () => {
    // Removing c (abc → ab), then d was added elsewhere; undo brings c back in its place.
    expect(ids(settle(items("abd"), items("ab"), items("abc")))).toBe("abcd");
  });
  test("drops what the step added", () => {
    expect(ids(settle(items("axb"), items("axb"), items("ab")))).toBe("ab");
  });
});

describe("placeShown", () => {
  test("keeps hidden items in their places", () => {
    // h is hidden; the shown a, b, c become c, a, b.
    expect(ids(placeShown(items("ahbc"), items("abc"), items("cab")))).toBe("chab");
  });
  test("drops removed and appends added items", () => {
    expect(ids(placeShown(items("ahb"), items("ab"), items("b")))).toBe("bh");
    expect(ids(placeShown(items("ah"), items("a"), items("axy")))).toBe("ahxy");
  });
});

describe("moveBlock", () => {
  test("moves a selection as a block", () => {
    expect(ids(moveBlock(items("abcde"), new Set(["c", "d"]), -1))).toBe("acdbe");
    expect(ids(moveBlock(items("abcde"), new Set(["b", "c"]), 1))).toBe("adbce");
  });
  test("stops at the ends", () => {
    expect(ids(moveBlock(items("abc"), new Set(["a", "b"]), -1))).toBe("abc");
    expect(ids(moveBlock(items("abc"), new Set(["c"]), 1))).toBe("abc");
  });
});

describe("clipboard", () => {
  test("splits pasted text into URIs", () => {
    expect(pastedTokens("spacify:link:1\n https://a.se/x  <https://b.se>\r\n")).toEqual(["spacify:link:1", "https://a.se/x", "https://b.se"]);
  });
  test("recognises its own copy, and a cut only once", () => {
    const row = { id: "1", playlist_id: "p", uri: "spacify:idea:1", title: null, position: 0, added_at: "2026-01-01T00:00:00Z", custom_added_on: null };
    const text = rememberCopied([row], "p");
    expect(recallCopied("other")).toBeNull();
    expect(recallCopied(`${text}\n`)?.cutFrom).toBe("p");
    expect(recallCopied(text)?.cutFrom).toBeNull();
  });
});
