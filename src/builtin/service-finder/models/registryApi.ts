import type { McpRegistry, RegistryEntry, RegistryInput, RegistryPage, RegistryRemote, RegistryServer, ServerReach } from "./types";

/**
 * Reading an MCP registry's v0 API (https://registry.modelcontextprotocol.io/docs): `GET /v0/servers`
 * (search, cursor, latest versions only) and `GET /v0/servers/{name}/versions/latest`. The official
 * registry answers any origin (CORS `*`), so the browser asks it directly.
 */

/** The API's base: the registry's address with `/v0` added unless it names a version already. */
export function registryApiBase(url: string): string {
  const base = url.trim().replace(/\/+$/, "");
  return /\/v\d+(\.\d+)?$/.test(base) ? base : `${base}/v0`;
}

/** Whether an entry is its server's latest version, by the official registry's `_meta` (absent: yes). */
function isLatest(entry: RegistryEntry): boolean {
  const official = entry._meta?.["io.modelcontextprotocol.registry/official"] as { isLatest?: boolean; status?: string } | undefined;
  return official?.isLatest !== false && official?.status !== "deleted";
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}`.trim()) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** One page of a registry's servers (latest versions), matching `search` when given. */
export async function listRegistryServers(
  registry: Pick<McpRegistry, "url">,
  { search, cursor, limit = 50, signal }: { search?: string; cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<RegistryPage> {
  const params = new URLSearchParams({ limit: String(limit), version: "latest" });
  if (search?.trim()) params.set("search", search.trim());
  if (cursor) params.set("cursor", cursor);
  const body = (await getJson(`${registryApiBase(registry.url)}/servers?${params}`, signal)) as {
    servers?: RegistryEntry[];
    metadata?: { nextCursor?: string | null; next_cursor?: string | null };
  };
  const servers = (body.servers ?? []).filter((entry) => entry?.server?.name && isLatest(entry));
  return { servers, nextCursor: body.metadata?.nextCursor ?? body.metadata?.next_cursor ?? null };
}

/**
 * A server's latest version, or null when the registry doesn't have it. Some hops between the
 * browser and a registry decode the `%2F` in a server's name, so when the direct address isn't
 * found it's looked up by searching for the name.
 */
export async function getRegistryServer(registry: Pick<McpRegistry, "url">, name: string, signal?: AbortSignal): Promise<RegistryEntry | null> {
  try {
    const body = (await getJson(`${registryApiBase(registry.url)}/servers/${encodeURIComponent(name)}/versions/latest`, signal)) as
      | RegistryEntry
      | RegistryServer;
    if (body && "server" in body && body.server) return body;
    if (body && "name" in body) return { server: body };
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }
  const page = await listRegistryServers(registry, { search: name, limit: 100, signal });
  return page.servers.find((entry) => entry.server.name === name) ?? null;
}

/** The remote the app router can call: the first Streamable HTTP one. */
export function installableRemote(server: RegistryServer): RegistryRemote | null {
  return server.remotes?.find((remote) => remote.type === "streamable-http" && /^https?:\/\//i.test(remote.url ?? "")) ?? null;
}

/** How the server can run for the user here. */
export function serverReach(server: RegistryServer): ServerReach {
  if (installableRemote(server)) return "remote";
  if (server.remotes?.some((remote) => remote.type === "sse")) return "sse";
  if (server.packages?.length) return "local";
  return "none";
}

/** The name to show: its title, else the last part of its registry name (io.github.acme/weather → weather). */
export function serverTitle(server: Pick<RegistryServer, "name" | "title">): string {
  return server.title?.trim() || server.name.split("/").pop() || server.name;
}

/** An https icon to show, preferring one drawn for the light theme or none in particular. */
export function serverIcon(server: RegistryServer): string | null {
  const icons = (server.icons ?? []).filter((icon) => /^https:\/\//i.test(icon.src ?? ""));
  return (icons.find((icon) => !icon.theme || icon.theme === "light") ?? icons[0])?.src ?? null;
}

/** The repository's address, when it is a web address. */
export function serverRepository(server: RegistryServer): string | null {
  const url = server.repository?.url;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

const PLACEHOLDER = /\{([A-Za-z_][\w.-]*)\}/g;

/** The `{variables}` in a template, in order, each once. */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** A template with its `{variables}` filled in; unknown ones stay as they are. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => (values[name] != null && values[name] !== "" ? values[name] : whole));
}

/**
 * What the install sheet asks for. A URL variable or a header template's variable becomes a field
 * of its own (`{api_key}` in "Bearer {api_key}"); a header without a value is asked for as a whole.
 */
export type InstallField = {
  /** Unique in the sheet: `url:<variable>`, `header:<name>` or `header:<name>:<variable>`. */
  key: string;
  label: string;
  description?: string;
  secret: boolean;
  required: boolean;
  defaultValue: string;
  choices?: string[];
  /** The header it fills, when it does. */
  header?: string;
};

export function installFields(remote: RegistryRemote): InstallField[] {
  const fields: InstallField[] = [];
  for (const name of placeholders(remote.url)) {
    const input: RegistryInput = remote.variables?.[name] ?? {};
    fields.push({
      key: `url:${name}`,
      label: name,
      description: input.description,
      secret: !!input.isSecret,
      required: input.isRequired !== false,
      defaultValue: input.default ?? input.value ?? "",
      choices: input.choices,
    });
  }
  for (const header of remote.headers ?? []) {
    const name = header.name?.trim();
    if (!name) continue;
    const template = header.value ?? "";
    const variables = placeholders(template);
    if (template && !variables.length) continue; // A fixed value: sent as it is, nothing to ask.
    if (!variables.length) {
      fields.push({
        key: `header:${name}`,
        label: name,
        description: header.description,
        secret: !!header.isSecret,
        required: !!header.isRequired,
        defaultValue: header.default ?? "",
        choices: header.choices,
        header: name,
      });
      continue;
    }
    for (const variable of variables) {
      const input: RegistryInput = header.variables?.[variable] ?? {};
      fields.push({
        key: `header:${name}:${variable}`,
        label: `${name}: ${variable}`,
        description: input.description ?? header.description,
        secret: input.isSecret ?? !!header.isSecret,
        required: input.isRequired ?? !!header.isRequired,
        defaultValue: input.default ?? "",
        choices: input.choices,
        header: name,
      });
    }
  }
  return fields;
}

/**
 * The address and headers to install with, from the sheet's values (keyed as `installFields()`).
 * A header whose variables are all left empty, or whose value is left empty, is left out.
 */
export function resolveInstall(remote: RegistryRemote, values: Record<string, string>): { url: string; headers: Record<string, string> } {
  const urlValues: Record<string, string> = {};
  for (const name of placeholders(remote.url)) urlValues[name] = values[`url:${name}`]?.trim() ?? "";
  const url = fillTemplate(remote.url, urlValues);
  const headers: Record<string, string> = {};
  for (const header of remote.headers ?? []) {
    const name = header.name?.trim();
    if (!name) continue;
    const template = header.value ?? "";
    const variables = placeholders(template);
    if (template && !variables.length) {
      headers[name] = template;
    } else if (!variables.length) {
      const value = values[`header:${name}`]?.trim();
      if (value) headers[name] = value;
    } else {
      const filled: Record<string, string> = {};
      for (const variable of variables) filled[variable] = values[`header:${name}:${variable}`]?.trim() ?? "";
      if (variables.some((variable) => filled[variable])) headers[name] = fillTemplate(template, filled);
    }
  }
  return { url, headers };
}

/** The required fields still empty in `values`. */
export function missingFields(fields: InstallField[], values: Record<string, string>): InstallField[] {
  return fields.filter((field) => field.required && !(values[field.key] ?? "").trim());
}

/** Compares versions loosely (1.10.0 > 1.9.2); non-numeric parts compare as text. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(/[.+-]/);
  const pb = b.replace(/^v/i, "").split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (x !== "" && y !== "" && Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** A server's address in the Service Finder: `/service-finder/servers/<registry name>` (one slash in it). */
export function serverPath(name: string): string {
  return `/service-finder/servers/${name.split("/").map(encodeURIComponent).join("/")}`;
}

/** The registry name a Service Finder path names, or null. */
export function serverNameFromPath(pathname: string): string | null {
  const prefix = "/service-finder/servers/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  if (!rest) return null;
  try {
    return rest.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}
