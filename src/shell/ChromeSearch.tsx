import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useI18n } from "../i18n/i18n";
import { isEntityUri, resolveEntityUri, type EntityUriTarget } from "../entities/uri";
import type { SearchRouteSearch } from "../navigation/dateRangeSearch";
import { SearchIcon } from "./icons";
import { searchFieldProps } from "../search/searchFieldActive";

/**
 * The chrome search field, the desktop entry point to /search (like Spotify's top bar): typing
 * navigates there with ?q=, and while on /search it mirrors the URL's query. Anything starting with
 * the app's URI scheme is always treated as an entity URI, opened on Enter, never a search.
 * `onSearchPage`/`routeQuery`: whether /search is open and its ?q=. `openTarget` opens a resolved
 * URI (the shell's resolver, which also handles shell-sheet types).
 *
 * It also opens URIs posted to the window as `{ type: "navigate", uri }` (e.g. from Electron).
 */
export function useChromeSearch({
  onSearchPage,
  routeQuery,
  openTarget,
}: {
  onSearchPage: boolean;
  routeQuery: string;
  openTarget: (target: EntityUriTarget) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const openTargetRef = useRef(openTarget);
  openTargetRef.current = openTarget;

  const query = onSearchPage ? routeQuery : "";
  useEffect(() => {
    if (onSearchPage) setValue((prev) => (isEntityUri(prev) ? prev : query));
    else setValue((prev) => (isEntityUri(prev) ? prev : ""));
  }, [onSearchPage, query]);

  function change(next: string) {
    setValue(next);
    if (isEntityUri(next)) return;
    navigate({
      to: "/search",
      search: (prev: SearchRouteSearch) => ({ ...prev, q: next || undefined, type: undefined }),
      replace: onSearchPage,
    } as Parameters<typeof navigate>[0]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("q") as HTMLInputElement;
    if (!isEntityUri(value)) return;
    const target = resolveEntityUri(value);
    if (!target) {
      input.setCustomValidity(t("chrome.uriNotFound"));
      input.reportValidity();
      return;
    }
    setValue("");
    input.blur();
    openTarget(target);
  }

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== window && e.source !== window.parent) return;
      if (e.data?.type !== "navigate" || typeof e.data?.uri !== "string" || !isEntityUri(e.data.uri)) return;
      const target = resolveEntityUri(e.data.uri);
      if (target) openTargetRef.current(target);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return { value, change, submit };
}

export type ChromeSearchState = ReturnType<typeof useChromeSearch>;

export function ChromeSearchForm({ search }: { search: ChromeSearchState }) {
  const { t } = useI18n();
  return (
    <form className="chrome-bar__search" role="search" onSubmit={search.submit}>
      <label className="chrome-bar__search-label">
        <SearchIcon className="chrome-bar__search-icon" />
        <input
          type="search"
          name="q"
          className="chrome-bar__search-input"
          placeholder={t("chrome.searchPlaceholder")}
          aria-label={t("chrome.searchPlaceholder")}
          title={t("chrome.searchHint")}
          {...searchFieldProps}
          value={search.value}
          onChange={(e) => {
            e.target.setCustomValidity("");
            search.change(e.target.value);
          }}
        />
      </label>
    </form>
  );
}
