import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("authenticated runner confines commands and files to its workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gondol-runner-test-"));
  const outside = await mkdtemp(join(tmpdir(), "gondol-runner-outside-"));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const service = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, PORT: String(port), COPILOT_WORKSPACE_ROOT: root, COPILOT_RUNNER_TOKEN: "test-runner-key", COPILOT_ALLOW_ALL: "false" },
    stdio: "ignore",
  });
  t.after(async () => {
    service.kill("SIGTERM");
    await once(service, "exit").catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (service.exitCode !== null) throw new Error("Runner exited before becoming ready");
    try {
      ready = (await fetch(`${base}/healthz`)).ok;
      if (ready) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);

  const unauthorized = await fetch(`${base}/v1/sandbox/commands`, { method: "POST" });
  assert.equal(unauthorized.status, 401);

  const headers = { Authorization: ["Bearer", "test-runner-key"].join(" "), "Content-Type": "application/json" };
  const command = await fetch(`${base}/v1/sandbox/commands`, {
    method: "POST",
    headers,
    body: JSON.stringify({ command: "printf runner-ok", cwd: root, waitMs: 1000 }),
  });
  assert.equal(command.status, 200);
  const commandResult = await command.json();
  assert.equal(typeof commandResult.command_id, "string");
  assert.equal(commandResult.exit_code, 0);
  assert.equal(commandResult.running, false);
  assert.equal(commandResult.stdout, "runner-ok");
  assert.equal(commandResult.stderr, "");

  const escapedCommand = await fetch(`${base}/v1/sandbox/commands`, {
    method: "POST",
    headers,
    body: JSON.stringify({ command: "pwd", cwd: outside }),
  });
  assert.equal(escapedCommand.status, 403);

  const filePath = join(root, "nested", "file.txt");
  const upload = await fetch(`${base}/v1/sandbox/files?path=${encodeURIComponent(filePath)}`, {
    method: "PUT",
    headers: { Authorization: ["Bearer", "test-runner-key"].join(" "), "Content-Type": "application/octet-stream" },
    body: "saved",
  });
  assert.equal(upload.status, 204);
  assert.equal(await readFile(filePath, "utf8"), "saved");

  const download = await fetch(`${base}/v1/sandbox/files?path=${encodeURIComponent(filePath)}`, {
    headers: { Authorization: ["Bearer", "test-runner-key"].join(" ") },
  });
  assert.equal(Buffer.from((await download.json()).content, "base64").toString("utf8"), "saved");

  const escapedFile = await fetch(`${base}/v1/sandbox/files?path=${encodeURIComponent(join(outside, "secret"))}`, {
    headers: { Authorization: ["Bearer", "test-runner-key"].join(" ") },
  });
  assert.equal(escapedFile.status, 403);

  await mkdir(join(root, "links"));
  await symlink(outside, join(root, "links", "outside"));
  const symlinkFile = await fetch(`${base}/v1/sandbox/files?path=${encodeURIComponent(join(root, "links", "outside", "secret"))}`, {
    headers: { Authorization: ["Bearer", "test-runner-key"].join(" ") },
  });
  assert.equal(symlinkFile.status, 403);

  const disabledCopilot = await fetch(`${base}/v1/agent`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: "test", cwd: root, githubToken: "not-a-real-token" }),
  });
  assert.equal(disabledCopilot.status, 503);
});
