import { z } from "zod/v4";
import { API_METHODS, type ApiDocument, type ApiOperation, type JsonSchema } from "./gateway";

/**
 * An app's own HTTP API, declared in its manifest's `api` (an OpenAPI 3.1 subset): the scopes it
 * introduces, shared schemas, and its operations by path and method. Each operation is answered by
 * a Postgres function (`rpc`), called as the user who authorized the calling client, so row level
 * security applies as in the app itself; its arguments are the operation's path and query
 * parameters and the JSON body's fields, each prefixed `p_` (`started_at` → `p_started_at`).
 *
 * buildOpenApiDocument() merges every app's into one document, which the gateway (gateway.ts)
 * serves at /openapi.json and routes requests by. See docs/guide/api.md.
 */

const localized = z.object({ en: z.string().min(1) }).catchall(z.string());

const scopeName = z.string().regex(/^[a-z][a-z0-9_.:-]*$/, "lower case, e.g. `streams:write`");

/** A JSON Schema (OpenAPI 3.1's dialect); the gateway checks requests against the common keywords. */
const jsonSchema = z.record(z.string(), z.unknown()).meta({ description: "A JSON Schema; refer to shared ones with `#/components/schemas/<name>`." });

const parameterSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z_]\w*$/),
    in: z.enum(["path", "query", "header"]),
    required: z.boolean().optional(),
    description: z.string().optional(),
    schema: jsonSchema.optional(),
  })
  .strict();

const operationSchema = z
  .object({
    operationId: z.string().regex(/^[A-Za-z_]\w*$/, "an identifier, e.g. `startStream`"),
    summary: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    deprecated: z.boolean().optional(),
    rpc: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/, "a Postgres function name in the public schema")
      .meta({ description: "The Postgres function that answers it, called as the signed-in user with `p_<name>` arguments." }),
    scopes: z
      .array(scopeName)
      .optional()
      .meta({ description: "Scopes the access token needs (all of them). Omitted: any valid token; []: no token at all." }),
    parameters: z.array(parameterSchema).optional(),
    requestBody: z
      .object({
        required: z.boolean().optional(),
        description: z.string().optional(),
        schema: jsonSchema,
      })
      .strict()
      .optional()
      .meta({ description: "The JSON body (application/json)." }),
    responses: z
      .record(z.string().regex(/^[1-5]\d\d$/), z.object({ description: z.string(), schema: jsonSchema.optional() }).strict())
      .optional()
      .meta({ description: "By status code; the first 2xx is what a success answers with (default 200)." }),
  })
  .strict();

const pathItemSchema = z.object(Object.fromEntries(API_METHODS.map((method) => [method, operationSchema.optional()])) as Record<(typeof API_METHODS)[number], z.ZodOptional<typeof operationSchema>>).strict();

export const appApiSchema = z
  .object({
    scopes: z.record(scopeName, localized).optional().meta({ description: "Scopes this app introduces, with what granting one lets a client do." }),
    schemas: z.record(z.string().regex(/^[A-Za-z_]\w*$/), jsonSchema).optional().meta({ description: "Shared schemas, as `#/components/schemas/<name>`." }),
    paths: z
      .record(z.string().regex(/^\/[\w\-./{}]*$/, "an absolute path, e.g. `/streams/{id}`"), pathItemSchema)
      .meta({ description: "Operations by path and method." }),
  })
  .strict()
  .meta({ description: "The app's HTTP API (OpenAPI subset), served by the gondol API gateway." });

export type AppApi = z.infer<typeof appApiSchema>;
type AppApiOperation = z.infer<typeof operationSchema>;

/** What the builder needs of an app: its id and its manifest's `api`. */
export type ApiSource = { id: string; name?: { en: string; [locale: string]: string }; api?: AppApi };

export type BuildApiOptions = {
  title?: string;
  version?: string;
  description?: string;
};

/** A scope any app declares, with its text and the app declaring it. */
export type ApiScope = { name: string; description: { en: string; [locale: string]: string }; appId: string };

/** Every scope the apps declare, in order. */
export function apiScopes(sources: readonly ApiSource[]): ApiScope[] {
  return sources.flatMap((source) => Object.entries(source.api?.scopes ?? {}).map(([name, description]) => ({ name, description, appId: source.id })));
}

const reservedPaths = ["/openapi.json", "/oauth/authorize", "/oauth/token", "/oauth/revoke"];

function toOperation(appId: string, operation: AppApiOperation): ApiOperation {
  const { rpc, scopes, requestBody, responses, parameters, ...rest } = operation;
  return {
    ...rest,
    tags: rest.tags ?? [appId],
    ...(parameters ? { parameters: parameters as ApiOperation["parameters"] } : {}),
    ...(requestBody
      ? { requestBody: { required: requestBody.required, description: requestBody.description, content: { "application/json": { schema: requestBody.schema as JsonSchema } } } }
      : {}),
    responses: Object.fromEntries(
      Object.entries(responses ?? { 200: { description: "OK" } }).map(([status, response]) => [
        status,
        { description: response.description, ...(response.schema ? { content: { "application/json": { schema: response.schema as JsonSchema } } } : {}) },
      ]),
    ),
    // OpenAPI's way of saying it: one requirement with every scope; [] means no token.
    ...(scopes === undefined ? { security: [{ oauth2: [] }] } : scopes.length === 0 ? { security: [] } : { security: [{ oauth2: scopes }] }),
    "x-gondol-rpc": rpc,
    "x-gondol-app": appId,
  };
}

/**
 * Merges the apps' APIs into one OpenAPI 3.1 document. Throws on a path and method two apps both
 * define, a repeated operationId, a shared schema name with two definitions, a scope nobody
 * declares, and the gateway's own paths.
 */
export function buildOpenApiDocument(sources: readonly ApiSource[], options: BuildApiOptions = {}): ApiDocument {
  const problems: string[] = [];
  const paths: ApiDocument["paths"] = {};
  const schemas: Record<string, JsonSchema> = {};
  const schemaOwners = new Map<string, string>();
  const operationIds = new Map<string, string>();
  const scopes = apiScopes(sources);
  const scopeOwners = new Map<string, string>();
  for (const scope of scopes) {
    const owner = scopeOwners.get(scope.name);
    if (owner) problems.push(`apps "${owner}" and "${scope.appId}" both declare the scope "${scope.name}"`);
    scopeOwners.set(scope.name, scope.appId);
  }

  for (const source of sources) {
    const api = source.api;
    if (!api) continue;
    for (const [name, schema] of Object.entries(api.schemas ?? {})) {
      const owner = schemaOwners.get(name);
      if (owner && JSON.stringify(schemas[name]) !== JSON.stringify(schema)) {
        problems.push(`apps "${owner}" and "${source.id}" define the schema "${name}" differently`);
        continue;
      }
      schemaOwners.set(name, source.id);
      schemas[name] = schema as JsonSchema;
    }
    for (const [path, item] of Object.entries(api.paths)) {
      if (reservedPaths.includes(path)) {
        problems.push(`app "${source.id}": ${path} is the gateway's own`);
        continue;
      }
      const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      for (const method of API_METHODS) {
        const operation = item[method];
        if (!operation) continue;
        const where = `app "${source.id}", ${method.toUpperCase()} ${path}`;
        if (paths[path]?.[method]) problems.push(`${where}: also defined by app "${paths[path][method]!["x-gondol-app"]}"`);
        const idOwner = operationIds.get(operation.operationId);
        if (idOwner) problems.push(`${where}: operationId "${operation.operationId}" is also used in ${idOwner}`);
        operationIds.set(operation.operationId, where);
        for (const scope of operation.scopes ?? []) {
          if (!scopeOwners.has(scope)) problems.push(`${where}: no app declares the scope "${scope}"`);
        }
        const declared = (operation.parameters ?? []).filter((p) => p.in === "path").map((p) => p.name);
        for (const param of params) {
          if (!declared.includes(param)) problems.push(`${where}: the path parameter {${param}} isn't in parameters`);
        }
        paths[path] = { ...paths[path], [method]: toOperation(source.id, operation) };
      }
    }
  }
  if (problems.length) throw new Error(`gondol: the apps' APIs don't fit together:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  return {
    openapi: "3.1.0",
    info: {
      title: options.title ?? "App API",
      version: options.version ?? "1.0.0",
      ...(options.description ? { description: options.description } : {}),
    },
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      ...(Object.keys(schemas).length ? { schemas } : {}),
      securitySchemes: {
        // The gateway fills in its URLs when it serves the document.
        oauth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: "/oauth/authorize",
              tokenUrl: "/oauth/token",
              refreshUrl: "/oauth/token",
              scopes: Object.fromEntries(scopes.map((scope) => [scope.name, scope.description.en])),
            },
          },
        },
      },
    },
  };
}
