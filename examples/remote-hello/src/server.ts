import type { AppFunctionContext } from "gondol/runtime/server";

/** `functions.greet` of the manifest: runs on the apps runtime, called by the host's app router (or, in dev, the browser). */
export async function greet(input: { name?: string }, ctx: AppFunctionContext) {
  const name = input.name?.trim() || "there";
  if (name.length > 80) throw Object.assign(new Error("That name is too long"), { status: 422 });
  return { text: `Hello, ${name}!`, user: ctx.userId };
}
