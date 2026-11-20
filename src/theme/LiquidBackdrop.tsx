import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mediaHost } from "../media/host";
import {
  liquidBackgroundDim,
  liquidBackgroundOf,
  liquidStrength,
  liquidUsesCustomBackground,
  type LiquidBackground,
  type LiquidSettings,
} from "./liquidTheme";

/**
 * The liquid engine's backdrop (see liquidTheme.ts): one fixed canvas behind the whole app that
 *
 * - paints the background: a built-in wallpaper (soft blobs of colour) or the user's own image,
 *   cover-fitted and dimmed;
 * - frosts it under the big shell panels (the content panel, the menu, Your Library), drawing a
 *   blurred copy clipped to each panel's rounded box. Those panels hold sheets and other fixed
 *   layers, which a CSS backdrop-filter on them would trap inside their box, so their frost comes
 *   from here and liquid.css only gives them a translucent fill. Small surfaces (buttons, fields,
 *   the tab bar, sheets) use a real backdrop-filter;
 * - moves the light as anything scrolls: --liquid-angle (the sheen's direction) and
 *   --liquid-lx / --liquid-ly (where the rim highlight sits) on the root element.
 */

/** The shell panels frosted on the canvas. Phones only have the content panel. */
const DESKTOP_PANELS = ".app-main, .sidebar-column > .bottom-nav, .app-submenu, .sidebar-library";
const PHONE_PANELS = ".app-main";
const DESKTOP_QUERY = "(min-width: 64rem)";

interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/** A built-in wallpaper at the given size: a base colour, blurred blobs and a soft diagonal sheen. */
function paintWallpaper(ctx: CanvasRenderingContext2D, w: number, h: number, bg: LiquidBackground, dark: boolean) {
  ctx.fillStyle = dark ? bg.base[1] : bg.base[0];
  ctx.fillRect(0, 0, w, h);
  const side = Math.max(w, h);
  ctx.globalCompositeOperation = dark ? "screen" : "multiply";
  for (const blob of bg.blobs) {
    const cx = blob.x * w;
    const cy = blob.y * h;
    const r = blob.r * side;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, hexAlpha(blob.color, dark ? 0.75 : 0.85));
    gradient.addColorStop(0.55, hexAlpha(blob.color, dark ? 0.25 : 0.35));
    gradient.addColorStop(1, hexAlpha(blob.color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = "source-over";
  // A wide, faint band of light across the wallpaper, like a reflection on a curved surface.
  const sheen = ctx.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0.3, "rgba(255,255,255,0)");
  sheen.addColorStop(0.45, dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.35)");
  sheen.addColorStop(0.6, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Draws `image` to cover w×h, like background-size: cover. */
function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function roundedRect(ctx: CanvasRenderingContext2D, { x, y, w, h, r }: PanelBox) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** A blurred copy of `source`: scaled down and back up (works where ctx.filter doesn't), then a
 * real blur on top where the browser has one. */
function blurred(source: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const factor = Math.max(4, Math.round(4 + amount / 4));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(source.width / factor));
  small.height = Math.max(1, Math.round(source.height / factor));
  const sctx = small.getContext("2d");
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const octx = out.getContext("2d");
  if (!sctx || !octx) return source;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(source, 0, 0, small.width, small.height);
  octx.imageSmoothingQuality = "high";
  if ("filter" in octx) octx.filter = `blur(${Math.round(amount / 3)}px) saturate(1.4)`;
  octx.drawImage(small, 0, 0, out.width, out.height);
  if ("filter" in octx) octx.filter = "none";
  return out;
}

function sameBoxes(a: PanelBox[], b: PanelBox[]): boolean {
  return a.length === b.length && a.every((box, i) => box.x === b[i].x && box.y === b[i].y && box.w === b[i].w && box.h === b[i].h && box.r === b[i].r);
}

function measurePanels(): PanelBox[] {
  const selector = window.matchMedia(DESKTOP_QUERY).matches ? DESKTOP_PANELS : PHONE_PANELS;
  const boxes: PanelBox[] = [];
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    boxes.push({ x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height), r });
  });
  return boxes;
}

/** The image a custom background shows: a media library image's address, else the typed address. */
function useCustomImageSrc(settings: LiquidSettings): string | null {
  const host = useMemo(() => mediaHost(), []);
  const images = host.useImages();
  if (!liquidUsesCustomBackground(settings)) return null;
  if (settings.backgroundMediaId) {
    const found = images.data?.find((image) => image.id === settings.backgroundMediaId);
    if (found?.src) return found.src;
  }
  return settings.backgroundUrl || null;
}

export function LiquidBackdrop({ settings, dark }: { settings: LiquidSettings; dark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const customSrc = useCustomImageSrc(settings);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const strength = liquidStrength(settings);
  const dim = liquidBackgroundDim(settings);
  const wallpaper = liquidBackgroundOf(settings);
  const reflections = settings.reflections !== false;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!customSrc) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => !cancelled && setImage(img);
    img.onerror = () => !cancelled && setImage(null);
    img.src = customSrc;
    return () => {
      cancelled = true;
    };
  }, [customSrc]);

  // Paint the background and the frosted panels; again whenever the window or a panel changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!mounted || !canvas) return;
    let frame = 0;
    let boxes: PanelBox[] = [];
    let size = { w: 0, h: 0, dpr: 1 };
    let background: HTMLCanvasElement | null = null;
    let frost: HTMLCanvasElement | null = null;

    const paintBackground = () => {
      const bg = document.createElement("canvas");
      bg.width = Math.round(size.w * size.dpr);
      bg.height = Math.round(size.h * size.dpr);
      const ctx = bg.getContext("2d");
      if (!ctx) return;
      if (image) drawCover(ctx, image, bg.width, bg.height);
      else paintWallpaper(ctx, bg.width, bg.height, wallpaper, dark);
      if (dim > 0) {
        ctx.fillStyle = dark ? `rgba(0,0,0,${dim / 100})` : `rgba(255,255,255,${dim / 100})`;
        ctx.fillRect(0, 0, bg.width, bg.height);
      }
      background = bg;
      frost = blurred(bg, (8 + strength * 0.5) * size.dpr);
    };

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !background) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(background, 0, 0);
      if (!frost) return;
      for (const box of boxes) {
        ctx.save();
        ctx.scale(size.dpr, size.dpr);
        roundedRect(ctx, box);
        ctx.clip();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(frost, 0, 0);
        ctx.restore();
      }
    };

    const update = () => {
      frame = 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      const resized = w !== size.w || h !== size.h || dpr !== size.dpr;
      const nextBoxes = measurePanels();
      if (!resized && background && sameBoxes(boxes, nextBoxes)) return;
      boxes = nextBoxes;
      if (resized || !background) {
        size = { w, h, dpr };
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        paintBackground();
      }
      draw();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("resize", schedule);
    // Panels come and go (navigation, the library turned on, a splitter dragged).
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      mutations.disconnect();
    };
  }, [mounted, image, wallpaper, dark, dim, strength]);

  // The light follows the scroll: the sheen turns and the rim highlight runs round the edges.
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.style.removeProperty("--liquid-angle");
      root.style.removeProperty("--liquid-lx");
      root.style.removeProperty("--liquid-ly");
    };
    if (!reflections || typeof window === "undefined") {
      clear();
      return;
    }
    let frame = 0;
    let offset = 0;
    const apply = () => {
      frame = 0;
      // 0.12° per pixel: a long scroll swings the light once round the glass.
      const angle = (150 + offset * 0.12) % 360;
      const rad = ((angle - 90) * Math.PI) / 180;
      root.style.setProperty("--liquid-angle", `${angle.toFixed(1)}deg`);
      root.style.setProperty("--liquid-lx", (-Math.cos(rad)).toFixed(3));
      root.style.setProperty("--liquid-ly", (-Math.sin(rad)).toFixed(3));
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      offset = target instanceof Element ? target.scrollTop + target.scrollLeft * 0.5 : window.scrollY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
      clear();
    };
  }, [reflections]);

  if (!mounted) return null;
  return createPortal(<canvas ref={canvasRef} className="liquid-backdrop" aria-hidden="true" />, document.body);
}
