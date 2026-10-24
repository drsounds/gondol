import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { useResolutions } from "../../../../../../apps/contributions";
import { byOrder, searchBrowseHook } from "../../../../../../apps/shellHooks";
import { resolveEntityUri } from "../../../../../../entities/uri";
import { SearchPanel } from "../components/SearchPanel";

/** `/search`: the results for `?q=`, else the "Browse all" tiles of the apps that are on here. */
export function SearchPage({ onOpenUri }: AppFeaturePageProps) {
  const navigate = useNavigate();
  const answers = useResolutions(searchBrowseHook);
  const browse = useMemo(() => byOrder(answers.map((a) => a.value)), [answers]);
  const open =
    onOpenUri ??
    ((uri: string) => {
      const target = resolveEntityUri(uri);
      if (target?.kind === "path") navigate({ to: target.path } as Parameters<typeof navigate>[0]);
    });
  return <SearchPanel onOpenUri={open} browse={browse} />;
}
