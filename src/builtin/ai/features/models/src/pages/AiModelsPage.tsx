import { Alert, Button, Card, Checkbox } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { AppSettingsPanel } from "../../../../../../settings/AppSettingsPanel";
import { useSaveAppSetting, useSettingsScopeIds } from "../../../../../../settings/settings";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import {
  AiProviderError,
  enabledAiProviders,
  getAiProviders,
  useAiSettings,
  useProviderModels,
  useRemoveAiModel,
  useSaveAiModel,
  useSavedAiModels,
  type AiProvider,
  type AiSettings,
} from "../../../../models";

function formatSize(bytes: number | undefined): string {
  if (!bytes) return "";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

const detail = (details: Record<string, unknown> | undefined | null, key: string) => (typeof details?.[key] === "string" ? (details[key] as string) : "");

/**
 * Providers and models (`/ai-models`): each provider in use with what it serves now, which of those
 * the chat's model picker offers (kept in ai_models), the default model, and the app's settings.
 */
export function AiModelsPage(_props: AppFeaturePageProps) {
  const { t } = useI18n();
  const { settings } = useAiSettings();
  const inUse = enabledAiProviders(settings);
  const others = getAiProviders().filter((p) => !inUse.includes(p));

  return (
    <div className="stack ai-models">
      <div className="panel-head">
        <h2 className="panel-title">{t("ai.models.title")}</h2>
      </div>
      <p className="muted">{t("ai.models.intro")}</p>
      {inUse.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} settings={settings} />
      ))}
      {others.length ? <p className="muted">{t("ai.models.otherProviders", { names: others.map((p) => p.name).join(", ") })}</p> : null}
      <Card>
        <AppSettingsPanel scope="user" appIds={["ai"]} title={t("ai.settings")} />
      </Card>
    </div>
  );
}

function ProviderCard({ provider, settings }: { provider: AiProvider; settings: AiSettings }) {
  const { t } = useI18n();
  const live = useProviderModels(provider.id, settings);
  const saved = useSavedAiModels();
  const save = useSaveAiModel();
  const remove = useRemoveAiModel();
  const ids = useSettingsScopeIds();
  const saveSetting = useSaveAppSetting("user", ids.user);
  const defaultModel = typeof settings.defaultModel === "string" ? settings.defaultModel : "";
  const keptHere = (saved.data ?? []).filter((m) => m.provider === provider.id);
  const liveNames = new Set((live.data ?? []).map((m) => m.name));
  const gone = keptHere.filter((m) => live.isSuccess && !liveNames.has(m.name));
  const error = live.error as Error | null;

  return (
    <Card>
      <div className="stack">
        <div className="panel-head">
          <div>
            <div className="panel-title">{provider.name}</div>
            {provider.describe ? <div className="stat-note">{provider.describe(settings) || t("ai.serverDefault")}</div> : null}
          </div>
          <Button type="button" variant="outline" size="sm" loading={live.isFetching} onClick={() => void live.refetch()}>
            {t("ai.models.refresh")}
          </Button>
        </div>
        {error ? (
          <Alert tone="danger">
            {error.message}
            {error instanceof AiProviderError && error.kind === "unreachable"
              ? ` ${t("ai.unreachableHint", { address: provider.describe?.(settings) || t("ai.serverDefault") })}`
              : ""}
          </Alert>
        ) : null}
        {live.isSuccess && !live.data.length ? <p className="muted">{t("ai.models.none")}</p> : null}
        {live.data?.length ? (
          <table className="data-table ai-models__table">
            <thead>
              <tr>
                <th>{t("ai.models.name")}</th>
                <th>{t("ai.models.details")}</th>
                <th>{t("ai.models.size")}</th>
                <th>{t("ai.models.inPicker")}</th>
                <th aria-label={t("ai.models.default")} />
              </tr>
            </thead>
            <tbody>
              {live.data.map((model) => {
                const kept = keptHere.find((m) => m.name === model.name);
                return (
                  <tr key={model.name}>
                    <td>{model.name}</td>
                    <td className="muted">
                      {[detail(model.details, "family"), detail(model.details, "parameter_size"), detail(model.details, "quantization_level")].filter(Boolean).join(" · ")}
                    </td>
                    <td className="muted">{formatSize(model.size)}</td>
                    <td>
                      <Checkbox
                        label={t("ai.models.inPicker")}
                        className="ai-models__keep"
                        checked={!!kept?.enabled}
                        disabled={save.isPending}
                        onChange={(e) => save.mutate({ provider: provider.id, model, enabled: e.target.checked })}
                      />
                    </td>
                    <td>
                      {defaultModel === model.name ? (
                        <span className="muted">{t("ai.models.isDefault")}</span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!ids.user}
                          onClick={() => saveSetting.mutate({ appId: "ai", key: "defaultModel", value: model.name })}
                        >
                          {t("ai.models.makeDefault")}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {gone.length ? (
          <div className="stack">
            <p className="muted">{t("ai.models.gone")}</p>
            <ul className="ai-models__gone">
              {gone.map((m) => (
                <li key={m.id}>
                  <span>{m.name}</span>
                  <Button type="button" variant="ghost" size="sm" loading={remove.isPending && remove.variables === m.id} onClick={() => remove.mutate(m.id)}>
                    {t("ai.models.forget")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {save.error ? <p className="bungalow-help bungalow-help--error">{(save.error as Error).message}</p> : null}
      </div>
    </Card>
  );
}
