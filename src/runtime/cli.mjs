#!/usr/bin/env node
// gondol-apps: serves, develops and builds apps that gondol hosts load at run time (remote apps).
//
//   gondol-apps serve [paths…] [--port 8787] [--host 0.0.0.0]   serve built app packages
//   gondol-apps dev   [paths…] [--port 5180]                    serve them from source with Vite
//   gondol-apps build [paths…]                                  build them (dist/client.mjs, dist/server.mjs)
//
// Each path is an app package (a package.json with a "gondol" field) or a folder of them (default:
// the current folder). See docs/guide/remote-apps.md.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findAppPackages, startAppsRuntime } from "./server.mjs";
import { buildAppPackage } from "./build.mjs";

const USAGE = `Usage: gondol-apps <serve|dev|build> [paths…] [--port <n>] [--host <name>]`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, paths: [], port: undefined, host: undefined };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--port" || arg === "-p") options.port = Number(rest[++i]);
    else if (arg.startsWith("--port=")) options.port = Number(arg.slice(7));
    else if (arg === "--host") options.host = rest[++i];
    else if (arg.startsWith("--host=")) options.host = arg.slice(7);
    else if (arg === "--help" || arg === "-h") options.command = "help";
    else options.paths.push(arg);
  }
  if (!options.paths.length) options.paths.push(".");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  switch (options.command) {
    case "serve":
    case "dev": {
      const dev = options.command === "dev";
      const port = options.port ?? Number(process.env.PORT ?? (dev ? 5180 : 8787));
      const runtime = await startAppsRuntime({ paths: options.paths, port, host: options.host ?? (dev ? "localhost" : "0.0.0.0"), dev });
      const shown = runtime.url.replace("0.0.0.0", "localhost");
      console.log(`gondol-apps ${dev ? "dev " : ""}runtime at ${shown}`);
      for (const app of runtime.apps) console.log(`  ${app.id}${app.version ? `@${app.version}` : ""}  ${shown}/apps/${app.id}/`);
      console.log(dev ? `Add ${shown} as a dev source (developer mode) in the host's apps.` : `Index: ${shown}/gondol-apps.json`);
      const stop = () => runtime.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }
    case "build": {
      for (const app of findAppPackages(options.paths)) {
        const { outputs } = await buildAppPackage(app.dir);
        console.log(`gondol-apps: built ${app.id} → ${outputs.client}${outputs.server ? `, ${outputs.server}` : ""}`);
      }
      return;
    }
    default:
      console.log(USAGE);
      process.exitCode = options.command === "help" ? 0 : 1;
  }
}

const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
