import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The undo system: Mod+Z undoes and Mod+Shift+Z (or Mod+Y) redoes the last change in the view the
 * user is working in, from anywhere outside a text field (where the browser's own undo stays).
 *
 * A view that keeps its own history (a playlist's: usePlaylistHistory) registers it as an **undo
 * scope** with `useUndoScope`; the most recently registered or focused scope answers. Anything else
 * can push one-off steps onto the shared stack with `pushUndo({ label, undo, redo })`, which
 * answers when no scope is active. The palette's "Undo …" and "Redo …" actions and their shortcuts
 * (apps/actions.tsx) go through `undoManager`.
 */
export interface UndoScope {
  /** Names the scope, e.g. "playlist:<id>". */
  id: string;
  canUndo: boolean;
  canRedo: boolean;
  /** What undo / redo would do, e.g. "Move". */
  undoLabel?: string | null;
  redoLabel?: string | null;
  /** Resolves to the label of what was undone (for the toast), or null. */
  undo: () => Promise<string | null | void> | string | null | void;
  redo: () => Promise<string | null | void> | string | null | void;
  /** The scope's element: focus inside it makes it the active scope. */
  element?: HTMLElement | null;
}

export interface UndoStep {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

const LIMIT = 100;

class UndoManager {
  private scopes: UndoScope[] = [];
  private past: UndoStep[] = [];
  private future: UndoStep[] = [];
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Adds or updates a scope; it becomes the active one when new. Returns its removal. */
  setScope(scope: UndoScope): () => void {
    const at = this.scopes.findIndex((s) => s.id === scope.id);
    if (at >= 0) {
      const before = this.scopes[at];
      this.scopes[at] = scope;
      // Re-registering on every render must not wake listeners unless something they show changed.
      const same =
        before.canUndo === scope.canUndo &&
        before.canRedo === scope.canRedo &&
        (before.undoLabel ?? null) === (scope.undoLabel ?? null) &&
        (before.redoLabel ?? null) === (scope.redoLabel ?? null);
      if (same) return () => this.removeScope(scope.id);
    } else this.scopes.push(scope);
    this.changed();
    return () => this.removeScope(scope.id);
  }

  private removeScope(id: string) {
    const next = this.scopes.filter((s) => s.id !== id);
    if (next.length === this.scopes.length) return;
    this.scopes = next;
    this.changed();
  }

  /** Makes the scope whose element holds `target` the active one (focus moved there). */
  focus(target: EventTarget | null) {
    if (!(target instanceof Node)) return;
    const at = this.scopes.findIndex((s) => s.element?.contains(target));
    if (at < 0 || at === this.scopes.length - 1) return;
    const [scope] = this.scopes.splice(at, 1);
    this.scopes.push(scope);
    this.changed();
  }

  /** The scope that answers now (the latest), if any. */
  active(): UndoScope | null {
    return this.scopes[this.scopes.length - 1] ?? null;
  }

  pushUndo(step: UndoStep) {
    this.past = [...this.past.slice(-(LIMIT - 1)), step];
    this.future = [];
    this.changed();
  }

  canUndo(): boolean {
    const scope = this.active();
    return scope ? scope.canUndo : this.past.length > 0;
  }

  canRedo(): boolean {
    const scope = this.active();
    return scope ? scope.canRedo : this.future.length > 0;
  }

  undoLabel(): string | null {
    const scope = this.active();
    return scope ? (scope.undoLabel ?? null) : (this.past[this.past.length - 1]?.label ?? null);
  }

  redoLabel(): string | null {
    const scope = this.active();
    return scope ? (scope.redoLabel ?? null) : (this.future[this.future.length - 1]?.label ?? null);
  }

  async undo(): Promise<string | null> {
    const scope = this.active();
    if (scope) return scope.canUndo ? ((await scope.undo()) ?? null) : null;
    const step = this.past[this.past.length - 1];
    if (!step) return null;
    this.past = this.past.slice(0, -1);
    this.future = [...this.future, step];
    this.changed();
    await step.undo();
    return step.label;
  }

  async redo(): Promise<string | null> {
    const scope = this.active();
    if (scope) return scope.canRedo ? ((await scope.redo()) ?? null) : null;
    const step = this.future[this.future.length - 1];
    if (!step) return null;
    this.future = this.future.slice(0, -1);
    this.past = [...this.past, step];
    this.changed();
    await step.redo();
    return step.label;
  }
}

export const undoManager = new UndoManager();

/** Pushes a one-off step onto the shared undo stack. */
export function pushUndo(step: UndoStep) {
  undoManager.pushUndo(step);
}

/** Re-renders when what can be undone changes. */
export function useUndoState() {
  useSyncExternalStore(undoManager.subscribe, undoManager.getVersion, () => 0);
  return {
    canUndo: undoManager.canUndo(),
    canRedo: undoManager.canRedo(),
    undoLabel: undoManager.undoLabel(),
    redoLabel: undoManager.redoLabel(),
  };
}

/**
 * Registers a view's own history as an undo scope while it is mounted (and `enabled`): Mod+Z and
 * Mod+Shift+Z then undo and redo there. Focus inside `element` makes it the active scope again
 * when several are mounted.
 */
export function useUndoScope(scope: UndoScope | null) {
  const latest = useRef(scope);
  latest.current = scope;
  const id = scope?.id ?? null;
  // Register once per id; later renders update the registration in place.
  useEffect(() => {
    if (!id) return;
    return undoManager.setScope(latest.current ?? { id, canUndo: false, canRedo: false, undo: () => null, redo: () => null });
  }, [id]);
  useEffect(() => {
    if (scope) undoManager.setScope(scope);
  });
  useEffect(() => {
    const element = scope?.element;
    if (!element) return;
    const onFocus = (event: FocusEvent) => undoManager.focus(event.target);
    element.addEventListener("focusin", onFocus);
    return () => element.removeEventListener("focusin", onFocus);
  }, [scope?.element]);
}
