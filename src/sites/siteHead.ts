/**
 * The page's name and icon on a site: its `name` stands in for the app's own name in the document
 * title ("Apps — Spacify" reads "Apps — My site"), and its `favicon_url` replaces the app's icons.
 * The routes' head() keep writing the app's name; `applySiteHead()` rewrites the <head> after them,
 * and keeps doing so as navigations change it. Public pages rendered on the server set both in
 * their own head() already.
 */

let appName = "";

/** The app's own name as its routes write it in titles (configureGondol's `appName`). */
export function configureAppName(name: string): void {
  appName = name;
}

export function getAppName(): string {
  return appName;
}

const ICON_SELECTOR = 'link[rel~="icon"], link[rel="apple-touch-icon"]';
const ORIGINAL_HREF = "data-gondol-href";

/** A title with the app's name replaced by the site's. */
export function siteTitle(title: string, siteName: string, name: string = appName): string {
  if (!name || !siteName || name === siteName || !title.includes(name)) return title;
  return title.split(name).join(siteName);
}

/** Whether a favicon address is one we'll put in a <link> (http(s), or a path on this host). */
export function isFaviconUrl(value: string | null | undefined): value is string {
  return !!value && (/^https?:\/\/\S+$/i.test(value) || /^\/(?!\/)\S*$/.test(value));
}

function applyIcons(favicon: string | null) {
  document.head.querySelectorAll<HTMLLinkElement>(ICON_SELECTOR).forEach((link) => {
    const original = link.getAttribute(ORIGINAL_HREF) ?? link.getAttribute("href") ?? "";
    if (!link.hasAttribute(ORIGINAL_HREF)) link.setAttribute(ORIGINAL_HREF, original);
    const href = favicon ?? original;
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    // The app's icons say what they are; the site's can be anything.
    if (favicon) link.removeAttribute("type");
  });
}

/**
 * Puts the site's name in the title and its favicon in the icon links, now and whenever the head
 * changes; returns the function that stops (and gives the app's icons back).
 */
export function applySiteHead(site: { name: string; favicon_url?: string | null } | null): () => void {
  if (typeof document === "undefined") return () => {};
  const name = site?.name.trim() ?? "";
  const favicon = isFaviconUrl(site?.favicon_url) ? site.favicon_url : null;
  const apply = () => {
    if (name) {
      const title = siteTitle(document.title, name);
      if (title !== document.title) document.title = title;
    }
    applyIcons(favicon);
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href"] });
  return () => {
    observer.disconnect();
    applyIcons(null);
  };
}
