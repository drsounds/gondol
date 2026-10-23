# App APIs (OpenAPI)

An app can open an HTTP API of its own, for HTML5 apps, scripts, devices and other services to call
for a user. It declares it in its manifest as an OpenAPI 3.1 subset; gondol merges every app's into
one document and serves it through one **gateway** that signs callers in with OAuth 2
([the oauth app](./oauth.md)), checks scopes, validates each request against its schema and runs
the operation as a Postgres function **as the user**, so row level security applies exactly as in
the app.

```
app (HTML5, script, device)
  │  Authorization: Bearer <access token>
  ▼
gateway (an edge function)            ← openapi.json: every app's manifest `api`
  │  token → user, client, scopes (oauth_authenticate())
  │  scopes ✓  body/params ✓ (JSON Schema)
  ▼
PostgREST rpc  <operation's function>(p_…)   as the user (RLS)
```

## Declaring an API

`api` in `manifest.json`:

```json
"api": {
  "scopes": {
    "streams:write": { "en": "Start streams for you and report how they went", "sv": "Starta flöden åt dig …" }
  },
  "schemas": {
    "Stream": { "type": "object", "properties": { "id": { "type": "string", "format": "uuid" } } }
  },
  "paths": {
    "/streams": {
      "post": {
        "operationId": "startStream",
        "summary": "Start a stream",
        "rpc": "api_start_stream",
        "scopes": ["streams:write"],
        "requestBody": {
          "required": true,
          "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": { "object_uri": { "type": "string", "format": "uri" } }
          }
        },
        "responses": { "201": { "description": "The stream", "schema": { "$ref": "#/components/schemas/Stream" } } }
      }
    }
  }
}
```

| Key | |
| --- | --- |
| `scopes` | The scopes the app introduces, with what granting one lets a client do (the consent page shows this text). Names are lower case, e.g. `streams:write`. |
| `schemas` | Shared JSON Schemas, referred to as `#/components/schemas/<name>`. Two apps may share a name only with the same definition. |
| `paths` | Operations by path (`/streams/{id}`) and method (`get`, `put`, `post`, `patch`, `delete`). |

An operation has OpenAPI's `operationId` (unique across apps), `summary`, `description`, `tags`
(default: the app id), `deprecated`, `parameters` (`path`, `query`, `header`, each with a `schema`),
`requestBody` (`schema`, `required`; always JSON) and `responses` by status (`description`,
`schema`; the first 2xx is what a success answers with, default 200), and two of gondol's own:

- **`rpc`**: the Postgres function that answers it.
- **`scopes`**: what the token needs, all of them. Left out: any valid token. `[]`: no token at all
  (a public operation; its function then runs as `anon`).

The paths `/openapi.json` and `/oauth/*` are the gateway's own.

### The function

The gateway calls `rpc` with one named argument per input, `p_` plus the name in snake case: the
path and query parameters, then the body's top-level fields (`started_at` and `startedAt` both
become `p_started_at`). A path parameter always wins over a body field of the same name, so a body
can't point the call at another row. Give every argument a default, since clients leave fields out.

```sql
CREATE FUNCTION public.api_start_stream(p_object_uri text DEFAULT NULL, p_started_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- auth.uid() is the user the token acts for; RLS applies (SECURITY INVOKER).
  INSERT INTO public.streams (user_id, object_uri, start_date) VALUES (auth.uid(), p_object_uri, coalesce(p_started_at, now())) …;
  RETURN …;
END $$;
GRANT EXECUTE ON FUNCTION public.api_start_stream(text, timestamptz) TO authenticated;
```

Its JWT claims (`current_setting('request.jwt.claims')`) also carry `oauth_client_id`,
`oauth_app_uri` (the app the credential belongs to) and `oauth_scopes`, e.g. to record the app as
the actor of an audit trail.

What it returns is the response body. Errors it raises become [problem details](https://www.rfc-editor.org/rfc/rfc9457)
(`application/problem+json`) with a status from the SQLSTATE (`statusForDbError()`):

| SQLSTATE | Status |
| --- | --- |
| `P0002` (no_data_found) | 404 |
| `42501` (insufficient_privilege, RLS) | 403 |
| `22023`, `22P02`, `22007`, `22008`, `23502`, `23514` | 422 |
| `23505`, `23503` | 409 |
| anything else | 500 |

So `RAISE EXCEPTION 'No such stream' USING ERRCODE = 'P0002'` answers 404 with that message.

## Building the document

`gondol-api` (gondol's `bin`, `src/api/cli.ts`, run with bun) reads every app's manifest and writes
two files for the server:

```sh
bun node_modules/gondol/src/api/cli.ts --apps src/apps --builtin ai,oauth --out supabase/functions/_shared/gondol-api --title "My API"
```

- `openapi.json`: the merged document (`buildOpenApiDocument()`). It refuses a path and method two
  apps both define, a repeated `operationId`, a scope no app declares and a path parameter that isn't
  in `parameters`.
- `gateway.ts`: the gateway itself, copied: it imports nothing and uses only web-standard APIs, so it
  runs as is in Deno (Supabase edge functions), Node, Bun and workers.

`--check` writes nothing and fails when either is out of date; run it in CI so the server's copy
follows the manifests.

## Serving it

The host writes the edge function that wires the gateway to its database:

```ts
import { createApiGateway, statusForDbError } from "../_shared/gondol-api/gateway.ts";
import openapi from "../_shared/gondol-api/openapi.json" with { type: "json" };

Deno.serve(
  createApiGateway({
    document: openapi,
    basePath: "/app-api", // the function's name: the part of the path before the routes
    authorizeUrl: "https://app.example.com/oauth/authorize", // the consent page
    authenticate: async (token) => /* oauth_authenticate(token) → { userId, clientId, scopes, appUri } | null */,
    token: async (grant) => /* oauth_exchange_code(…) or oauth_refresh_token(…) */,
    revoke: async ({ clientId, clientSecret, token }) => /* oauth_revoke_token(…) */,
    invoke: async ({ rpc, args, caller }) => /* supabase.rpc(rpc, args) with a JWT for caller.userId */,
  }),
);
```

Spacify's is `supabase/functions/app-api/index.ts`: the token functions run with the service role,
and `invoke` signs a one-minute JWT for the user (`role: authenticated`, `sub`, the `oauth_*`
claims) with the project's JWT secret so PostgREST runs the function as them. Deploy it without
Supabase's own JWT check (`verify_jwt = false`): the gateway checks its tokens itself.

| Route | |
| --- | --- |
| `GET /openapi.json` | The document, with `servers` and the OAuth URLs filled in (`publicUrl`, else from the request). Point Swagger UI or a client generator at it. |
| `GET /oauth/authorize` | Redirects to `authorizeUrl` with the same query. |
| `POST /oauth/token` | The token endpoint ([the oauth app](./oauth.md#the-flow)). |
| `POST /oauth/revoke` | Revokes a token (RFC 7009). |
| anything in the document | The operation: `401` without a valid token, `403` without its scopes, `422` with every problem in `errors` when the input doesn't match its schema, else its function's answer. |

The gateway checks the common JSON Schema keywords: `type` (also a list, for `null`), `enum`,
`required`, `properties`, `additionalProperties`, `items`, `minLength`/`maxLength`, `pattern`,
`minimum`/`maximum`, `minItems`/`maxItems`, `$ref` and the formats `date-time`, `date`, `uuid`,
`uri` (any `scheme:…`, so entity URIs pass) and `email`. Others are documentation only.
