import { useNavigate } from "@tanstack/react-router";
import { LibraryPanel } from "../components/LibraryPanel";
import { resolveEntityUri } from "../../../../../../entities/uri";
import type { AppFeaturePageProps } from "../../../../../../apps/types";

export function LibraryPage(props: AppFeaturePageProps) {
  const navigate = useNavigate();

  const handleOpenUri = props.onOpenUri ?? ((uri: string) => {
    const target = resolveEntityUri(uri);
    if (target && target.kind === "path") {
      navigate({ to: target.path } as Parameters<typeof navigate>[0]);
    }
  });

  return <LibraryPanel onOpenUri={handleOpenUri} />;
}

