import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { StreamAnalyticsPanel } from "../components/StreamAnalyticsPanel";

/** `/analytics`: the user's streams, filtered and summed up. */
export function StreamAnalyticsPage(_props: AppFeaturePageProps) {
  return <StreamAnalyticsPanel />;
}
