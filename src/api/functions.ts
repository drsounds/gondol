import { z } from "zod/v4";
import { API_METHODS, type JsonSchema } from "./gateway";
import type { AppApi } from "./openapi";
import { CORE_APP_IDS, type AppRegistry, type RegistryApp, type RegistryEntity, type RegistryFeature, type RegistryFunction, type RegistryTarget, type RegistryTool } from "./router";

/**
 * What an app lets other code call on the server, declared in its manifest:
 *
 * - `functions`: named server functions, each answered by a Postgres function (`rpc`, called as the
 *   user with `p_<name>` arguments, like the app API) or by an edge function of its own
 *   (`function`, which gets the JSON input and the caller's token). The app router serves them at
 *   `/apps/<app>/functions/<name>` (router.ts), for any app, script or AI to call.
 * - `mcp`: what the app offers AI models over the Model Context Protocol: `instructions` (what the
 *   app is for and how to use its tools), `tools` (each one of the app's functions or API
 *   operations) and/or an `endpoint`, an MCP server of the app's own that the router proxies. The
 *   router serves every app's tools as one MCP server at `/mcp` (and one per app at
 *   `/apps/<app>/mcp`); the ai app finds them there and lets the model call them.
 *
 * buildAppRegistry() turns the manifests into the router's `apps.json`. See docs/guide/functions.md.
 */

const functionName = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake case, e.g. `create_idea`");
const scopeName = z.string().regex(/^[a-z][a-z0-9_.:-]*$/);
const jsonSchema = z.record(z.string(), z.unknown()).meta({ description: "A JSON Schema; refer to the app API's shared ones with `#/components/schemas/<name>`." });

const behaviour = {
  scopes: z
    .array(scopeName)
    .optional()
    .meta({ description: "OAuth scopes a token needs (all of them; the app API's `scopes`). Omitted: any signed-in caller; []: anyone, also signed out." }),
  readOnly: z.boolean().optional().meta({ description: "It only reads: an AI may call it without asking." }),
  destructive: z.boolean().optional().meta({ description: "It deletes or overwrites: an AI always asks first." }),
};

export const appFunctionSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().min(1).meta({ description: "What it does, for developers and AI models (English)." }),
    rpc: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional().meta({ description: "The Postgres function that answers it, called as the user with `p_<field>` arguments." }),
    function: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .optional()
      .meta({ description: "An edge function that answers it instead: it gets the input as its JSON body and the caller's token." }),
    input: jsonSchema.optional().meta({ description: "The input, an object schema (default: any object)." }),
    output: jsonSchema.optional().meta({ description: "What it answers with." }),
    ...behaviour,
  })
  .strict()
  .refine((fn) => !!fn.rpc !== !!fn.function, { message: "give exactly one of `rpc` and `function`" });

const mcpToolSchema = z
  .object({
    name: functionName.meta({ description: "The tool's name, unique in the app; the router serves it as `<app>__<name>`." }),
    title: z.string().optional(),
    description: z.string().optional().meta({ description: "Default: the function's or operation's." }),
    function: functionName.optional().meta({ description: "One of the app's `functions` that the tool runs." }),
    operation: z
      .string()
      .regex(/^[A-Za-z_]\w*$/)
      .optional()
      .meta({ description: "Or an `operationId` of the app's `api`: its parameters and body become the tool's input." }),
    inputSchema: jsonSchema.optional().meta({ description: "Default: the function's input, or the operation's parameters and body." }),
    readOnly: behaviour.readOnly,
    destructive: behaviour.destructive,
  })
  .strict()
  .refine((tool) => !!tool.function !== !!tool.operation, { message: "give exactly one of `function` and `operation`" });

export const appMcpSchema = z
  .object({
    instructions: z.string().optional().meta({ description: "What the app is for and when to use its tools, told to AI models (English)." }),
    tools: z.array(mcpToolSchema).optional(),
    endpoint: z
      .object({
        url: z.string().regex(/^https:\/\/[^\s]+$/, "an https:// URL"),
        headers: z
          .record(z.string().regex(/^[A-Za-z0-9-]+$/), z.string().regex(/^[A-Z][A-Z0-9_]*$/))
          .optional()
          .meta({ description: "Headers to send, by name, each read from the server secret named (e.g. `{ \"Authorization\": \"MYAPP_MCP_TOKEN\" }`)." }),
      })
      .strict()
      .optional()
      .meta({ description: "An MCP server of the app's own (Streamable HTTP), proxied by the router." }),
  })
  .strict()
  .meta({ description: "What the app offers AI models over the Model Context Protocol." });

export const appFunctionsSchema = z.record(functionName, appFunctionSchema).meta({ description: "Server functions other apps, scripts and AI can call through the app router." });

export type AppFunction = z.infer<typeof appFunctionSchema>;
export type AppMcp = z.infer<typeof appMcpSchema>;

/** What the builder needs of an app. */
export type FunctionSource = {
  id: string;
  name?: { en: string; [locale: string]: string };
  description?: { en: string; [locale: string]: string };
  functions?: Record<string, AppFunction>;
  mcp?: AppMcp;
  api?: AppApi;
  /** Its pages and their actions, for discovery (the manifest's `features`). */
  features?: readonly {
    id: string;
    name: { en: string; [locale: string]: string };
    description?: { en: string; [locale: string]: string };
    path: string;
    entityTypes?: string[];
    actions?: readonly { id: string; title: string; description?: string; navigate?: string; shortcut?: string }[];
  }[];
  /** The entity types it owns (the manifest's `entities`). */
  entities?: Record<string, { slug: string | null; view?: string; edit?: string }>;
};

/** An app's features as the registry keeps them: English names, paths with a leading slash. */
function registryFeatures(source: FunctionSource): RegistryFeature[] | undefined {
  if (!source.features?.length) return undefined;
  return source.features.map((feature) => ({
    id: feature.id,
    name: feature.name.en,
    ...(feature.description?.en ? { description: feature.description.en } : {}),
    path: `/${feature.path.replace(/^\/+/, "")}`,
    ...(feature.entityTypes?.length ? { entityTypes: feature.entityTypes } : {}),
    ...(feature.actions?.length
      ? {
          actions: feature.actions.map((action) => ({
            id: action.id,
            title: action.title,
            ...(action.description ? { description: action.description } : {}),
            ...(action.navigate ? { navigate: action.navigate } : {}),
            ...(action.shortcut ? { shortcut: action.shortcut } : {}),
          })),
        }
      : {}),
  }));
}

function registryEntities(source: FunctionSource): Record<string, RegistryEntity> | undefined {
  const entries = Object.entries(source.entities ?? {});
  if (!entries.length) return undefined;
  return Object.fromEntries(
    entries.map(([type, entity]) => [type, { slug: entity.slug, ...(entity.view ? { view: entity.view } : {}), ...(entity.edit ? { edit: entity.edit } : {}) }]),
  );
}

/** Replaces `#/components/schemas/…` refs with what they point at, so a tool's schema stands alone. */
export function inlineRefs(schema: unknown, schemas: Record<string, unknown>, seen: string[] = []): unknown {
  if (Array.isArray(schema)) return schema.map((item) => inlineRefs(item, schemas, seen));
  if (!schema || typeof schema !== "object") return schema;
  const record = schema as Record<string, unknown>;
  if (typeof record.$ref === "string") {
    const name = record.$ref.replace(/^#\/components\/schemas\//, "");
    if (seen.includes(name) || !(name in schemas)) return { description: `See ${name}` };
    const { $ref: _ref, ...rest } = record;
    return { ...(inlineRefs(schemas[name], schemas, [...seen, name]) as object), ...rest };
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, inlineRefs(value, schemas, seen)]));
}

const anyObject: JsonSchema = { type: "object" };

/**
 * Turns the apps' `functions` and `mcp` into the app router's registry (its `apps.json`), with what
 * each app has in the browser (features, actions, entity types) for discovery. Throws on a tool
 * naming a function or operation the app doesn't have, two tools of an app with one name, a scope
 * no app declares and an app taking the id of gondol's own tools (`apps`, `entities`).
 */
export function buildAppRegistry(sources: readonly FunctionSource[]): AppRegistry {
  const problems: string[] = [];
  const schemas: Record<string, unknown> = {};
  const scopes = new Set<string>();
  for (const source of sources) {
    Object.assign(schemas, source.api?.schemas ?? {});
    for (const scope of Object.keys(source.api?.scopes ?? {})) scopes.add(scope);
  }
  const checkScopes = (where: string, list: string[] | undefined) => {
    for (const scope of list ?? []) if (!scopes.has(scope)) problems.push(`${where}: no app declares the scope "${scope}"`);
  };
  const inline = (schema: unknown) => inlineRefs(schema, schemas) as JsonSchema;

  const apps: Record<string, RegistryApp> = {};
  for (const source of sources) {
    if ((CORE_APP_IDS as readonly string[]).includes(source.id)) problems.push(`app "${source.id}": the id is gondol's own tools' on /mcp`);
    const features = registryFeatures(source);
    const entities = registryEntities(source);
    if (!source.functions && !source.mcp && !features && !entities) continue;
    const functions: Record<string, RegistryFunction> = {};
    for (const [name, fn] of Object.entries(source.functions ?? {})) {
      checkScopes(`app "${source.id}", function ${name}`, fn.scopes);
      const target: RegistryTarget = fn.rpc ? { rpc: fn.rpc } : { function: fn.function! };
      functions[name] = {
        ...(fn.title ? { title: fn.title } : {}),
        description: fn.description,
        target,
        input: inline(fn.input ?? anyObject),
        ...(fn.output ? { output: inline(fn.output) } : {}),
        ...(fn.scopes ? { scopes: fn.scopes } : {}),
        ...(fn.readOnly ? { readOnly: true } : {}),
        ...(fn.destructive ? { destructive: true } : {}),
      };
    }

    const operations = new Map<string, { method: string; path: string; operation: NonNullable<AppApi["paths"][string]["get"]> }>();
    for (const [path, item] of Object.entries(source.api?.paths ?? {})) {
      for (const method of API_METHODS) {
        const operation = item[method];
        if (operation) operations.set(operation.operationId, { method, path, operation });
      }
    }

    const tools: RegistryTool[] = [];
    const names = new Set<string>();
    for (const tool of source.mcp?.tools ?? []) {
      const where = `app "${source.id}", tool ${tool.name}`;
      if (names.has(tool.name)) problems.push(`${where}: two tools have this name`);
      names.add(tool.name);
      if (tool.function) {
        const fn = functions[tool.function];
        if (!fn) {
          problems.push(`${where}: the app has no function "${tool.function}"`);
          continue;
        }
        tools.push({
          name: tool.name,
          ...(tool.title ?? fn.title ? { title: tool.title ?? fn.title } : {}),
          description: tool.description ?? fn.description,
          target: fn.target,
          input: tool.inputSchema ? inline(tool.inputSchema) : fn.input,
          ...(fn.output ? { output: fn.output } : {}),
          ...(fn.scopes ? { scopes: fn.scopes } : {}),
          ...(tool.readOnly ?? fn.readOnly ? { readOnly: true } : {}),
          ...(tool.destructive ?? fn.destructive ? { destructive: true } : {}),
        });
        continue;
      }
      const found = operations.get(tool.operation!);
      if (!found) {
        problems.push(`${where}: the app's api has no operation "${tool.operation}"`);
        continue;
      }
      const { operation, method } = found;
      // The operation's parameters and its body's fields, side by side: the gateway's own mapping.
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const parameter of operation.parameters ?? []) {
        properties[parameter.name] = { ...(parameter.schema ?? { type: "string" }), ...(parameter.description ? { description: parameter.description } : {}) };
        if (parameter.required || parameter.in === "path") required.push(parameter.name);
      }
      const body = operation.requestBody ? (inline(operation.requestBody.schema) as JsonSchema) : null;
      for (const [key, value] of Object.entries(body?.properties ?? {})) if (!(key in properties)) properties[key] = value;
      for (const key of body?.required ?? []) if (!required.includes(key)) required.push(key);
      const success = Object.entries(operation.responses ?? {}).find(([status]) => /^2\d\d$/.test(status))?.[1];
      tools.push({
        name: tool.name,
        ...(tool.title ? { title: tool.title } : operation.summary ? { title: operation.summary } : {}),
        description: tool.description ?? operation.description ?? operation.summary ?? operation.operationId,
        target: { rpc: operation.rpc },
        input: tool.inputSchema
          ? inline(tool.inputSchema)
          : { type: "object", properties: properties as Record<string, JsonSchema>, ...(required.length ? { required } : {}), ...(body?.additionalProperties === false ? { additionalProperties: false } : {}) },
        ...(success?.schema ? { output: inline(success.schema) } : {}),
        // Undefined scopes: any valid token, as in the API.
        ...(operation.scopes ? { scopes: operation.scopes } : {}),
        ...(tool.readOnly ?? method === "get" ? { readOnly: true } : {}),
        ...(tool.destructive ?? method === "delete" ? { destructive: true } : {}),
      });
    }

    apps[source.id] = {
      id: source.id,
      name: source.name?.en ?? source.id,
      ...(source.description?.en ? { description: source.description.en } : {}),
      ...(source.mcp?.instructions ? { instructions: source.mcp.instructions } : {}),
      functions,
      tools,
      ...(source.mcp?.endpoint ? { endpoint: source.mcp.endpoint } : {}),
      ...(features ? { features } : {}),
      ...(entities ? { entities } : {}),
    };
  }
  if (problems.length) throw new Error(`gondol: the apps' functions don't fit together:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  return { version: 1, apps: Object.fromEntries(Object.entries(apps).sort(([a], [b]) => a.localeCompare(b))) };
}
