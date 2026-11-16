import { AspectManager, type Aspect } from "./aspect";

/**
 * Services, ported from Bungalow (`se.spacify.service`): back-ends with an Android-style lifecycle
 * that opt into capability aspects. Callers never name a vendor; they ask the service manager for
 * a capability and get every back-end that has it:
 *
 * ```ts
 * for (const music of serviceManager.getServices(musicAspect)) { … }   // every resolver
 * const auth = serviceManager.getService(authAspect);                    // the first that signs in
 * ```
 *
 * A service says what it can do in `aspects` (ids of `defineServiceAspect` tokens) and implements
 * the matching interfaces; one object can combine several (play + resolve + sign in). Apps declare
 * their services in their manifest's `services` and attach the code with defineApp's `services`;
 * the concept manager registers them while the app is on (./concept.ts).
 */
export interface Service extends Aspect {
  /** The capability aspects it implements (`media`, `music`, `auth`, …). */
  readonly aspects: readonly string[];
  /** A glyph of the bungalow icon font, or an image. */
  readonly iconName?: string;
  readonly iconUrl?: string;
  /** The app that contributed it. */
  readonly appId?: string;
  /** When it was registered. */
  onCreate?(): void;
  /** When the manager starts (the shell has mounted). */
  onStart?(): void;
  /** When the manager stops, and before onDestroy. */
  onStop?(): void;
  /** When it is removed for good (its app was switched off). */
  onDestroy?(): void;
}

/** A capability a service can have: an id, carrying (as a phantom) the interface that goes with it. */
export interface ServiceAspect<T> {
  readonly id: string;
  readonly __interface?: T;
}

/** Defines a capability aspect (`defineServiceAspect<MediaService>("media")`). Ids must be unique. */
export function defineServiceAspect<T>(id: string): ServiceAspect<T> {
  return { id };
}

/** Whether `service` says it has `aspect`. */
export function hasAspect<T>(service: Service, aspect: ServiceAspect<T>): service is Service & T {
  return service.aspects.includes(aspect.id);
}

/** The registry of services (Bungalow's ServiceManager): lifecycle, plus lookup by capability. */
export class ServiceManager extends AspectManager<Service> {
  private started = false;

  override register(service: Service): void {
    const previous = this.get(service.id);
    if (previous && previous !== service) this.unregister(previous);
    super.register(service);
    service.onCreate?.();
    if (this.started) service.onStart?.();
  }

  override unregister(serviceOrId: Service | string): Service | undefined {
    const removed = super.unregister(serviceOrId);
    if (removed) {
      removed.onStop?.();
      removed.onDestroy?.();
    }
    return removed;
  }

  /** Starts every service (and those registered later). */
  startAll(): void {
    if (this.started) return;
    this.started = true;
    for (const service of this.all()) service.onStart?.();
  }

  /** Stops every service (they stay registered). */
  stopAll(): void {
    if (!this.started) return;
    this.started = false;
    for (const service of this.all()) service.onStop?.();
  }

  /** The first service with `aspect`, or undefined. */
  getService<T>(aspect: ServiceAspect<T>): (Service & T) | undefined {
    return this.all().find((service): service is Service & T => hasAspect(service, aspect));
  }

  /** Every service with `aspect`, in the order they were registered. */
  getServices<T>(aspect: ServiceAspect<T>): (Service & T)[] {
    return this.all().filter((service): service is Service & T => hasAspect(service, aspect));
  }

  /** Lets a service tell listeners its state changed (signed in, now playing, …). */
  notify(): void {
    this.changed();
  }
}

/** Gondol's service manager: one per page. */
export const serviceManager = new ServiceManager();
