# The oauth app

Gondol's second built-in app, `oauth`, lets HTML5 and other apps act for a user over
[the apps' HTTP APIs](./api.md), with OAuth 2's authorization code flow (and PKCE for apps that
can't keep a secret).

- **Credentials**: each app gets any number, each with a **client id**, a **client secret**, a
  **redirect URI** and an optional **callback URL**, and the scopes it may ask for. The secret is
  shown once, when it's created or regenerated; only its SHA-256 hash is stored, so nobody, the
  owner or the database included, can read it back. Regenerating makes a new one and the old one
  stops working at once.
- **The consent page** (`/oauth/authorize`) shows the signed-in user which app asks for what, and
  sends them back to the app with a code (or `error=access_denied`).
- **Connected apps**: the apps a user has allowed, to disconnect.

## Switching it on

```ts
import { oauthApp } from "gondol/builtin/oauth";

configureGondol({ apps: [...myApps, oauthApp] });
// or: gondolApps({ dir: "apps", builtin: ["oauth"] })
```

Then create [its tables and functions](#the-tables-and-functions), deploy [the gateway](./api.md#serving-it)
and pass `--builtin oauth` to `gondol-api` so its `GET /me` is in the document.

## Pages

| Path | Feature | |
| --- | --- | --- |
| `/oauth/authorize?…` | `authorize` | The consent page. Hidden from the menu, offered on every site. A signed-out visitor should come back to it after signing in (the host's sign-in keeps the path). |
| `/oauth` | `credentials` | The user's credentials (name, app, client id, redirect URI, last used) and the connected apps. Tagged `admin`/`creator`/`operator` and `configure`. |
| `/oauth/new`, `/oauth/<client id>/edit` | `credentials` | The routed sheets. A new credential's secret, and a regenerated one, opens in a sheet of its own with copy buttons. |

The app is picked with `<EntityPicker/>` (restricted to the `app` entity type when the host has one)
and stored as its URI in `app_uri`.

## The flow

1. The app sends the user to `GET <gateway>/oauth/authorize` (or straight to the consent page) with
   `response_type=code`, `client_id`, `redirect_uri` (optional; it must be the registered one),
   `scope` (space-separated; default: what the credential allows), `state`, and for PKCE
   `code_challenge` + `code_challenge_method=S256`.
2. The user allows it: the page sends them to `redirect_uri?code=…&state=…`. The code lives ten
   minutes and works once; using it twice revokes what it issued.
3. The app posts to `POST <gateway>/oauth/token` (form or JSON; the client's credentials in the body
   or as HTTP Basic):
   - `grant_type=authorization_code&code=…&redirect_uri=…` with `client_secret`, or with
     `code_verifier` and no secret when the code was asked for with PKCE (a browser app);
   - `grant_type=refresh_token&refresh_token=…` (optional `scope` to narrow it).

   The answer is `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope }`.
   Access tokens last an hour, refresh tokens 90 days and are replaced on every refresh.
4. The app calls the API with `Authorization: Bearer <access_token>`. `POST <gateway>/oauth/revoke`
   (`token`, `client_id`) ends a token.

`GET /me` (scope `profile`) answers who the token acts for: `{ id, uri, client_id, scopes }`.

## The tables and functions

| Table | |
| --- | --- |
| `oauth_clients` | `id`, `user_id` (default `auth.uid()`), `app_uri`, `name`, `client_id` (unique, public), `secret_hash` (never readable), `secret_hint` (last four characters), `secret_created_at`, `redirect_uri`, `callback_url`, `scopes` (text[], empty: any), `last_used_at`, `created_at`, `updated_at`. The owner reads, updates (`app_uri`, `name`, `redirect_uri`, `callback_url`, `scopes`) and deletes their own; rows are created by `oauth_create_client()`. |
| `oauth_codes` | Hashed codes with the client, user, redirect URI, scopes, PKCE challenge, expiry and use. Service role only. |
| `oauth_tokens` | Hashed access and refresh tokens with the client, user, scopes, expiries, last use and revocation. Service role only. |

| Function | Who | |
| --- | --- | --- |
| `oauth_create_client(p_name, p_redirect_uri, p_app_uri, p_callback_url, p_scopes)` | owner | `{ id, client_id, client_secret }`: the only time the secret is returned. |
| `oauth_regenerate_secret(p_id)` | owner | The same, with a new secret. |
| `oauth_client_for_consent(p_client_id, p_redirect_uri)` | signed in | Name, app, redirect URI and scopes; refuses a redirect URI that isn't the registered one. |
| `oauth_authorize(p_client_id, p_redirect_uri, p_scopes, p_code_challenge, p_code_challenge_method)` | signed in | A code for the user. |
| `oauth_grant_list()`, `oauth_revoke_grant(p_client_id)` | signed in | Connected apps, and disconnecting one. |
| `oauth_exchange_code(…)`, `oauth_refresh_token(…)`, `oauth_revoke_token(…)` | service role | The token endpoint's work; they answer RFC 6749's JSON (or its `{ error, error_description }`). |
| `oauth_authenticate(p_access_token)` | service role | `user_id`, `client_id`, `scopes`, `app_uri` of a live token. |
| `api_me()` | signed in | `GET /me`. |

Every secret, code and token is 256 random bits; only its SHA-256 is stored, which can't be reversed.
Spacify's migration `20261023110000_oauth_and_app_api.sql` creates all of it.
