import { AspectManager, type Aspect } from "./aspect";
import { serviceManager, type Service } from "./service";
import type { AppFeature, InternalAppBundle } from "../apps/types";

/**
 * Concepts and features, ported from Bungalow (`se.spacify.concept`, `se.spacify.feature`) and merged
 * into gondol's apps:
 *
 * - Bungalow's **Concept** (a feature domain a plugin activates) is a gondol **app** while it is
 *   switched on and allowed on the site. The concept manager activates it: it registers the app's
 *   services and runs its `concept.onActivate(context)`, recording everything the app contributed
 *   through the context so switching it off undoes exactly that (`onDeactivate`, services stopped
 *   and destroyed, cleanups run).
 * - Bungalow's **Feature** (views plus sidebar nodes) is a gondol **feature** (a page with a path and
 *   a menu entry, from the manifest). The feature manager lists the features of active apps, so code
 *   can look one up by `<app>.<feature>` without walking the registry.
 * - Bungalow's **Service** and its capability **aspects** are ./service.ts.
 */

/** What an app's concept can register while it is active; all of it is undone when it deactivates. */
export interface ConceptContext {
  /** The app's id. */
  readonly appId: string;
  /** Registers a service (onCreate, then onStart once the manager has started). */
  registerService(service: Service): void;
  /** Runs `cleanup` when the app deactivates. */
  onCleanup(cleanup: () => void): void;
}

/** An app's activation logic (defineApp's `concept`). */
export interface Concept {
  onActivate?(context: ConceptContext): void;
  onDeactivate?(): void;
}

/** A service an app contributes: the manifest's declaration, plus the code that makes it. */
export interface ServiceDefinition {
  id: string;
  name: string;
  aspects: string[];
  iconName?: string;
  /** Web hosts whose links it plays as they are (`youtube.com`). */
  hosts?: string[];
  /** URI prefixes it plays as they are (`youtube:`). */
  schemes?: string[];
  /** An http(s) page that runs the service in an iframe and speaks gondol's service protocol. */
  surface?: string;
  create: (definition: ServiceDefinition & { appId: string }) => Service;
}

/** An active app, as the concept manager keeps it. */
export interface ConceptEntry extends Aspect {
  readonly app: InternalAppBundle;
}

/** A feature of an active app, keyed `<app>.<feature>`. */
export interface FeatureEntry extends Aspect {
  readonly appId: string;
  readonly feature: AppFeature;
}

interface Contributions {
  services: string[];
  cleanups: (() => void)[];
}

/** The active apps (Bungalow's ConceptManager): activation, with clean teardown. */
export class ConceptManager extends AspectManager<ConceptEntry> {
  private contributions = new Map<string, Contributions>();

  /** Activates `app`: its services, then its concept's onActivate. Nothing happens if it is already active. */
  activate(app: InternalAppBundle): void {
    if (this.has(app.id)) return;
    const recorded: Contributions = { services: [], cleanups: [] };
    this.contributions.set(app.id, recorded);
    const context: ConceptContext = {
      appId: app.id,
      registerService: (service) => {
        serviceManager.register(service);
        recorded.services.push(service.id);
      },
      onCleanup: (cleanup) => recorded.cleanups.push(cleanup),
    };
    for (const definition of app.services ?? []) {
      try {
        context.registerService(definition.create({ ...definition, appId: app.id }));
      } catch (error) {
        console.error(`gondol: service "${definition.id}" of app "${app.id}" failed to start`, error);
      }
    }
    try {
      app.concept?.onActivate?.(context);
    } catch (error) {
      console.error(`gondol: app "${app.id}" failed to activate`, error);
    }
    this.register({ id: app.id, name: app.name, app });
    for (const feature of app.features) {
      featureManager.register({ id: `${app.id}.${feature.id}`, name: feature.name, appId: app.id, feature });
    }
  }

  /** Deactivates the app: onDeactivate, then every service and cleanup it contributed. */
  deactivate(appId: string): void {
    const entry = this.get(appId);
    if (!entry) return;
    const recorded = this.contributions.get(appId);
    this.contributions.delete(appId);
    try {
      entry.app.concept?.onDeactivate?.();
    } catch (error) {
      console.error(`gondol: app "${appId}" failed to deactivate`, error);
    }
    for (const id of recorded?.services ?? []) serviceManager.unregister(id);
    for (const cleanup of recorded?.cleanups ?? []) {
      try {
        cleanup();
      } catch (error) {
        console.error(`gondol: a cleanup of app "${appId}" failed`, error);
      }
    }
    for (const feature of entry.app.features) featureManager.unregister(`${appId}.${feature.id}`);
    this.unregister(appId);
  }

  /** Makes the active set `apps`: activates the new ones (in order), deactivates those that went. */
  sync(apps: readonly InternalAppBundle[]): void {
    const wanted = new Set(apps.map((app) => app.id));
    for (const entry of this.all()) if (!wanted.has(entry.id)) this.deactivate(entry.id);
    for (const app of apps) {
      const current = this.get(app.id);
      // A bundle made at run time can be replaced by a new object with the same id.
      if (current && current.app !== app) this.deactivate(app.id);
      this.activate(app);
    }
  }
}

/** Gondol's concept manager: the apps that are on. The shell keeps it in sync (`<ConceptsHost/>`). */
export const conceptManager = new ConceptManager();

/** The features of active apps (Bungalow's FeatureManager), keyed `<app>.<feature>`. */
export const featureManager = new AspectManager<FeatureEntry>();
