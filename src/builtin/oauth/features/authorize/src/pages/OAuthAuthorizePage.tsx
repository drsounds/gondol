import { useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Alert, Button, Card } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { getInternalApps } from "../../../../../../apps/registry";
import { getLocalizedText } from "../../../../../../apps/types";
import { apiScopes } from "../../../../../../api/openapi";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { authorizeOAuth, parseAuthorizeRequest, redirectWith, useOAuthConsentClient } from "../../../../models/oauth";

/**
 * The consent page (`/oauth/authorize`, where the API gateway's GET /oauth/authorize sends the
 * user): which app asks, for which scopes, and where it sends the user back. Allowing issues a code
 * (oauth_authorize()) and goes to the redirect URI with it and `state`; denying goes there with
 * `error=access_denied`. A request that names an unknown client or a redirect URI the client
 * didn't register never redirects (RFC 6749 §4.1.2.1): it only shows the problem.
 */
export function OAuthAuthorizePage(_props: AppFeaturePageProps) {
  const { t, locale } = useI18n();
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const request = useMemo(() => parseAuthorizeRequest(search ?? ""), [search]);
  const client = useOAuthConsentClient(request.clientId, request.redirectUri);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeTexts = useMemo(() => {
    const sources = getInternalApps().map((app) => ({ id: app.id, api: app.manifest.api }));
    return new Map(apiScopes(sources).map((scope) => [scope.name, getLocalizedText(scope.description, locale)]));
  }, [locale]);

  // Only the code flow: say so to the app, once the client checks out.
  const unsupported = !!client.data && request.responseType !== "code";
  useEffect(() => {
    if (!unsupported || !client.data) return;
    const to = request.redirectUri ?? client.data.redirect_uri;
    window.location.assign(redirectWith(to, { error: "unsupported_response_type", error_description: "Only response_type=code is supported", state: request.state }));
  }, [unsupported, client.data, request]);

  if (!request.clientId) return <ConsentProblem text={t("oauth.consent.noClient")} />;
  if (client.isLoading) return <p className="muted">{t("app.loading")}</p>;
  if (client.error || !client.data) {
    const message = client.error instanceof Error ? client.error.message : String((client.error as { message?: string } | null)?.message ?? "");
    return <ConsentProblem text={t("oauth.consent.badClient")} detail={message} />;
  }

  const info = client.data;
  const redirectUri = request.redirectUri ?? info.redirect_uri;
  // Asked for nothing: what the credential allows.
  const scopes = request.scopes ?? info.scopes;
  const back = (values: Record<string, string | null>) => window.location.assign(redirectWith(redirectUri, { ...values, state: request.state }));

  if (unsupported) return <p className="muted">{t("oauth.consent.returning")}</p>;

  async function allow() {
    setBusy(true);
    setError(null);
    try {
      const code = await authorizeOAuth({
        clientId: info.client_id,
        redirectUri,
        scopes,
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: request.codeChallengeMethod,
      });
      back({ code });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String((e as { message?: string }).message ?? e));
    }
  }

  let host = redirectUri;
  try {
    host = new URL(redirectUri).host;
  } catch {
    // shown as is
  }

  return (
    <div className="oauth-consent">
      <Card className="oauth-consent__card">
        <h1 className="oauth-consent__title">{t("oauth.consent.title", { name: info.name })}</h1>
        <p className="muted">{t("oauth.consent.intro", { name: info.name })}</p>
        {scopes.length ? (
          <ul className="oauth-consent__scopes">
            {scopes.map((scope) => (
              <li key={scope}>
                <strong>{scopeTexts.get(scope) ?? scope}</strong>
                <span className="muted"> · {scope}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("oauth.consent.noScopes")}</p>
        )}
        <p className="muted oauth-consent__redirect">{t("oauth.consent.redirect", { host })}</p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="oauth-consent__actions">
          <Button type="button" variant="outline" disabled={busy} onClick={() => back({ error: "access_denied" })}>
            {t("oauth.consent.deny")}
          </Button>
          <Button type="button" tone="primary" loading={busy} onClick={() => void allow()}>
            {t("oauth.consent.allow")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ConsentProblem({ text, detail }: { text: string; detail?: string }) {
  return (
    <div className="oauth-consent">
      <Alert tone="danger">
        {text}
        {detail ? <span className="oauth-consent__detail"> {detail}</span> : null}
      </Alert>
    </div>
  );
}
