import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase/client";
import { publicOrigin } from "../shell/desktopApp";
import { entityIdentifier, isUuid } from "./slugs";
import { entityFromPath, isEntityUri, parseEntityUri, resolveEntityUri, toPublicPath, toEntityUri, type EntityType } from "./uri";

/**
 * Inside the app, spacify: URIs address rows by uuid (library, playlists, tags and covers key on
 * it). What a user copies to share uses the row's slug instead, or its base62 identifier while the
 * slug hasn't loaded or the row has none, so it reads like the app's own URLs. Both still open the
 * right row: routes match slugs and identifiers (findByEntityKey), and old uuid links redirect.
 */
export function useShareKey(uri: string | undefined, enabled: boolean): string | undefined {
  const id = uri ? parseEntityUri(uri)?.entityId : undefined;
  const lookup = enabled && !!id && isUuid(id);
  const slug = useQuery({
    queryKey: ["entity-slugs", [id]],
    enabled: lookup,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("entity_slugs", { p_keys: [id!] });
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.key.toLowerCase(), row.slug]));
    },
  });
  if (!id) return undefined;
  if (!isUuid(id)) return id;
  return slug.data?.get(id.toLowerCase()) || entityIdentifier(id);
}

/** The URI to copy: spacify:<type>:<slug or identifier>. */
export function shareUri(uri: string, key: string): string {
  const parsed = parseEntityUri(uri);
  return parsed ? toEntityUri(parsed.entityType, key) : uri;
}

/**
 * The web address of an entity: this app's origin (protocol, host and port; the public site inside
 * the desktop app, whose own origin is sp://) plus the public path its spacify: URI opens (/supplier/acme). Null for types
 * without a page of their own (entries).
 */
export function shareUrl(uri: string, key: string): string | null {
  const target = resolveEntityUri(shareUri(uri, key));
  return target?.kind === "path" ? `${publicOrigin()}${toPublicPath(target.path)}` : null;
}

/**
 * The entity a pasted spacify: URI or app URL (as "Copy URL" copies it, on this origin or the
 * public site) addresses, or null when `text` is neither. The key may be a slug, an identifier or
 * a uuid; resolve it with resolveEntityKeys().
 */
export function entityRefFromText(text: string): { entityType: EntityType; entityId: string } | null {
  const value = text.trim();
  if (isEntityUri(value)) return parseEntityUri(value);
  if (!/^https?:\/\//i.test(value) || typeof window === "undefined") return null;
  try {
    const url = new URL(value);
    if (url.origin !== window.location.origin && url.origin !== publicOrigin()) return null;
    return entityFromPath(url.pathname);
  } catch {
    return null;
  }
}
