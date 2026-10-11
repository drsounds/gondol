import { Suspense } from "react";
import { Spinner } from "../../shell/Spinner";
import { useI18n } from "../../i18n/i18n";
import type { AppFeature, AppFeaturePageProps } from "../types";

/**
 * Renders a feature's page. Pages are lazy (defineApp), so the first visit loads the app's code;
 * navigations run in a transition, so the page on screen stays until the next one is ready, and
 * the spinner only shows when there is nothing to keep (a first load or a reload).
 */
export function FeaturePage({ feature, ...props }: AppFeaturePageProps & { feature: AppFeature }) {
  const { t } = useI18n();
  const Page = feature.Page;
  return (
    <Suspense fallback={<Spinner label={t("app.loading")} />}>
      <Page {...(props as AppFeaturePageProps)} />
    </Suspense>
  );
}
