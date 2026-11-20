/**
 * Aspects and aspect managers, ported from Bungalow (`se.spacify.aspect`).
 *
 * An **aspect** is anything with a stable id and a name that a manager keeps track of: a service,
 * a concept (an app's activation), a feature. An **aspect manager** is an insertion-ordered registry
 * of one kind of aspect that tells listeners when it changes. Gondol keeps three:
 *
 * - `serviceManager` (./service.ts): back-ends with a lifecycle, picked by capability,
 * - `conceptManager` (./concept.ts): the apps that are switched on, with what they contributed,
 * - `featureManager` (./concept.ts): the pages of those apps.
 *
 * Bungalow's aspects are *capabilities* (what a back-end can do: play, resolve, sign in). Gondol's
 * sites also say "aspects" for the kind of work a page does (view, create, edit, …; sites/capabilities.ts):
 * those are a different thing, and only ever appear on features, actions and menu items.
 */
export interface Aspect {
  readonly id: string;
  readonly name: string;
  /** Called once the aspect is in `manager`. */
  onRegister?(manager: AspectManager<Aspect>): void;
}

/** An insertion-ordered registry of aspects, keyed by id (Bungalow's BaseAspectManager). */
export class AspectManager<T extends Aspect> {
  private nodes = new Map<string, T>();
  private listeners = new Set<() => void>();
  private snapshot: readonly T[] = [];

  /** Adds `aspect` (replacing one with the same id) and calls its onRegister. */
  register(aspect: T): void {
    this.nodes.set(aspect.id, aspect);
    this.changed();
    aspect.onRegister?.(this as unknown as AspectManager<Aspect>);
  }

  /** Removes an aspect by id or instance; returns what was removed. */
  unregister(aspectOrId: T | string): T | undefined {
    const id = typeof aspectOrId === "string" ? aspectOrId : aspectOrId.id;
    const found = this.nodes.get(id);
    if (!found) return undefined;
    this.nodes.delete(id);
    this.changed();
    return found;
  }

  get(id: string): T | undefined {
    return this.nodes.get(id);
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /** Every aspect in the order they were registered. The same array until something changes. */
  all = (): readonly T[] => this.snapshot;

  /** Calls `listener` whenever an aspect comes or goes; returns the unsubscribe (useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Tells listeners something about the aspects changed (their state, not only the set). */
  protected changed(): void {
    this.snapshot = [...this.nodes.values()];
    for (const listener of [...this.listeners]) listener();
  }
}
