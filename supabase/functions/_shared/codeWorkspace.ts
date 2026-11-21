// Agentic coding for the agents app (src/builtin/agents): what an agent is told about the workspace
// its conversation is connected to, and the small pure helpers the `agent-code` edge function uses
// (paths, shell quoting, a new gondol app's files, a published release's index). Shared by the
// browser runner, the ai-agents edge function and agent-code, so plain TypeScript without imports.
//
// Usually the model keeps running through the agents app's runners and coding is a set of its MCP
// tools (`agents__code_*`), answered by agent-code through the workspace's execution provider.
// OpenHands is a shell/file backend; the Copilot runner can also drive a Copilot SDK coding session.

/** How many tool rounds a run gets when its conversation has a workspace (coding takes many steps). */
export const CODING_TOOL_ROUNDS = 40;

/** The repositories of a workspace, as an agent is told about them. */
export interface PromptWorkspaceRepository {
  full_name: string | null;
  name: string;
  path: string;
  branch: string | null;
  cloned: boolean;
}

export interface PromptWorkspace {
  id: string;
  title: string | null;
  root_path: string;
  status: string;
  repositories: PromptWorkspaceRepository[];
  projects?: { id: string; name: string; slug: string }[];
  /** The live sandbox's address when the gondol app dev runtime is running. */
  sandbox_url?: string | null;
}

/** What the agent is told about the workspace its conversation is connected to. */
export function codeWorkspacePrompt(ws: PromptWorkspace): string {
  const lines = [
    `This conversation is connected to a coding workspace${ws.title ? ` ("${ws.title}")` : ""}: a sandbox with a shell, git and Node, at ${ws.root_path}. Its id is ${ws.id}: pass it as \`workspace\` to the agents app's code tools (agents__code_*).`,
  ];
  if (ws.projects?.length) lines.push(`This workspace is connected to project${ws.projects.length === 1 ? "" : "s"}: ${ws.projects.map((project) => `${project.name} (${project.id})`).join(", ")}.`);
  if (ws.repositories.length) {
    lines.push("Repositories in it:");
    for (const repo of ws.repositories) {
      lines.push(`- ${repo.full_name ?? repo.name} at ${repo.path}${repo.branch ? ` (branch ${repo.branch})` : ""}${repo.cloned ? "" : " (not cloned yet: agents__code_setup_workspace clones it)"}`);
    }
  } else {
    lines.push("No repository is connected yet: create one with agents__code_create_repository, or ask the user to connect one.");
  }
  if (ws.sandbox_url) lines.push(`A gondol app is running in the live sandbox at ${ws.sandbox_url}; the user sees it in their own app as they try it.`);
  lines.push(
    "Work like a careful developer: look before you change (list and read files), make focused edits, run the project's checks (tests, type checks, build) and read their output, then commit and push to a branch with agents__code_commit_and_push. Use the GitHub tools (if the user connected the GitHub MCP server) for issues and pull requests. A command still running after the tool's wait comes back with its command_id: read the rest with agents__code_command_output. Say what you did and what is left when you answer.",
    "To build a new app for gondol, scaffold one with agents__code_scaffold_app, try it in the live sandbox with agents__code_start_sandbox (the user's app loads it on their device while it runs) and, when it works, build a release with agents__code_prepare_release. Publishing it into the apps registry is the user's: they press Publish.",
  );
  return lines.join("\n");
}

/** Quotes a string for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * A path inside the workspace: `rel` (relative to the root, or absolute under it) normalized, never
 * outside the root. Throws on a path that leaves it.
 */
export function workspacePath(root: string, rel: string | null | undefined): string {
  const base = root.replace(/\/+$/, "");
  let path = (rel ?? "").trim();
  if (!path || path === "." || path === "/") return base;
  if (path.startsWith("/")) {
    if (path !== base && !path.startsWith(`${base}/`)) throw new Error(`${path} is outside the workspace (${base})`);
    path = path.slice(base.length);
  }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error(`${rel} is outside the workspace (${base})`);
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? `${base}/${parts.join("/")}` : base;
}

/** The repository's folder name in a workspace: its name, lower-case, safe for a path. */
export function repositoryFolder(name: string): string {
  const folder = name
    .trim()
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "");
  return folder || "repository";
}

/** `owner/repo` of a GitHub address (https or ssh), or null. */
export function githubFullName(url: string): string | null {
  const match = /github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

/** The sandbox's preview address for a port: the template's `{port}` filled in. */
export function previewAddress(template: string | null | undefined, port: number): string | null {
  if (!template?.trim()) return null;
  return template.trim().replaceAll("{port}", String(port)).replace(/\/+$/, "");
}

/** Parses "5180-5199" (or "5180") into the ports it names. */
export function portRange(spec: string | null | undefined, fallback: [number, number] = [5180, 5199]): number[] {
  const match = /^\s*(\d{2,5})(?:\s*-\s*(\d{2,5}))?\s*$/.exec(spec ?? "");
  const [from, to] = match ? [Number(match[1]), Number(match[2] ?? match[1])] : fallback;
  const ports: number[] = [];
  for (let port = Math.min(from, to); port <= Math.max(from, to) && ports.length < 1000; port++) ports.push(port);
  return ports;
}

/** A manifest id for an app: lower-case letters, digits, `-` and `_`, starting with a letter or digit. */
export function appIdFrom(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 60);
}

/** The text of the last `max` characters of a long output, with a note that the start was cut. */
export function tail(text: string, max: number): string {
  return text.length > max ? `…(${text.length - max} characters cut)\n${text.slice(-max)}` : text;
}

/**
 * A new gondol app package (the remote apps format, docs/guide/remote-apps.md): its files by path,
 * relative to the package's folder. `gondol` is the package spec it builds against.
 */
export function gondolAppFiles(options: { id: string; name: string; description?: string; gondol: string }): Record<string, string> {
  const id = appIdFrom(options.id);
  if (!id) throw new Error("The app needs an id");
  const name = options.name.trim() || id;
  const description = options.description?.trim() || `${name}, a gondol app.`;
  const component = `${id.replace(/(^|[-_])([a-z0-9])/g, (_m, _s, c: string) => c.toUpperCase()).replace(/^[0-9]/, "App$&")}Page`;
  const manifest = {
    id,
    slug: id,
    name: { en: name, sv: name },
    description: { en: description, sv: description },
    iconName: "star",
    defaultFeatureId: id,
    features: [{ id, name: { en: name, sv: name }, path: id, iconName: "star" }],
  };
  const pkg = {
    name: id,
    version: "0.1.0",
    private: true,
    type: "module",
    description,
    scripts: { dev: "gondol-apps dev", build: "gondol-apps build", typecheck: "tsc --noEmit" },
    gondol: {
      manifest: "./manifest.json",
      client: "./dist/client.mjs",
      styles: ["./dist/client.css"],
      source: { client: "./src/index.ts" },
    },
    devDependencies: {
      gondol: options.gondol,
      react: "^19.2.0",
      "react-dom": "^19.2.0",
      "@types/react": "^19.2.0",
      typescript: "^5.9.0",
      vite: "^8.0.16",
    },
  };
  return {
    "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          strict: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          noEmit: true,
          allowImportingTsExtensions: true,
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
    ".gitignore": "node_modules\ndist\n",
    "src/index.ts": `import { defineApp } from "gondol/apps/defineApp";
import manifest from "../manifest.json";
import "./app.css";

export default defineApp({
  manifest,
  pages: { ${JSON.stringify(id)}: () => import("./${component}").then((m) => m.${component}) },
});
`,
    [`src/${component}.tsx`]: `import { Card } from "gondol/design-system/bungalow-79d923";

export function ${component}() {
  return (
    <Card>
      <div className="stack">
        <h2 className="panel-title">${name.replace(/[<>{}]/g, "")}</h2>
        <p className="muted">${description.replace(/[<>{}]/g, "")}</p>
      </div>
    </Card>
  );
}
`,
    "src/app.css": `/* ${name}'s styles: use the host's --bungalow-* tokens so it follows the theme. */\n`,
    "README.md": `# ${name}

${description}

A [gondol](https://github.com/drsounds/gondol) app, loaded by gondol hosts at run time (remote apps).

\`\`\`sh
npm install
npx gondol-apps dev --port 5180   # try it: add http://localhost:5180 as a dev source
npx gondol-apps build             # dist/client.mjs
\`\`\`
`,
  };
}

/** The index (gondol-apps.json) of one published release, next to its files. */
export function releaseIndex(entry: { id: string; version: string; name: string; styles: string[]; client?: string }) {
  return {
    format: "gondol-apps",
    version: 1,
    apps: [{ id: entry.id, version: entry.version, name: entry.name, manifest: "manifest.json", client: entry.client ?? "dist/client.mjs", styles: entry.styles }],
  };
}

/** The content type a published file is served with. */
export function publishedContentType(path: string): string {
  if (/\.m?js$/i.test(path)) return "text/javascript; charset=utf-8";
  if (/\.css$/i.test(path)) return "text/css; charset=utf-8";
  if (/\.(json|map)$/i.test(path)) return "application/json; charset=utf-8";
  if (/\.svg$/i.test(path)) return "image/svg+xml";
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.woff2$/i.test(path)) return "font/woff2";
  return "application/octet-stream";
}
