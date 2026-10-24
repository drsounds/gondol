import { describe, expect, test } from "bun:test";
import { agentThreadContext, type ThreadRow } from "../../../../supabase/functions/_shared/agentPrompt.ts";

const at = (minute: number) => `2026-10-24T12:${String(minute).padStart(2, "0")}:00Z`;
const rows: ThreadRow[] = [
  { id: "q", parent_id: null, created_at: at(1), soft_deleted_at: null },
  { id: "a", parent_id: null, created_at: at(2), soft_deleted_at: null },
  { id: "r", parent_id: "a", created_at: at(3), soft_deleted_at: null },
  { id: "x", parent_id: "a", created_at: at(4), soft_deleted_at: at(5) },
  { id: "s", parent_id: "a", created_at: at(6), soft_deleted_at: null },
  { id: "later", parent_id: null, created_at: at(7), soft_deleted_at: null },
];

describe("agentThreadContext", () => {
  test("an agent answering on the conversation's line reads it, without threads", () => {
    expect(agentThreadContext(rows, null).map((m) => m.id)).toEqual(["q", "a", "later"]);
  });
  test("in a thread it reads the way there and the thread, not what came after on the line", () => {
    expect(agentThreadContext(rows, "a").map((m) => m.id)).toEqual(["q", "a", "r", "s"]);
  });
  test("writing an answer again stops before it", () => {
    expect(agentThreadContext(rows, "a", "s").map((m) => m.id)).toEqual(["q", "a", "r"]);
    expect(agentThreadContext(rows, null, "a").map((m) => m.id)).toEqual(["q"]);
  });
});
