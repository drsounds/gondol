import { useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Alert, Button, Checkbox, Input, Select } from "../../../../../../design-system/bungalow-79d923";
import { useI18n } from "../../../../../../i18n/i18n";
import { EntityRow } from "../../../../../../entities/EntityRow";
import type { MenuAction } from "../../../../../../entities/ActionMenu";
import { useNavigateKeepingSearch } from "../../../../../../navigation/useEntityModal";
import { EmptyState } from "../../../../../../shell/EmptyState";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { useAiMcpServers, type AiMcpServer } from "../../../../../ai/models";
import {
  compareVersions,
  serverNameFromPath,
  serverPath,
  serverReach,
  serverRepository,
  serverTitle,
  useMcpRegistries,
  useRegistryServers,
  type RegistryServer,
} from "../../../../models";
import { ServerArt } from "../components/ServerArt";
import { ServerSheet } from "../components/ServerSheet";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? ""));

/** Per device: the registry being browsed and whether only installable servers show. */
const REGISTRY_KEY = "gondol.serviceFinder.registry";
const REMOTE_ONLY_KEY = "gondol.serviceFinder.remoteOnly";
const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows: the choice just isn't remembered.
  }
};

/** Fetch further pages by itself while the "runs here" filter leaves fewer rows than this. */
const MIN_ROWS = 12;
const MAX_AUTO_PAGES = 8;

/**
 * The Service Finder (`/service-finder`): MCP servers from the registries the user has (the official
 * MCP registry, built in, plus their own), searchable, a page at a time. A server opens its sheet at
 * `/service-finder/servers/<registry name>`, which installs it into the user's MCP servers, the one
 * list the AI chat and the agents draw their tools from.
 */
export function ServiceFinderPage(_props: AppFeaturePageProps) {
  const { t } = useI18n();
  const go = useNavigateKeepingSearch();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const registries = useMcpRegistries();
  const enabled = useMemo(() => (registries.data ?? []).filter((r) => r.enabled), [registries.data]);
  const [registryId, setRegistryId] = useState<string | null>(() => read(REGISTRY_KEY));
  const registry = enabled.find((r) => r.id === registryId) ?? enabled[0];
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(() => read(REMOTE_ONLY_KEY) !== "false");
  const servers = useRegistryServers(registry, search);
  const installed = useAiMcpServers();
  const installedRows = useMemo(() => installed.data ?? [], [installed.data]);
  const openName = serverNameFromPath(pathname);

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(query), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const all = useMemo(() => (servers.data?.pages ?? []).flatMap((page) => page.servers.map((entry) => entry.server)), [servers.data]);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return all.filter((server) => {
      if (seen.has(server.name)) return false;
      seen.add(server.name);
      return !remoteOnly || serverReach(server) === "remote";
    });
  }, [all, remoteOnly]);

  // With the filter on, a page can hold few servers that run here: fetch on until there are some.
  const pages = servers.data?.pages.length ?? 0;
  const { hasNextPage, isFetching, fetchNextPage } = servers;
  useEffect(() => {
    if (remoteOnly && rows.length < MIN_ROWS && hasNextPage && !isFetching && pages < MAX_AUTO_PAGES) void fetchNextPage();
  }, [remoteOnly, rows.length, hasNextPage, isFetching, pages, fetchNextPage]);

  const byName = useMemo(() => {
    const map = new Map<string, AiMcpServer>();
    for (const row of installedRows) if (row.registry_server) map.set(row.registry_server, row);
    return map;
  }, [installedRows]);

  function pickRegistry(id: string) {
    setRegistryId(id);
    write(REGISTRY_KEY, id);
  }

  function status(server: RegistryServer): string {
    const mine = byName.get(server.name);
    if (mine) {
      return mine.registry_version && server.version && compareVersions(server.version, mine.registry_version) > 0
        ? t("serviceFinder.updateTo", { version: server.version })
        : t("serviceFinder.installed");
    }
    return t(`serviceFinder.reach.${serverReach(server)}`);
  }

  function actions(server: RegistryServer): MenuAction[] {
    const mine = byName.get(server.name);
    const repository = serverRepository(server);
    return [
      {
        key: mine ? "open" : "install",
        label: mine ? t("serviceFinder.open") : t("serviceFinder.install"),
        aspects: mine ? ["view"] : ["create"],
        onSelect: () => go(serverPath(server.name)),
      },
      ...(server.websiteUrl && /^https?:\/\//i.test(server.websiteUrl)
        ? [{ key: "website", label: t("serviceFinder.website"), onSelect: () => void window.open(server.websiteUrl!, "_blank", "noopener") }]
        : []),
      ...(repository ? [{ key: "repository", label: t("serviceFinder.repository"), onSelect: () => void window.open(repository, "_blank", "noopener") }] : []),
    ];
  }

  const ordered = registry ? [registry, ...enabled.filter((r) => r.id !== registry.id)] : enabled;

  return (
    <div className="stack service-finder">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{t("serviceFinder.title")}</h2>
          <p className="muted">{t("serviceFinder.intro")}</p>
        </div>
        <div className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => go("/mcp-registries")}>
            {t("serviceFinder.registries")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => go("/mcp-servers")}>
            {installedRows.length ? t("serviceFinder.installedCount", { count: installedRows.length }) : t("serviceFinder.installedTitle")}
          </Button>
        </div>
      </div>

      <div className="service-finder__controls">
        <Input
          label={t("serviceFinder.search")}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("serviceFinder.searchPlaceholder")}
          autoFocus
        />
        {enabled.length > 1 ? (
          <Select label={t("serviceFinder.registry")} value={registry?.id ?? ""} onChange={(e) => pickRegistry(e.target.value)}>
            {enabled.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Checkbox
          label={t("serviceFinder.remoteOnly")}
          checked={remoteOnly}
          onChange={(e) => {
            setRemoteOnly(e.target.checked);
            write(REMOTE_ONLY_KEY, String(e.target.checked));
          }}
        />
      </div>

      {registries.error ? <Alert tone="danger">{errorText(registries.error)}</Alert> : null}
      {servers.error ? <Alert tone="danger">{t("serviceFinder.registryError", { name: registry?.name ?? "", error: errorText(servers.error) })}</Alert> : null}

      {registries.isLoading || (servers.isLoading && !rows.length) ? (
        <p className="muted">{t("app.loading")}</p>
      ) : !registry ? (
        <EmptyState
          items={t("serviceFinder.registryItems")}
          actionLabel={t("serviceFinder.addRegistry")}
          onAction={() => go("/mcp-registries/new")}
        />
      ) : rows.length === 0 && !servers.isFetching ? (
        <EmptyState
          items={t("serviceFinder.items")}
          description={search.trim() || remoteOnly ? t("serviceFinder.noMatch") : undefined}
        />
      ) : (
        <ul className="library-list service-finder__list">
          {rows.map((server) => (
            <EntityRow
              key={server.name}
              name={serverTitle(server)}
              art={<ServerArt server={server} />}
              meta={
                <>
                  <span className="service-finder__line">
                    <span className={byName.has(server.name) ? "service-finder__installed" : undefined}>{status(server)}</span>
                    {` · ${[server.name, server.version ? `v${server.version}` : ""].filter(Boolean).join(" · ")}`}
                  </span>
                  {server.description ? <span className="service-finder__description">{server.description}</span> : null}
                </>
              }
              onOpen={() => go(serverPath(server.name))}
              actions={actions(server)}
            />
          ))}
        </ul>
      )}

      {servers.hasNextPage ? (
        <div className="service-finder__more">
          <Button variant="outline" size="sm" loading={servers.isFetchingNextPage} onClick={() => void servers.fetchNextPage()}>
            {t("serviceFinder.more")}
          </Button>
        </div>
      ) : null}

      {openName ? (
        <ServerSheet
          key={openName}
          name={openName}
          registries={ordered}
          installed={installedRows}
          position={installedRows.length}
          onClose={() => go("/service-finder")}
          onInstalled={() => go("/mcp-servers")}
        />
      ) : null}
    </div>
  );
}
