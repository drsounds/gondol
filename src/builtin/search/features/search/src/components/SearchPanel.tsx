import { useEffect, useState, type CSSProperties } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ActionMenu } from "../../../../../../entities/ActionMenu";
import { EntityArt } from "../../../../../../entities/EntityArt";
import { Spinner } from "../../../../../../shell/Spinner";
import { Alert, Icon } from "../../../../../../design-system/bungalow-79d923";
import { supabase } from "../../../../../../supabase/client";
import type { SearchRouteSearch } from "../../../../../../navigation/dateRangeSearch";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import { featureForPath, useSiteEntityFilter, useSiteShows } from "../../../../../../sites/sites";
import { useSiteOffers } from "../../../../../../sites/capabilities";
import { useActiveBundles } from "../../../../../../apps/hooks";
import { featureCapability } from "../../../../../../apps/registry";
import { deactivateSearchField, searchFieldProps, useSearchFieldActive } from "../../../../../../search/searchFieldActive";
import { toEntityUri, type EntityType } from "../../../../../../entities/uri";
import type { SearchBrowseTile } from "../../../../../../apps/shellHooks";

interface Props {
  /** Opens an entity by its URI (the shell's resolver, which also handles shell-sheet types). */
  onOpenUri: (uri: string) => void;
  /** The "Browse all" tiles (the app's main lists). */
  browse?: SearchBrowseTile[];
}

export interface SearchResult {
  entity_type: EntityType;
  entity_id: string;
  title: string | null;
  subtitle: string | null;
  is_own: boolean;
  is_public: boolean;
  rank: number;
  updated_at?: string | null;
}

/** A "Browse all" tile shown before anything is typed, like Spotify's genre grid. */
export type { SearchBrowseTile };


const RECENT_STORAGE_KEY = "cashflow-recent-searches";
const RECENT_LIMIT = 10;
type RecentItem = Pick<SearchResult, "entity_type" | "entity_id" | "title" | "subtitle">;

function readRecent(): RecentItem[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as RecentItem[]).filter((r) => r && r.entity_type && r.entity_id) : [];
  } catch {
    return [];
  }
}
function writeRecent(items: RecentItem[]) {
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items.slice(0, RECENT_LIMIT)));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); recents are a nicety.
  }
}

/** Waits for typing to pause before `value` propagates, so each keystroke isn't a query. */
function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * Spotify-style search over every entity the user can see (their own, plus other users' public
 * playlists/apps), backed by the `search_entities` full-text Postgres function. `/search?q=` holds
 * the query and `&type=` the selected filter chip, so results survive reloads and back/forward.
 * Before anything is typed it shows a "Browse all" grid of sections, or, while a search field is
 * active (searchFieldActive.ts), the recent searches.
 */
export function SearchPanel({ onOpenUri, browse = [] }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as SearchRouteSearch;
  const q = search.q ?? "";
  const typeFilter = (search.type ?? null) as EntityType | null;
  const debouncedQ = useDebounced(q.trim(), 200);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const siteFilter = useSiteEntityFilter();
  const siteShows = useSiteShows();
  useEffect(() => setRecent(readRecent()), []);
  // Recents of types the site leaves out stay stored (other sites may show them) but aren't listed.
  const shownRecent = recent.filter((r) => siteShows.type(r.entity_type));
  // Recent searches only while a search field is active and empty; the browse grid otherwise.
  const fieldActive = useSearchFieldActive();
  const showRecent = fieldActive && shownRecent.length > 0;
  // Browse tiles of apps that are off (here or by the user) or features the site doesn't offer go.
  const activeBundles = useActiveBundles();
  const offers = useSiteOffers();
  const shownBrowse = browse.filter((tile) => {
    const owner = featureForPath(tile.path);
    return !owner || (activeBundles.some((b) => b.id === owner.app.id) && offers(featureCapability(owner.app, owner.feature)));
  });

  function setSearch(next: Partial<SearchRouteSearch>) {
    navigate({ to: "/search", search: (prev: SearchRouteSearch) => ({ ...prev, ...next }), replace: true } as Parameters<
      typeof navigate
    >[0]);
  }

  const results = useQuery({
    queryKey: ["search", debouncedQ],
    enabled: debouncedQ.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_entities", { p_query: debouncedQ, p_limit: 100 });
      if (error) throw error;
      return (data ?? []) as SearchResult[];
    },
  });
  // Only what the site served on this domain shows (src/lib/sites.tsx).
  const all = debouncedQ ? siteFilter(results.data ?? []) : [];
  const types = [...new Set(all.map((r) => r.entity_type))];
  const filtered = typeFilter ? all.filter((r) => r.entity_type === typeFilter) : all;

  function open(result: RecentItem) {
    const next = [result, ...readRecent().filter((r) => !(r.entity_type === result.entity_type && r.entity_id === result.entity_id))];
    writeRecent(next);
    setRecent(next.slice(0, RECENT_LIMIT));
    deactivateSearchField();
    onOpenUri(toEntityUri(result.entity_type, result.entity_id));
  }
  function forget(result: RecentItem) {
    const next = recent.filter((r) => !(r.entity_type === result.entity_type && r.entity_id === result.entity_id));
    writeRecent(next);
    setRecent(next);
  }

  return (
    <div className="search-page">
      {/* On desktop the chrome bar's field drives the query; phones get Spotify mobile's big field. */}
      <form className="search-page__field" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="search-page__field-label">
          <SearchGlyph />
          <input
            type="search"
            className="search-page__input"
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            {...searchFieldProps}
            value={q}
            onChange={(e) => setSearch({ q: e.target.value || undefined, type: undefined })}
          />
        </label>
      </form>

      {!q.trim() ? (
        <>
          {showRecent ? (
            <section className="search-section" data-search-recent="">
              <div className="search-section__head">
                <h2 className="search-section__title">{t("search.recent")}</h2>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    writeRecent([]);
                    setRecent([]);
                  }}
                >
                  {t("search.clearRecent")}
                </button>
              </div>
              <ul className="search-list">
                {shownRecent.map((r) => (
                  <ResultRow
                    key={`${r.entity_type}:${r.entity_id}`}
                    result={r}
                    onOpen={() => open(r)}
                    extraActions={[{ key: "forget", label: t("search.removeRecent"), tone: "danger", onSelect: () => forget(r) }]}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <section className="search-section">
              <h2 className="search-section__title">{t("search.browseAll")}</h2>
              <div className="browse-grid">
                {shownBrowse.map((b) => (
                  <button
                    key={b.path}
                    type="button"
                    className="browse-tile"
                    style={{ "--tile-hue": b.hue } as CSSProperties}
                    onClick={() => navigate({ to: b.path, search: (prev: SearchRouteSearch) => prev } as Parameters<typeof navigate>[0])}
                  >
                    <span className="browse-tile__label">{t(b.label)}</span>
                    <Icon name={b.icon} className="browse-tile__art" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="search-chips" role="tablist" aria-label={t("search.filters")}>
            <button type="button" role="tab" aria-selected={!typeFilter} className="search-chip" onClick={() => setSearch({ type: undefined })}>
              {t("search.all")}
            </button>
            {types.map((type) => (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={typeFilter === type}
                className="search-chip"
                onClick={() => setSearch({ type: typeFilter === type ? undefined : type })}
              >
                {t(`entity.${type}` as MessageKey)}
              </button>
            ))}
          </div>

          {results.error ? <Alert tone="danger">{t("search.error")}</Alert> : null}
          {results.isPending && debouncedQ ? (
            <Spinner label={t("search.searching")} />
          ) : filtered.length === 0 && debouncedQ ? (
            <div className="search-empty">
              <h2 className="search-empty__title">{t("search.noResults", { query: debouncedQ })}</h2>
              <p className="muted">{t("search.noResultsHint")}</p>
            </div>
          ) : typeFilter ? (
            <section className="search-section">
              <ul className="search-list">
                {filtered.map((r) => (
                  <ResultRow key={`${r.entity_type}:${r.entity_id}`} result={r} onOpen={() => open(r)} />
                ))}
              </ul>
            </section>
          ) : filtered.length > 0 ? (
            <AllResults results={filtered} onOpen={open} onShowType={(type) => setSearch({ type })} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** The "All" view: top result + best matches side by side, then one shelf per entity type. */
function AllResults({
  results,
  onOpen,
  onShowType,
}: {
  results: SearchResult[];
  onOpen: (r: SearchResult) => void;
  onShowType: (type: EntityType) => void;
}) {
  const { t } = useI18n();
  const [top, ...rest] = results;
  const byType = new Map<EntityType, SearchResult[]>();
  for (const r of results) byType.set(r.entity_type, [...(byType.get(r.entity_type) ?? []), r]);

  return (
    <>
      <div className="search-top">
        <section className="search-section">
          <h2 className="search-section__title">{t("search.topResult")}</h2>
          <TopResultCard result={top} onOpen={() => onOpen(top)} />
        </section>
        {rest.length > 0 ? (
          <section className="search-section">
            <h2 className="search-section__title">{t("search.bestMatches")}</h2>
            <ul className="search-list">
              {rest.slice(0, 4).map((r) => (
                <ResultRow key={`${r.entity_type}:${r.entity_id}`} result={r} onOpen={() => onOpen(r)} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {[...byType].map(([type, items]) => (
        <section key={type} className="search-section">
          <div className="search-section__head">
            <h2 className="search-section__title">{t(`entity.${type}` as MessageKey)}</h2>
            {items.length > 6 ? (
              <button type="button" className="link-button" onClick={() => onShowType(type)}>
                {t("search.showAll")}
              </button>
            ) : null}
          </div>
          <div className="search-shelf">
            {items.slice(0, 6).map((r) => (
              <ResultCard key={r.entity_id} result={r} onOpen={() => onOpen(r)} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function displayTitle(result: RecentItem) {
  return result.title?.trim() || "—";
}

function useSubtitle(result: RecentItem & { is_own?: boolean; is_public?: boolean }) {
  const { t } = useI18n();
  return [t(`entity.${result.entity_type}` as MessageKey), result.subtitle, result.is_own === false ? t("visibility.public") : null]
    .filter(Boolean)
    .join(" · ");
}

function entityMenu(result: RecentItem, onOpen: () => void, t: ReturnType<typeof useI18n>["t"]) {
  return {
    name: displayTitle(result),
    uri: toEntityUri(result.entity_type, result.entity_id),
    actions: [{ key: "open", label: t("actions.open"), onSelect: onOpen }],
  };
}

function ResultRow({
  result,
  onOpen,
  extraActions = [],
}: {
  result: RecentItem;
  onOpen: () => void;
  extraActions?: Parameters<typeof ActionMenu>[0]["actions"];
}) {
  const { t } = useI18n();
  const title = displayTitle(result);
  const subtitle = useSubtitle(result);
  const menu = entityMenu(result, onOpen, t);
  return (
    <li className="search-row action-row">
      <button type="button" className="search-row__main" onClick={onOpen}>
        <EntityArt type={result.entity_type} title={title} size="sm" uri={toEntityUri(result.entity_type, result.entity_id)} />
        <span className="search-row__text">
          <span className="search-row__title">{title}</span>
          <span className="search-row__sub">{subtitle}</span>
        </span>
      </button>
      <ActionMenu {...menu} actions={[...menu.actions, ...extraActions]} />
    </li>
  );
}

function TopResultCard({ result, onOpen }: { result: SearchResult; onOpen: () => void }) {
  const { t } = useI18n();
  const title = displayTitle(result);
  return (
    <div className="search-top-card action-row">
      <button type="button" className="search-top-card__main" onClick={onOpen}>
        <EntityArt type={result.entity_type} title={title} size="lg" uri={toEntityUri(result.entity_type, result.entity_id)} />
        <span className="search-top-card__title">{title}</span>
        <span className="search-top-card__meta">
          <span className="search-badge">{t(`entity.${result.entity_type}` as MessageKey)}</span>
          {result.subtitle ? <span className="muted">{result.subtitle}</span> : null}
          {!result.is_own ? <span className="search-badge search-badge--public">{t("visibility.public")}</span> : null}
        </span>
      </button>
      <span className="search-top-card__play" aria-hidden="true">
        <Icon name="play" />
      </span>
      <ActionMenu {...entityMenu(result, onOpen, t)} />
    </div>
  );
}

function ResultCard({ result, onOpen }: { result: SearchResult; onOpen: () => void }) {
  const { t } = useI18n();
  const title = displayTitle(result);
  return (
    <div className="search-card action-row">
      <button type="button" className="search-card__main" onClick={onOpen}>
        <EntityArt type={result.entity_type} title={title} size="md" uri={toEntityUri(result.entity_type, result.entity_id)} />
        <span className="search-card__title">{title}</span>
        <span className="search-card__sub">{result.subtitle || (result.is_own ? t(`entity.${result.entity_type}` as MessageKey) : t("visibility.public"))}</span>
      </button>
      <ActionMenu {...entityMenu(result, onOpen, t)} />
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="search-page__icon">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 11 14.5 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
