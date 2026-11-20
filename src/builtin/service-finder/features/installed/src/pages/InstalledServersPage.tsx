import { useI18n } from "../../../../../../i18n/i18n";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { AiMcpServersSection } from "../../../../../ai/features/models/src/components/AiMcpServers";

/**
 * The servers the user has installed (`/mcp-servers`): the ai app's MCP servers, the one
 * list the AI chat and the agents draw their tools from, whether installed from a registry or added
 * by address. `/mcp-servers/new` and `/mcp-servers/<id>/edit` are the
 * routed sheets (the same ones as on `/ai-models`).
 */
export function InstalledServersPage(_props: AppFeaturePageProps) {
  const { t } = useI18n();
  return (
    <div className="stack service-finder">
      <AiMcpServersSection
        listPath="/mcp-servers"
        closePath="/mcp-servers"
        title={t("serviceFinder.installedTitle")}
        intro={t("serviceFinder.installedIntro")}
      />
    </div>
  );
}
