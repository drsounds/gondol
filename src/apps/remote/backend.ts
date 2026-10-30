import { buildAppRegistry, type FunctionSource } from "../../api/functions";
import type { RegistryApp } from "../../api/router";
import { parseManifest } from "../manifest";
import { backendFingerprint } from "./protocol";

/**
 * A remote app's backend as an admin approves it: what the app router will serve for it (its
 * registry entry, every function routed to the app's runtime) and the fingerprint of the manifest
 * parts it came from (protocol.ts), so the approval only holds while those stay the same.
 *
 * A remote app's functions must all be `server` functions (answered by its runtime) and its tools
 * must run them: it can't name the host's Postgres or edge functions (`rpc`, `function`, `api`
 * operations), nor an MCP server of its own.
 */
export interface RemoteBackendReview {
  appId: string;
  name: string;
  fingerprint: string;
  registry: RegistryApp;
  /** What the admin is asked to approve, one line per function. */
  functions: { name: string; description: string; url: string; readOnly: boolean; destructive: boolean }[];
  /** Why it can't be approved (empty when it can). */
  problems: string[];
}

export function reviewRemoteBackend(manifestJson: unknown, functionsUrl: string): RemoteBackendReview {
  const manifest = parseManifest(manifestJson);
  const problems: string[] = [];
  for (const [name, fn] of Object.entries(manifest.functions ?? {})) {
    if (!fn.server) problems.push(`function ${name}: a remote app's functions must be \`server\` functions, answered by its runtime`);
  }
  for (const tool of manifest.mcp?.tools ?? []) {
    if (tool.operation) problems.push(`tool ${tool.name}: a remote app's tools must run its functions, not API operations`);
  }
  if (manifest.mcp?.endpoint) problems.push("mcp.endpoint: a remote app can't have the router proxy an MCP server of its own");
  if (manifest.api) problems.push("api: a remote app can't declare app API operations");
  let url: URL | null = null;
  try {
    url = new URL(functionsUrl);
    if (url.protocol !== "https:") problems.push(`${functionsUrl}: the runtime must be served over HTTPS`);
  } catch {
    problems.push(`${functionsUrl} is not a URL`);
  }

  const source: FunctionSource = {
    id: manifest.id,
    name: manifest.name as FunctionSource["name"],
    description: manifest.description as FunctionSource["description"],
    functions: Object.fromEntries(Object.entries(manifest.functions ?? {}).filter(([, fn]) => !!fn.server)),
    mcp: manifest.mcp ? { ...manifest.mcp, endpoint: undefined, tools: manifest.mcp.tools?.filter((tool) => !!tool.function) } : undefined,
    features: manifest.features as FunctionSource["features"],
    entities: manifest.entities,
    functionsUrl: url?.toString() ?? functionsUrl,
  };
  let registry: RegistryApp = { id: manifest.id, name: manifest.id, functions: {}, tools: [] };
  try {
    registry = buildAppRegistry([source]).apps[manifest.id] ?? registry;
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return {
    appId: manifest.id,
    name: registry.name,
    fingerprint: backendFingerprint(manifest),
    registry,
    functions: Object.entries(registry.functions).map(([name, fn]) => ({
      name,
      description: fn.description,
      url: "runtime" in fn.target ? fn.target.runtime : "",
      readOnly: !!fn.readOnly,
      destructive: !!fn.destructive,
    })),
    problems,
  };
}
