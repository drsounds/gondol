import { useNavigate } from "@tanstack/react-router";
import { PlaylistsPanel } from "../components/PlaylistsPanel";
import { resolveEntityUri } from "../../../../../../entities/uri";
import type { AppFeaturePageProps } from "../../../../../../apps/types";

export function PlaylistsPage(props: AppFeaturePageProps) {
  const navigate = useNavigate();

  const handleOpenUri = props.onOpenUri ?? ((uri: string) => {
    const target = resolveEntityUri(uri);
    if (target && target.kind === "path") {
      navigate({ to: target.path } as Parameters<typeof navigate>[0]);
    }
  });

  return <PlaylistsPanel onOpenUri={handleOpenUri} />;
}

