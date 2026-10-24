/** The kinds of registry the Service Finder can read: the MCP registry's v0 API, for now. */
export type McpRegistryKind = "mcp-v0";

/**
 * A registry of MCP servers (`mcp_registries`). Rows without a `user_id` are built in (the official
 * MCP registry), readable by everyone and read-only; users add their own, which only they see.
 */
export type McpRegistry = {
  id: string;
  user_id: string | null;
  name: string;
  /** The registry's address, e.g. https://registry.modelcontextprotocol.io (`/v0` is added). */
  url: string;
  description: string | null;
  kind: McpRegistryKind;
  enabled: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type McpRegistryWrite = Partial<Pick<McpRegistry, "name" | "url" | "description" | "kind" | "enabled" | "position">>;

/** An input a server asks for (a header, a URL variable), as server.json describes it. */
export type RegistryInput = {
  name?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  /** A fixed value, or a template with `{variables}` such as "Bearer {api_key}". */
  value?: string;
  default?: string;
  choices?: string[];
  format?: string;
  variables?: Record<string, RegistryInput>;
};

/** A hosted endpoint of a server. Only `streamable-http` can be installed (the app router speaks it). */
export type RegistryRemote = {
  type: string;
  url: string;
  headers?: RegistryInput[];
  variables?: Record<string, RegistryInput>;
};

/** A package to run on one's own computer (npm, PyPI, a container, …). The Service Finder only shows them. */
export type RegistryPackage = {
  registryType?: string;
  identifier?: string;
  version?: string;
  transport?: { type?: string; url?: string };
};

export type RegistryIcon = { src: string; mimeType?: string; sizes?: string[]; theme?: string };

/** A server as the registry has it (server.json). */
export type RegistryServer = {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string; source?: string; subfolder?: string };
  icons?: RegistryIcon[];
  remotes?: RegistryRemote[];
  packages?: RegistryPackage[];
};

export type RegistryEntry = { server: RegistryServer; _meta?: Record<string, unknown> };

export type RegistryPage = { servers: RegistryEntry[]; nextCursor: string | null };

/** How a server can run: on the server for you (`remote`), only over SSE, which the router doesn't speak, or only locally. */
export type ServerReach = "remote" | "sse" | "local" | "none";

type Table<Row, Write, Required extends keyof Row> = {
  Row: Row;
  Insert: Write & Pick<Row, Required>;
  Update: Write;
  Relationships: [];
};

/** The tables the service-finder app reads and writes (see docs/guide/service-finder.md). */
export type ServiceFinderDatabase = {
  public: {
    Tables: {
      mcp_registries: Table<McpRegistry, McpRegistryWrite, "name" | "url">;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
