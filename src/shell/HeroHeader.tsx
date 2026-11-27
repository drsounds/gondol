import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { useOptionalUserTheme } from "../theme/userTheme";
import { mediaHost } from "../media/host";

/** The tint's colour when the visitor (or the site) picked none, and an image gives none. */
export const DEFAULT_HEADER_TINT = "#5b6bd2";

/** How much slower than the page a header's image scrolls with parallax on (0 = moves with the page, 1 = stays put). */
const PARALLAX_RATE = 0.45;

const imageColors = new Map<string, Promise<string | null>>();

/** The dominant vibrant colour of an image (node-vibrant), as #rrggbb, or null when it can't be read
 * (no CORS, not an image). Each address is read once per page load. */
export function imageColor(src: string): Promise<string | null> {
  let found = imageColors.get(src);
  if (!found) {
    found = import("node-vibrant/browser")
      .then(({ Vibrant }) => Vibrant.from(src).quality(5).getPalette())
      .then((palette) => (palette.Vibrant ?? palette.DarkVibrant ?? palette.Muted ?? palette.LightVibrant ?? palette.DarkMuted)?.hex ?? null)
      .catch(() => null);
    imageColors.set(src, found);
  }
  return found;
}

/** imageColor() as a hook: null until it is known (or when there is no image). */
export function useImageColor(src: string | null | undefined): string | null {
  const [color, setColor] = useState<{ src: string; color: string | null } | null>(null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    void imageColor(src).then((c) => live && setColor({ src, color: c }));
    return () => {
      live = false;
    };
  }, [src]);
  return src && color?.src === src ? color.color : null;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Moves `--hero-shift` with the page's scroll while `on`: how far the image layer is pushed down. */
function useParallax(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on || reducedMotion()) {
      el?.style.removeProperty("--hero-shift");
      return;
    }
    let frame = 0;
    let scroller: Element | Document = document;
    const measure = () => {
      frame = 0;
      const top = scroller instanceof Element ? scroller.getBoundingClientRect().top : 0;
      const past = Math.max(0, Math.min(top - el.getBoundingClientRect().top, el.offsetHeight));
      el.style.setProperty("--hero-shift", `${Math.round(past * PARALLAX_RATE)}px`);
    };
    // Any scroll container: the app shell's main column, a sheet, or the document.
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element ? !target.contains(el) : target !== document) return;
      scroller = target instanceof Element ? target : document;
      if (!frame) frame = requestAnimationFrame(measure);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    measure();
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
      el.style.removeProperty("--hero-shift");
    };
  }, [ref, on]);
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Runs the header edge to edge: cancels the padding of the page it sits at the top of (the closest
 * `.hero-page`) with negative margins, takes that padding as its own inline padding so its content
 * lines up with the page's, and its top corners' rounding. Measured, so it fits any layout. The
 * header's height goes on the page as `--hero-height`, where the tint reads it. */
function useBleed(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  useIsoLayoutEffect(() => {
    const el = ref.current;
    const page = on ? el?.parentElement?.closest<HTMLElement>(".hero-page") : null;
    if (!el || !page) return;
    const apply = () => {
      const cs = getComputedStyle(page);
      el.style.setProperty("--hero-bleed-top", cs.paddingTop);
      el.style.setProperty("--hero-bleed-left", cs.paddingLeft);
      el.style.setProperty("--hero-bleed-right", cs.paddingRight);
      el.style.setProperty("--hero-radius-left", cs.borderTopLeftRadius);
      el.style.setProperty("--hero-radius-right", cs.borderTopRightRadius);
      page.style.setProperty("--hero-height", `${el.offsetHeight}px`);
    };
    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(page);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      page.style.removeProperty("--hero-height");
    };
  }, [ref, on]);
}

export interface HeroHeaderProps extends HTMLAttributes<HTMLElement> {
  as?: "header" | "div";
  /** The image behind the header (its backdrop), when it has one. */
  image?: string | null;
  /** Where the tint's colour comes from when it isn't `image` (a cover, say). */
  tintImage?: string | null;
  /** The entity the header is for: the tint colour its editor picked (mediaHost's useEntityTint) wins over the image's. */
  uri?: string | null;
  /** A tint colour of the entity's own (#rrggbb), when it isn't read through `uri`. */
  tintColor?: string | null;
  /** Leave the visitor's header settings out (a preview in an edit sheet). */
  plain?: boolean;
  children?: ReactNode;
}

/**
 * The big header at the top of an entity's page (a playlist, a Play show, a release), with the
 * visitor's header settings (Account › Layout, or the site's; userTheme's headerFade, headerTint,
 * headerTintColor, headerParallax):
 * - its backdrop (`image` and anything styled on `.hero-header__layer`) fades out to the bottom;
 * - a tint, in the colour the entity's editor picked (`uri`/`tintColor`), else from the image
 *   (node-vibrant) or the visitor's colour, sits behind it from the top of the
 *   page and fades out to transparent over a quarter of the viewport's height below it (so it shows
 *   through a faded header and runs on under it). It is a sibling positioned against the page, so
 *   the page element must be `position: relative; isolation: isolate` (the `.hero-page` class);
 * - the backdrop scrolls slower than the page (parallax).
 * Off `plain`, the header runs edge to edge over the page's padding (useBleed).
 * Style the header's background on `.hero-header__layer` (not on the header itself) so the fade and
 * the parallax apply to it, and its text above with the usual classes.
 */
export function HeroHeader({ as: Tag = "header", image, tintImage, uri, tintColor: ownTint, plain, className, style, children, ...rest }: HeroHeaderProps) {
  const theme = useOptionalUserTheme();
  const prefs = plain ? undefined : theme?.preferences;
  const tint = prefs?.headerTint ?? "off";
  const fade = !!prefs?.headerFade;
  const parallax = !!prefs?.headerParallax;
  const picked = prefs?.headerTintColor || DEFAULT_HEADER_TINT;
  // The entity's own colour, picked by its editor, wins whenever the tint is on.
  const entityTint = mediaHost().useEntityTint(uri) ?? ownTint ?? null;
  const source = tint === "image" && !entityTint ? (image ?? tintImage ?? null) : null;
  const fromImage = useImageColor(source);
  const tintColor =
    tint === "off" ? null : entityTint ?? (tint === "color" ? picked : (fromImage ?? (source ? null : picked)));
  const ref = useRef<HTMLElement | null>(null);
  useParallax(ref, parallax);
  useBleed(ref, !plain);

  const classes = [
    "hero-header",
    plain ? null : "hero-header--bleed",
    image ? "hero-header--image" : null,
    fade ? "hero-header--fade" : null,
    parallax ? "hero-header--parallax" : null,
    tint !== "off" ? "hero-header--tinted" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {tintColor ? <div className="hero-header__tint" aria-hidden="true" style={{ "--hero-tint": tintColor } as CSSProperties} /> : null}
      <Tag ref={ref as React.Ref<HTMLElement & HTMLDivElement>} className={classes} style={style} {...rest}>
        <div className="hero-header__backdrop" aria-hidden="true">
          <div className="hero-header__layer">{image ? <img src={image} alt="" referrerPolicy="no-referrer" /> : null}</div>
        </div>
        {children}
      </Tag>
    </>
  );
}
