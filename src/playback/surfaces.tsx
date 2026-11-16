import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useServices } from "../services/ConceptsHost";
import { playback } from "./coordinator";
import { mediaAspect, type MediaService, type PlayerSurface } from "./types";

/**
 * Service surfaces: where services' players (a YouTube player, a remote service's whole page) live.
 *
 * Each service's surface is mounted once, into an element of its own in a fixed layer over the app,
 * and never moved in the DOM (moving an iframe reloads it and stops the music). Instead, the layer
 * lays the active service's surface over a **slot**: the service dock at the bottom of the desktop
 * menu, or the stage in Now playing while that's open. With no slot on screen it stays where it
 * was with `visibility: hidden`, still playing.
 */

export type SlotPlace = "dock" | "stage";

const slots = new Map<SlotPlace, HTMLElement>();
const slotListeners = new Set<() => void>();
let slotVersion = 0;

function slotsChanged() {
  slotVersion++;
  slotListeners.forEach((l) => l());
}

function subscribeSlots(listener: () => void) {
  slotListeners.add(listener);
  return () => {
    slotListeners.delete(listener);
  };
}

/** A ref for an element the active service's player should cover (`dock` or `stage`). */
export function useServiceSlot(place: SlotPlace) {
  return useCallback(
    (element: HTMLElement | null) => {
      if (element) slots.set(place, element);
      else if (slots.get(place)) slots.delete(place);
      slotsChanged();
    },
    [place],
  );
}

/** Whether `element` is on screen with room in it (not display: none, visibility: hidden or inert). */
function shown(element: HTMLElement | undefined): element is HTMLElement {
  if (!element || !element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  if (element.closest("[inert], [aria-hidden='true']")) return false;
  return getComputedStyle(element).visibility !== "hidden";
}

/** The slot the active service's surface goes over now: the stage when it shows, else the dock. */
function currentSlot(): HTMLElement | null {
  const stage = slots.get("stage");
  if (shown(stage)) return stage;
  const dock = slots.get("dock");
  return shown(dock) ? dock : null;
}

/** Re-renders when a slot comes or goes. */
export function useSlotVersion() {
  return useSyncExternalStore(subscribeSlots, () => slotVersion, () => 0);
}

/** Whether the active service has a player to show. */
export function useActiveSurface(): { service: MediaService | null; surface: PlayerSurface | null } {
  const snapshot = useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  const services = useServices(mediaAspect);
  const service = services.find((s) => s.id === snapshot.activeServiceId) ?? null;
  return { service, surface: service?.getPlayerSurface?.() ?? null };
}

/** The fixed layer with every service's surface; the player app renders it once (an overlay widget). */
export function ServiceSurfaceLayer() {
  const services = useServices(mediaAspect).filter((s) => typeof s.getPlayerSurface === "function");
  const activeId = useSyncExternalStore(
    playback.subscribe,
    () => playback.getSnapshot().activeServiceId,
    () => null,
  );
  return (
    <div className="service-surfaces" aria-hidden={activeId ? undefined : true}>
      {services.map((service) => (
        <SurfaceHost key={service.id} service={service} active={service.id === activeId} />
      ))}
    </div>
  );
}

const HIDDEN: CSSProperties = { position: "fixed", left: 0, top: 0, width: 320, height: 180, visibility: "hidden", pointerEvents: "none", zIndex: 0 };

function SurfaceHost({ service, active }: { service: MediaService; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(HIDDEN);
  useSlotVersion();

  // Mount the surface once for the service's life.
  useEffect(() => {
    const element = ref.current;
    const surface = service.getPlayerSurface?.();
    if (!element || !surface) return;
    return surface.mount(element);
  }, [service]);

  // Follow the slot while active: each frame, so it tracks scrolling, resizing and animations.
  useEffect(() => {
    if (!active) {
      setStyle((s) => ({ ...s, visibility: "hidden", pointerEvents: "none", zIndex: 0 }));
      return;
    }
    let frame = 0;
    let last = "";
    const follow = () => {
      const slot = currentSlot();
      let next: CSSProperties;
      if (slot) {
        const r = slot.getBoundingClientRect();
        const z = Number(getComputedStyle(slot).getPropertyValue("--service-surface-z")) || 15;
        next = { position: "fixed", left: r.left, top: r.top, width: r.width, height: r.height, visibility: "visible", pointerEvents: "auto", zIndex: z };
      } else {
        next = { ...HIDDEN };
      }
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setStyle(next);
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return <div ref={ref} className="service-surface" data-service={service.id} data-active={active || undefined} style={style} />;
}
