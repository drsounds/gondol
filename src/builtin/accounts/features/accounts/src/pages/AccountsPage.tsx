import { useEffect, useState } from "react";
import { Badge, Button, Card } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { useAccountConnections, useConnectGithub, useDisconnectAccount } from "../../../../models/accounts";

export function AccountsPage() {
  const { t } = useI18n();
  const accounts = useAccountConnections();
  const refetchAccounts = accounts.refetch;
  const connect = useConnectGithub();
  const disconnect = useDisconnectAccount();
  const [connectionResult, setConnectionResult] = useState<"connected" | "error" | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("github");
    if (result === "connected" || result === "error") {
      setConnectionResult(result);
      url.searchParams.delete("github");
      window.history.replaceState({}, "", url);
      void refetchAccounts();
    }
  }, [refetchAccounts]);

  return (
    <Card>
      <div className="stack">
        <div className="panel-head">
          <div>
            <h1 className="panel-title">{t("accounts.title")}</h1>
            <p className="muted">{t("accounts.intro")}</p>
          </div>
          {connectionResult ? <p className={connectionResult === "connected" ? "muted" : "bungalow-help bungalow-help--error"}>{t(`accounts.${connectionResult}`)}</p> : null}
          <Button size="sm" tone="primary" disabled={connect.isPending} onClick={() => connect.mutate(undefined, { onSuccess: (url) => window.location.assign(url) })}>
            {t("accounts.connectGithub")}
          </Button>
        </div>
        {accounts.isLoading ? <p className="stat-label">{t("app.loading")}</p> : null}
        {!accounts.isLoading && !accounts.data?.length ? <p className="muted">{t("accounts.empty")}</p> : null}
        {accounts.data?.map((account) => (
          <div className="panel-head" key={account.id}>
            <div className="stack">
              <strong>{account.display_name || account.login}</strong>
              <span className="muted">@{account.login}</span>
              <span><Badge>{t("accounts.github")}</Badge></span>
            </div>
            <Button
              size="sm"
              tone="danger"
              disabled={disconnect.isPending}
              onClick={() => window.confirm(t("accounts.confirmDisconnect")) && disconnect.mutate(account.id)}
            >
              {t("accounts.disconnect")}
            </Button>
          </div>
        ))}
        {connect.error ? <p className="bungalow-help bungalow-help--error">{connect.error.message}</p> : null}
        {disconnect.error ? <p className="bungalow-help bungalow-help--error">{disconnect.error.message}</p> : null}
        {accounts.error ? <p className="bungalow-help bungalow-help--error">{accounts.error.message}</p> : null}
      </div>
    </Card>
  );
}
