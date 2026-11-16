// Building an app that a gondol host loads at run time (a remote app, gondol/apps/remote): every
// import of a module the host shares (React, React DOM, TanStack Query and Router, and gondol
// itself) becomes a small shim module that takes the host's own instance from its GondolSystem
// registry (src/apps/remote/system.ts) instead of bundling a copy:
//
//   const m = await globalThis.GondolSystem.import("react");
//   export default m.default;
//   export const useState = m.useState;   // … one line per export
//
// so the build is plain ES modules (.mjs) with no bare imports left, which the host loads with a
// native import(). The same plugin serves the app in `gondol-apps dev` (Vite's dev server), so a
// remote app under development already renders with the host's React.
//
//   // vite.config.ts of an app built by hand (gondol-apps build does this for you)
//   import { gondolRemoteApp } from "gondol/vite/remoteApp";
//   plugins: [gondolRemoteApp()]
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The packages every gondol host shares (src/apps/remote/system.ts keeps the same list). */
export const SHARED_PACKAGES = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "@tanstack/react-query",
  "@tanstack/react-router",
];

const SHIM = "\0gondol-shared:";
const EMPTY = "\0gondol-shared-empty";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Whether the host shares `specifier` (gondol's own modules, apart from build and server code). */
export function isSharedSpecifier(specifier, extra = []) {
  if (SHARED_PACKAGES.includes(specifier) || extra.includes(specifier)) return true;
  if (specifier !== "gondol" && !specifier.startsWith("gondol/")) return false;
  if (/^gondol\/(vite|runtime)(\/|$)/.test(specifier) || specifier === "gondol/api/cli") return false;
  if (/^gondol\/builtin\//.test(specifier) && !/^gondol\/builtin\/[^/]+\/models(\/|$)/.test(specifier)) return false;
  return !/\.[a-z0-9]+$/i.test(specifier) || /\.css$/i.test(specifier);
}

// ── Finding a module's exports ────────────────────────────────────────────────────────────────

/** Whether a `/` after `before` starts a regex literal rather than dividing. */
function regexAllowed(before) {
  const trimmed = before.trimEnd();
  if (!trimmed) return true;
  if (/[(,=:[!&|?{};+\-*%<>~^]$/.test(trimmed)) return true;
  return /\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(trimmed);
}

/** Source without comments and template literals, so code examples in them aren't taken for exports. */
export function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      out += " ";
      continue;
    }
    if (c === "/" && regexAllowed(out)) {
      // A regex literal: skip it (with its character classes), so quotes and backticks in it don't count.
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== "\n") {
        if (source[j] === "\\") j += 2;
        else if (source[j] === "[") (inClass = true), j++;
        else if (source[j] === "]") (inClass = false), j++;
        else if (source[j] === "/" && !inClass) break;
        else j++;
      }
      if (source[j] === "/") {
        out += "/r/";
        i = j + 1;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      // Strings stay (module specifiers are read back from them), template literals go. Plain
      // strings end at a line break, so a quote inside a regex literal can't swallow the file.
      let j = i + 1;
      let body = "";
      while (j < n && source[j] !== c) {
        if (source[j] === "\\") {
          body += source.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (c !== "`" && source[j] === "\n") break;
        body += source[j];
        j++;
      }
      out += c + (c === "`" ? " " : body) + (source[j] === c ? c : "");
      i = source[j] === c ? j + 1 : j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function resolveModuleFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx"), join(base, "index.js")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The names a TypeScript or JavaScript module exports at run time (types left out), following `export *`. */
export function scanExports(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
  const names = new Set();
  const add = (name) => IDENTIFIER.test(name) && names.add(name);
  if (/\bexport\s+default\b/.test(code)) names.add("default");
  for (const m of code.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) {
    if (!/declare\s/.test(m[0])) add(m[1]);
  }
  for (const m of code.matchAll(/\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bexport\s+enum\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bexport\s+(?:const|let|var)\s+(?!enum\b)([A-Za-z_$][\w$]*|\{[^}]*\}|\[[^\]]*\])/g)) {
    const target = m[1];
    if (target.startsWith("{") || target.startsWith("[")) {
      for (const part of target.slice(1, -1).split(",")) {
        const name = part.split(":").pop().split("=")[0].replace("...", "").trim();
        add(name);
      }
    } else add(target);
  }
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const entry = part.trim();
      if (!entry || /^type\s/.test(entry)) continue;
      const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(entry);
      add(alias ? alias[1] : entry);
    }
  }
  for (const m of code.matchAll(/\bexport\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\b/g)) add(m[1]);
  for (const m of code.matchAll(/\bexport\s*\*\s*from\s*(["'])([^"']+)\1/g)) {
    const spec = m[2];
    if (!spec.startsWith(".")) continue;
    const target = resolveModuleFile(resolve(dirname(file), spec));
    if (!target) continue;
    for (const name of scanExports(target, seen)) if (name !== "default") names.add(name);
  }
  return names;
}

/** The file of a `gondol/…` module in the gondol package at `gondolDir`, from its package.json exports. */
export function gondolModuleFile(gondolDir, specifier) {
  const pkg = JSON.parse(readFileSync(join(gondolDir, "package.json"), "utf8"));
  const subpath = specifier === "gondol" ? "." : `./${specifier.slice("gondol/".length)}`;
  const target = pkg.exports?.[subpath];
  const path = typeof target === "string" ? target : target?.default;
  if (path) return join(gondolDir, path);
  return resolveModuleFile(join(gondolDir, "src", subpath === "." ? "index" : subpath.slice(2)));
}

/** A shared package's export names, by loading it in Node from the app's own node_modules. */
async function packageExports(root, specifier) {
  const require = createRequire(join(root, "package.json"));
  const namespace = await import(pathToFileURL(require.resolve(specifier)).href);
  return new Set(Object.keys(namespace).filter((name) => IDENTIFIER.test(name)));
}

/** The source of the shim module standing in for `specifier`. */
export function shimSource(specifier, names) {
  const lines = [
    `const g = globalThis.GondolSystem;`,
    `if (!g) throw new Error("This app runs inside a gondol host (GondolSystem is missing): ${specifier}");`,
    `const m = await g.import(${JSON.stringify(specifier)});`,
  ];
  if (names.has("default")) lines.push(`export default m.default;`);
  for (const name of [...names].filter((name) => name !== "default").sort()) lines.push(`export const ${name} = m[${JSON.stringify(name)}];`);
  return `${lines.join("\n")}\n`;
}

/**
 * The plugin. `shared`: modules the host shares on top of gondol's (registerSharedModules), each
 * with its export names. `root`: where the app's package.json is (default: Vite's root).
 */
export function gondolRemoteApp(options = {}) {
  const extra = options.shared ?? {};
  const extraSpecifiers = Object.keys(extra);
  let root = options.root ?? process.cwd();
  const cache = new Map();

  const gondolDir = () => {
    const require = createRequire(join(root, "package.json"));
    return dirname(require.resolve("gondol/package.json"));
  };

  async function exportsOf(specifier) {
    if (cache.has(specifier)) return cache.get(specifier);
    let names;
    if (extra[specifier]) names = new Set(extra[specifier]);
    else if (SHARED_PACKAGES.includes(specifier)) names = await packageExports(root, specifier);
    else {
      const file = gondolModuleFile(gondolDir(), specifier);
      if (!file) throw new Error(`gondol-remote-app: no module "${specifier}" in gondol`);
      names = scanExports(file);
    }
    cache.set(specifier, names);
    return names;
  }

  return {
    name: "gondol-remote-app",
    enforce: "pre",
    config(config) {
      if (!options.root && config.root) root = resolve(config.root);
      return {
        // React's automatic runtime, from the host's react/jsx-runtime (shared).
        oxc: { jsx: { runtime: "automatic", importSource: "react", development: false } },
        // The shims wait for the host's modules (top-level await).
        build: { target: "es2022" },
        optimizeDeps: { exclude: [...SHARED_PACKAGES, "gondol", ...extraSpecifiers] },
      };
    },
    resolveId(source) {
      if (!isSharedSpecifier(source, extraSpecifiers)) return null;
      // The host has gondol's stylesheets on the page already.
      if (/\.css$/i.test(source)) return EMPTY;
      return `${SHIM}${source}`;
    },
    async load(id) {
      if (id === EMPTY) return "export {};\n";
      if (!id.startsWith(SHIM)) return null;
      const specifier = id.slice(SHIM.length);
      return shimSource(specifier, await exportsOf(specifier));
    },
  };
}
