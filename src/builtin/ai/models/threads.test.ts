import { describe, expect, test } from "bun:test";
import { replyCounts, threadAncestors, threadContext, type ThreadedMessage } from "./threads";

// a ─ b ─ c (the conversation's line); b's thread: b1, b2; b1's thread: b1a; c deleted.
const at = (minute: number) => `2026-10-24T12:${String(minute).padStart(2, "0")}:00Z`;
const messages: ThreadedMessage[] = [
  { id: "a", parent_id: null, created_at: at(1) },
  { id: "b", parent_id: null, created_at: at(2) },
  { id: "c", parent_id: null, created_at: at(9), soft_deleted_at: at(10) },
  { id: "b2", parent_id: "b", created_at: at(5) },
  { id: "b1", parent_id: "b", created_at: at(3) },
  { id: "b1a", parent_id: "b1", created_at: at(4) },
];
const ids = (list: ThreadedMessage[]) => list.map((m) => m.id);

describe("threadContext", () => {
  test("the conversation's line leaves threads and deleted messages out", () => {
    expect(ids(threadContext(messages, null))).toEqual(["a", "b"]);
  });
  test("a thread is read after the way to it", () => {
    expect(ids(threadContext(messages, "b"))).toEqual(["a", "b", "b1", "b2"]);
  });
  test("a nested thread stops its parent's thread at the message it hangs on", () => {
    expect(ids(threadContext(messages, "b1"))).toEqual(["a", "b", "b1", "b1a"]);
  });
  test("before and through cut the thread", () => {
    expect(ids(threadContext(messages, "b", { before: "b2" }))).toEqual(["a", "b", "b1"]);
    expect(ids(threadContext(messages, "b", { through: "b1" }))).toEqual(["a", "b", "b1"]);
  });
});

describe("threads", () => {
  test("replies are counted all the way down", () => {
    const counts = replyCounts(messages);
    expect(counts.get("b")).toBe(3);
    expect(counts.get("b1")).toBe(1);
    expect(counts.get("a")).toBe(0);
  });
  test("ancestors run from the conversation's line down", () => {
    expect(ids(threadAncestors(messages, "b1a"))).toEqual(["b", "b1"]);
  });
});
