import { mediaHost } from "../media/host";
import { useSite } from "../sites/sites";
import { useUserTheme } from "../theme/userTheme";
import { resolveEntityHeader, type ResolvedEntityHeader } from "./entityHeaderSettings";
import { parseEntityUri } from "./uri";

/**
 * The header settings in effect for the entity behind `uri` here: the visitor's and the site's
 * (per type and for every type) and what its editor set for it (mediaHost's useEntityHeaderOverride).
 */
export function useEntityHeaderSettings(uri: string | null | undefined): ResolvedEntityHeader {
  const { userTheme } = useUserTheme();
  const { site } = useSite();
  const entity = mediaHost().useEntityHeaderOverride(uri);
  const type = uri ? (parseEntityUri(uri)?.entityType ?? null) : null;
  return resolveEntityHeader({ type, own: userTheme.shell, site: site?.layout, entity });
}
