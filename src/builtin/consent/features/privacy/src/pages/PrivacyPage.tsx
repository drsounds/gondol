import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { PrivacyPolicy } from "../../../../components/PrivacyPolicy";

/** The privacy policy (`/privacy`), in Swedish or English after the user's language. */
export function PrivacyPage(_props: AppFeaturePageProps) {
  return (
    <div className="stack">
      <PrivacyPolicy />
    </div>
  );
}
