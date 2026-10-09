/** Best-effort favicon URL for an embed_url's origin, used as an app's default icon. */
export function faviconUrlFor(embedUrl: string): string | null {
  try {
    const origin = new URL(embedUrl).origin;
    return `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(origin)}`;
  } catch {
    return null;
  }
}

/**
 * Joins an app's embed_url with the splat path captured from /app/$appId/*,
 * so a deep link into our routing translates into the embedded app's own
 * internal routing (e.g. embed_url "https://tool.example/app" + splat
 * "projects/42" -> "https://tool.example/app/projects/42").
 */
export function buildEmbedSrc(embedUrl: string, splat: string): string {
  if (!splat) return embedUrl;
  try {
    const url = new URL(embedUrl);
    const base = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    url.pathname = `${base}/${splat}`;
    return url.toString();
  } catch {
    return embedUrl;
  }
}

/** An external app's plain web URL when it has no embed_url, i.e. it opens in a new window instead of an iframe. */
export function externalWindowUrl(app: { embed_url: string | null; url: string | null }): string | null {
  if (app.embed_url?.trim()) return null;
  return app.url?.trim() || null;
}

/** The /app/... path segment for an app: its slug (see src/lib/slugs.ts), else its id. */
export function appPathKey(app: { id: string; slug?: string | null }): string {
  return app.slug || app.id;
}
