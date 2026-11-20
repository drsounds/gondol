import type { AppFeaturePageProps } from "../../../../../../apps/types";
import { CookieSettings } from "../../../../components/CookieSettings";

/** Cookie settings (`/cookies`): the user's consent on this device, to change or take back. */
export function CookiesPage(_props: AppFeaturePageProps) {
  return <CookieSettings />;
}
