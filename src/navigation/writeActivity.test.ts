import { expect, test } from "bun:test";
import { getWriteActivity, isTrackedWrite, trackWrite } from "./writeActivity";

test("only requests that change data are tracked", () => {
  const rest = "https://x.supabase.co/rest/v1/ideas?id=eq.1";
  expect(isTrackedWrite("GET", rest)).toBe(false);
  expect(isTrackedWrite("HEAD", rest)).toBe(false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "patch"]) expect(isTrackedWrite(method, rest)).toBe(true);
  expect(isTrackedWrite("POST", "https://x.supabase.co/storage/v1/object/media/a.png")).toBe(true);
  // RPCs are POSTs even for reads (their writes run as mutations); sign-in isn't a data write.
  expect(isTrackedWrite("POST", "https://x.supabase.co/rest/v1/rpc/calendar_list")).toBe(false);
  expect(isTrackedWrite("POST", "https://x.supabase.co/auth/v1/token?grant_type=refresh_token")).toBe(false);
});

test("a write counts while it is in flight, also when it fails", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => (finish = resolve));
  const tracked = trackWrite("POST", "https://x.supabase.co/rest/v1/ideas", pending);
  expect(getWriteActivity()).toBe(1);
  finish();
  await tracked;
  await Promise.resolve();
  expect(getWriteActivity()).toBe(0);

  const failing = trackWrite("DELETE", "https://x.supabase.co/rest/v1/ideas", Promise.reject(new Error("offline")));
  expect(getWriteActivity()).toBe(1);
  await failing.catch(() => {});
  await Promise.resolve();
  expect(getWriteActivity()).toBe(0);

  await trackWrite("GET", "https://x.supabase.co/rest/v1/ideas", Promise.resolve());
  expect(getWriteActivity()).toBe(0);
});
