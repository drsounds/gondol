// Builds an app package for the gondol apps runtime (`gondol-apps build`): its client source into
// ES modules that take React, gondol and the other shared packages from the host
// (gondol/vite/remoteApp), and its server source into one Node module.
//
//   dist/client.mjs        package.json "gondol.client"   (lazy pages become dist/chunks/*.mjs)
//   dist/client.css        "gondol.styles", when the client has styles
//   dist/server.mjs        "gondol.server", when there's "gondol.source.server"
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAppPackage } from "./server.mjs";

export async function buildAppPackage(dir, { logLevel = "info" } = {}) {
  const app = loadAppPackage(dir);
  if (!app.source.client) throw new Error(`${app.dir}: package.json names no client source ("gondol.source.client")`);
  const { build } = await import("vite");
  const { gondolRemoteApp } = await import("../vite/remoteApp.mjs");
  const outDir = join(app.dir, "dist");

  await build({
    root: app.dir,
    configFile: false,
    logLevel,
    plugins: [gondolRemoteApp({ root: app.dir })],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      emptyOutDir: true,
      target: "es2022",
      sourcemap: true,
      cssCodeSplit: false,
      lib: { entry: app.source.client, formats: ["es"], fileName: () => "client.mjs", cssFileName: "client" },
      rolldownOptions: { output: { chunkFileNames: "chunks/[name]-[hash].mjs" } },
    },
  });

  if (app.source.server) {
    await build({
      root: app.dir,
      configFile: false,
      logLevel,
      build: {
        outDir,
        emptyOutDir: false,
        target: "node20",
        ssr: app.source.server,
        rolldownOptions: { output: { entryFileNames: "server.mjs", format: "es" } },
      },
    });
  }

  const outputs = { client: join(outDir, "client.mjs"), styles: existsSync(join(outDir, "client.css")) ? [join(outDir, "client.css")] : [], server: app.source.server ? join(outDir, "server.mjs") : null };
  const expect = (name, built, declared) => {
    if (built && declared !== built) console.warn(`gondol-apps: ${app.id}: package.json "gondol.${name}" should be "./${built.slice(app.dir.length + 1)}"`);
  };
  expect("client", outputs.client, app.client);
  expect("server", outputs.server, app.server);
  return { app, outputs };
}
