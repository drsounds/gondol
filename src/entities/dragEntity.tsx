import { createContext, useCallback, useContext, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { isEntityUri, parseEntityUri } from "./uri";

/**
 * Drag-and-drop of entities between lists, playlists, the library and URI fields (ported from
 * gantt-resume-pro's DragEntityContext). Every `.action-row` whose ActionMenu has a spacify URI is
 * draggable (see ActionMenu); drop targets read the payload with readEntityDrop().
 */

export const ENTITY_MIME = "application/x-entity";

export interface DragData {
  uri: string;
  label: string;
}

interface DragEntityValue {
  dragData: DragData | null;
  setDragData: (data: DragData | null) => void;
}

const DragEntityContext = createContext<DragEntityValue>({ dragData: null, setDragData: () => {} });

export function DragEntityProvider({ children }: { children: ReactNode }) {
  const [dragData, setDragData] = useState<DragData | null>(null);
  // A drag that's cancelled outside the window (or whose source unmounts) never fires dragend
  // on the source, so clear it on any drop/dragend reaching the document as well.
  useEffect(() => {
    if (!dragData) return;
    const clear = () => setDragData(null);
    document.addEventListener("dragend", clear);
    document.addEventListener("drop", clear);
    return () => {
      document.removeEventListener("dragend", clear);
      document.removeEventListener("drop", clear);
    };
  }, [dragData]);
  const value = useMemo(() => ({ dragData, setDragData }), [dragData]);
  return <DragEntityContext.Provider value={value}>{children}</DragEntityContext.Provider>;
}

export function useDragEntity() {
  return useContext(DragEntityContext);
}

/** Puts an entity on a native drag, as both the rich entity payload and a plain-text URI. */
export function writeEntityDrag(event: DragEvent | globalThis.DragEvent, data: DragData) {
  const transfer = event.dataTransfer;
  if (!transfer) return;
  const parsed = parseEntityUri(data.uri);
  transfer.setData(ENTITY_MIME, JSON.stringify({ ...data, entityType: parsed?.entityType, entityId: parsed?.entityId }));
  transfer.setData("text/plain", data.uri);
  transfer.effectAllowed = "copyMove";
}

/** Whether a drag carries an entity (only the types are readable before the drop). */
export function hasEntityDrag(event: DragEvent | globalThis.DragEvent) {
  return event.dataTransfer?.types.includes(ENTITY_MIME) ?? false;
}

/** Reads the dropped entity, also accepting a plain-text spacify: URI dragged from elsewhere. */
export function readEntityDrop(event: DragEvent | globalThis.DragEvent): DragData | null {
  const transfer = event.dataTransfer;
  if (!transfer) return null;
  const raw = transfer.getData(ENTITY_MIME);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<DragData>;
      if (typeof parsed.uri === "string" && isEntityUri(parsed.uri)) return { uri: parsed.uri, label: parsed.label ?? parsed.uri };
    } catch {
      // fall through to text/plain
    }
  }
  const text = transfer.getData("text/plain").trim();
  return isEntityUri(text) ? { uri: text, label: text } : null;
}

/**
 * Props that turn any element into an entity drop target; `over` is true while an entity is
 * dragged over it (for a highlight). Plain-text URIs are accepted on drop too.
 */
export function useEntityDropTarget(onDrop: (data: DragData, event: DragEvent) => void) {
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) => hasEntityDrag(event) || event.dataTransfer.types.includes("text/plain");
  const handleDrop = useCallback(
    (event: DragEvent) => {
      setOver(false);
      const data = readEntityDrop(event);
      if (!data) return;
      event.preventDefault();
      event.stopPropagation();
      onDrop(data, event);
    },
    [onDrop],
  );
  return {
    over,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: handleDrop,
    },
  };
}
