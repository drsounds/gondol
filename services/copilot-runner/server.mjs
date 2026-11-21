import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotClient, RuntimeConnection } from "@microsoft/copilot-sdk";

const port = Number(process.env.PORT ?? 8000);
const workspaceRoot = await realpath(process.env.COPILOT_WORKSPACE_ROOT ?? "/workspace");
const serviceToken = process.env.COPILOT_RUNNER_TOKEN;
const runtimeToken = process.env.COPILOT_RUNTIME_TOKEN;
const maxBodyBytes = 1_000_000;
const maxOutputBytes = 256_000;
const maxFileBytes = 25 * 1024 * 1024;
const commands = new Map();
const copilotJobs = new Map();

if (!serviceToken) throw new Error("COPILOT_RUNNER_TOKEN is required");
delete process.env.COPILOT_RUNNER_TOKEN;
delete process.env.COPILOT_RUNTIME_TOKEN;

function authorized(request) {
  const [scheme, token, extra] = (request.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !token || extra) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(serviceToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function workspacePath(value, mustExist = false) {
  if (typeof value !== "string" || !value || !isAbsolute(value)) throw Object.assign(new Error("Path must be absolute"), { status: 400 });
  const path = resolve(value);
  const canonicalRoot = await realpath(workspaceRoot);
  const inside = (candidate) => {
    const rel = relative(canonicalRoot, candidate);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (!inside(path)) throw Object.assign(new Error("Path is outside the configured workspace"), { status: 403 });
  let existing = path;
  while (true) {
    try {
      const canonical = await realpath(existing);
      if (!inside(canonical)) throw Object.assign(new Error("Path resolves outside the configured workspace"), { status: 403 });
      if (mustExist) {
        const info = await stat(canonical);
        if (!info.isDirectory()) throw Object.assign(new Error("Working directory must be a directory"), { status: 400 });
        return canonical;
      }
      return path;
    } catch (error) {
      if (error?.code !== "ENOENT" || existing === canonicalRoot) throw error;
      existing = dirname(existing);
      if (!inside(existing)) throw Object.assign(new Error("Path resolves outside the configured workspace"), { status: 403 });
    }
  }
}

function commandResult(command) {
  return {
    command_id: command.id,
    exit_code: command.exitCode,
    running: command.exitCode === null,
    stdout: command.stdout,
    stderr: command.stderr,
  };
}

function appendOutput(command, key, chunk) {
  command[key] = (command[key] + chunk.toString("utf8")).slice(-maxOutputBytes);
}

async function runCommand(input) {
  if (typeof input.command !== "string" || !input.command.trim()) throw Object.assign(new Error("A command is required"), { status: 400 });
  const cwd = await workspacePath(input.cwd, true);
  const timeoutSeconds = Math.max(5, Math.min(3600, Math.round(Number(input.timeoutSeconds) || 600)));
  if (commands.size >= 1000) {
    const oldest = commands.keys().next().value;
    if (oldest) commands.delete(oldest);
  }
  const command = { id: randomUUID(), stdout: "", stderr: "", exitCode: null, process: null };
  const child = spawn("bash", ["-lc", input.command], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: workspaceRoot,
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  command.process = child;
  commands.set(command.id, command);
  child.stdout.on("data", (chunk) => appendOutput(command, "stdout", chunk));
  child.stderr.on("data", (chunk) => appendOutput(command, "stderr", chunk));
  child.on("error", (error) => {
    command.stderr += `\n${error.message}`;
    command.exitCode = 127;
  });
  child.on("close", (code) => {
    command.exitCode = code ?? 1;
    command.process = null;
    command.finishedAt = Date.now();
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutSeconds * 1000);
  child.once("close", () => clearTimeout(timer));
  return command;
}

function runtimeConnection() {
  const mode = process.env.COPILOT_RUNTIME_MODE ?? "inprocess";
  if (mode === "tcp") {
    const url = new URL(process.env.COPILOT_RUNTIME_URL ?? "");
    if (url.protocol !== "tcp:" || !url.hostname || !url.port) throw new Error("COPILOT_RUNTIME_URL must be tcp://host:port");
    return RuntimeConnection.forTcp(url.hostname, Number(url.port), { connectionToken: runtimeToken });
  }
  if (mode === "inprocess" || mode === "spawned") return { mode };
  throw new Error("COPILOT_RUNTIME_MODE must be inprocess, spawned, or tcp");
}

async function runCopilot(input) {
  if (process.env.COPILOT_ALLOW_ALL !== "true") throw Object.assign(new Error("The operator has not enabled Copilot tool execution"), { status: 503 });
  if (typeof input.prompt !== "string" || !input.prompt.trim()) throw Object.assign(new Error("A prompt is required"), { status: 400 });
  if (typeof input.githubToken !== "string" || !input.githubToken.trim()) throw Object.assign(new Error("A GitHub OAuth token is required"), { status: 401 });
  const workingDirectory = await workspacePath(input.cwd, true);
  const runtimeMode = runtimeConnection();
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "gondol-copilot-"));
  const runtime =
    runtimeMode.mode === "inprocess"
      ? RuntimeConnection.forInProcess({ baseDirectory: runtimeDirectory })
      : runtimeMode.mode === "spawned"
        ? RuntimeConnection.forSpawnedStdio({ baseDirectory: runtimeDirectory })
        : runtimeMode;
  let client;
  try {
    client = new CopilotClient({
      mode: "coding-agent",
      runtime,
    });
    await client.start();
    const session = await client.createSession({
      model: typeof input.model === "string" ? input.model : undefined,
      workingDirectory,
      filesystem: { trustWorkingDirectory: "session" },
      github: {
        tokenProvider: async () => ({ kind: "token", accessToken: input.githubToken, expiresIn: 8 * 60 * 60 }),
      },
      permissions: { mode: "allow-all" },
    });
    try {
      const message = await session.sendAndWait({ prompt: input.prompt }, 15 * 60 * 1000);
      return { session_id: session.sessionId, content: message?.data?.content ?? "" };
    } finally {
      await session.disconnect();
    }
  } finally {
    try {
      await client?.stop();
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  }
}

function startCopilotJob(input) {
  if (process.env.COPILOT_ALLOW_ALL !== "true") throw Object.assign(new Error("The operator has not enabled Copilot tool execution"), { status: 503 });
  if (copilotJobs.size >= 1000) {
    const finished = [...copilotJobs.values()].find((job) => !job.running);
    if (!finished) throw Object.assign(new Error("The Copilot runner is busy"), { status: 503 });
    copilotJobs.delete(finished.id);
  }
  const job = { id: randomUUID(), running: true, sessionId: undefined, content: undefined, error: undefined };
  copilotJobs.set(job.id, job);
  void runCopilot(input).then(
    (result) => {
      job.sessionId = result.session_id;
      job.content = result.content;
      job.running = false;
      setTimeout(() => copilotJobs.delete(job.id), 60 * 60_000).unref();
    },
    (error) => {
      job.error = error?.message ?? "Copilot failed to complete the prompt";
      job.running = false;
      setTimeout(() => copilotJobs.delete(job.id), 60 * 60_000).unref();
    },
  );
  return job;
}

async function waitForJob(job, waitMs) {
  const deadline = Date.now() + waitMs;
  while (job.running && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(250, deadline - Date.now())));
}

function jobResult(job) {
  return {
    job_id: job.id,
    running: job.running,
    ...(job.sessionId ? { session_id: job.sessionId } : {}),
    ...(job.content !== undefined ? { content: job.content } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

async function handle(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/healthz") return json(response, 200, { ok: true });
  if (!authorized(request)) return json(response, 401, { error: "Unauthorized" });
  try {
    if (request.method === "POST" && url.pathname === "/v1/sandbox/commands") {
      const input = await body(request);
      const command = await runCommand(input);
      const waitMs = Math.max(0, Math.min(110_000, Number(input.waitMs) || 0));
      if (waitMs) await waitFor(command, waitMs);
      return json(response, 200, commandResult(command));
    }
    const commandMatch = /^\/v1\/sandbox\/commands\/([0-9a-f-]+)$/.exec(url.pathname);
    if (request.method === "GET" && commandMatch) {
      const command = commands.get(commandMatch[1]);
      if (!command) return json(response, 404, { error: "Command not found" });
      await waitFor(command, Math.max(0, Math.min(110_000, Number(url.searchParams.get("waitMs")) || 0)));
      return json(response, 200, commandResult(command));
    }
    if (url.pathname === "/v1/sandbox/files" && request.method === "GET") {
      const path = await workspacePath(url.searchParams.get("path"));
      try {
        if ((await stat(path)).size > maxFileBytes) return json(response, 413, { error: "File is too large" });
        return json(response, 200, { content: (await readFile(path)).toString("base64") });
      } catch (error) {
        if (error?.code === "ENOENT") return json(response, 404, { error: "File not found" });
        throw error;
      }
    }
    if (url.pathname === "/v1/sandbox/files" && request.method === "PUT") {
      const path = await workspacePath(url.searchParams.get("path"));
      await mkdir(dirname(path), { recursive: true });
      const temporaryPath = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
      try {
        let size = 0;
        const limit = new Transform({
          transform(chunk, _encoding, callback) {
            size += chunk.length;
            callback(size > maxBodyBytes ? Object.assign(new Error("File is too large"), { status: 413 }) : null, chunk);
          },
        });
        await pipeline(request, limit, createWriteStream(temporaryPath, { flags: "wx" }));
        const info = await stat(temporaryPath);
        if (info.size > maxFileBytes) throw Object.assign(new Error("File is too large"), { status: 413 });
        await rename(temporaryPath, path);
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
      response.writeHead(204, { "cache-control": "no-store" });
      return response.end();
    }
    if (request.method === "POST" && url.pathname === "/v1/agent") {
      return json(response, 202, jobResult(startCopilotJob(await body(request))));
    }
    const jobMatch = /^\/v1\/agent\/jobs\/([0-9a-f-]+)$/.exec(url.pathname);
    if (request.method === "GET" && jobMatch) {
      const job = copilotJobs.get(jobMatch[1]);
      if (!job) return json(response, 404, { error: "Job not found" });
      await waitForJob(job, Math.max(0, Math.min(110_000, Number(url.searchParams.get("waitMs")) || 0)));
      return json(response, 200, jobResult(job));
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    if (!response.headersSent) json(response, error.status ?? 500, { error: error.message ?? "Request failed" });
    else response.destroy(error);
  }
}

function waitFor(command, waitMs) {
  if (!waitMs || command.exitCode !== null) return Promise.resolve();
  return new Promise((resolveWait) => {
    const timeout = setTimeout(resolveWait, waitMs);
    command.process?.once("close", () => {
      clearTimeout(timeout);
      resolveWait();
    });
  });
}

createServer((request, response) => void handle(request, response)).listen(port, "0.0.0.0");
