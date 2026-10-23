import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { StreamsPanel } from "../components/StreamsPanel";

/** `/streams`, with its routed sheets (`/streams/new`, `/streams/<key>/edit`, `/streams/<key>/entries/…`). */
export function StreamsPage(_props: AppFeaturePageProps) {
  return <StreamsPanel />;
}
