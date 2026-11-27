import { createElement, lazy, type ComponentType } from "react";
import { answer, type Resolution } from "./contributions";
import { parseManifest, type AppManifest, type ManifestAction, type ManifestEntity, type ManifestEntitySource } from "./manifest";
import {
  createItemsHook,
  entityTypesHook,
  navItemsHook,
  privacyServicesHook,
  routingHook,
  searchBrowseHook,
  type EntityTypeContribution,
} from "./shellHooks";
import { getLocalizedText } from "./types";
import type {
  AppAction,
  AppActionContext,
  AppBundleHooks,
  AppFeature,
  AppFeaturePageProps,
  AppWidgets,
  IconName,
  InternalAppBundle,
} from "./types";
import type { EntitySource } from "../entities/lookup";
import type { Concept, ServiceDefinition } from "../services/concept";
import { createSurfaceService } from "../playback/surfaceService";
import type { EntityType, MessageKey } from "../register";

/**
 * Loads a feature's page: `() => import("./features/ideas/src/pages/IdeasPage").then((m) => m.IdeasPage)`.
 * Pages are always loaded lazily, so an app's code is only fetched when one of its pages opens.
 */
export type PageLoader = () => Promise<ComponentType<AppFeaturePageProps>>;

/** A widget loaded lazily; render widgets inside <Suspense> (the shell's slots do). */
export function lazyWidget<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const Lazy = lazy(async () => ({ default: await load() }));
  const Widget = (props: P) => createElement(Lazy as ComponentType<P>, props);
  return Widget;
}

/** What an app's index.ts attaches to its manifest.json. */
export interface AppDefinition {
  /** The app's manifest.json, as imported; validated here. */
  manifest: unknown;
  /** Every feature's page, by feature id, loaded lazily. */
  pages: Record<string, PageLoader>;
  /** Implementations of the manifest's actions that have no `navigate`, by action id. */
  actions?: Record<string, ((context: AppActionContext) => void | Promise<void>) | { perform: (context: AppActionContext) => void | Promise<void>; when?: () => boolean }>;
  /** Widgets (lazyWidget keeps their code out of the first load) and Providers. */
  widgets?: AppWidgets;
  /** Answers to hooks in code, next to those the manifest declares. */
  resolutions?: Resolution[];
  /** Entity types whose row label needs code, next to (or replacing) the manifest's `source`. */
  entitySources?: Partial<Record<EntityType, EntitySource>>;
  hooks?: AppBundleHooks;
  /**
   * The code of the manifest's `services`, by service id: makes the service when the app comes on
   * (services/concept.ts). A service with a `surface` and no code here runs entirely in its page.
   */
  services?: Record<string, ServiceDefinition["create"]>;
  /** What the app does when it comes on and goes off, beyond its services (services/concept.ts). */
  concept?: Concept;
}

/** `/ideas/{key}/edit` -> key => `/ideas/<key>/edit`. */
function template(path: string): (key: string) => string {
  return (key) => path.replace("{key}", key);
}

function sourceFromManifest(source: ManifestEntitySource): EntitySource {
  const columns = Array.isArray(source.label) ? source.label : [source.label];
  const separator = source.separator ?? " ";
  const text = (value: unknown) =>
    typeof value === "number" ? String(value) : typeof value === "string" && value.trim() ? value : null;
  return {
    table: source.table,
    columns: source.columns,
    label: (row) => {
      const parts = columns
        .map((column) => {
          const value = text(row[column]);
          return value === null ? null : `${source.prefix?.[column] ?? ""}${value}`;
        })
        .filter((part): part is string => part !== null);
      if (!parts.length) return null;
      return source.first ? parts[0] : parts.join(separator);
    },
  };
}

function entityContribution(type: string, entity: ManifestEntity, codeSource: EntitySource | undefined): EntityTypeContribution {
  return {
    type: type as EntityType,
    route: {
      slug: entity.slug,
      ...(entity.view ? { view: template(entity.view) } : {}),
      ...(entity.edit ? { edit: template(entity.edit) } : {}),
      ...(entity.plural ? { plural: entity.plural } : {}),
    },
    source: codeSource ?? (entity.source ? sourceFromManifest(entity.source) : undefined),
    art: entity.art ? { icon: entity.art.iconName as IconName, hue: entity.art.hue, shape: entity.art.shape } : undefined,
    sheet: entity.sheet,
  };
}

/**
 * Builds an app from its manifest.json and code: validates the manifest, makes every feature's page
 * lazy, turns the manifest's actions into palette actions and its declarations (navigation items,
 * create items, browse tiles, entity types, routing facts) into answers to the shell's hooks. The
 * app's index.ts default-exports the result, which the build picks up (gondol/vite/apps.mjs).
 */
export function defineApp(definition: AppDefinition): InternalAppBundle {
  const manifest: AppManifest = parseManifest(definition.manifest);
  const where = `app "${manifest.id}"`;
  const implementations = definition.actions ?? {};

  for (const pageId of Object.keys(definition.pages)) {
    if (!manifest.features.some((f) => f.id === pageId)) throw new Error(`${where}: a page for "${pageId}", which its manifest doesn't declare`);
  }

  const toAction = (action: ManifestAction): AppAction => {
    const implementation = implementations[action.id];
    const perform = action.navigate
      ? ({ navigate }: AppActionContext) => navigate(action.navigate!)
      : typeof implementation === "function"
        ? implementation
        : implementation?.perform;
    if (!perform) throw new Error(`${where}: action "${action.id}" has no \`navigate\` and no implementation in defineApp's actions`);
    const { navigate: _navigate, ...rest } = action;
    const when = typeof implementation === "object" ? implementation.when : undefined;
    return { ...rest, perform, ...(when ? { when } : {}) };
  };

  const resolutions: Resolution[] = [];
  const features: AppFeature[] = manifest.features.map((feature) => {
    const load = definition.pages[feature.id];
    if (!load) throw new Error(`${where}: feature "${feature.id}" has no page`);
    const path = `/${feature.path.replace(/^\/+/, "")}`;

    if (feature.nav) {
      resolutions.push(
        answer(
          navItemsHook,
          {
            ...feature.nav,
            id: `${manifest.id}.${feature.id}`,
            label: feature.nav.label as MessageKey,
            title: getLocalizedText(feature.name, "en"),
            iconName: feature.nav.iconName as IconName | "@saved",
            path: feature.nav.path ?? path,
            tourId: feature.nav.tourId ?? `nav-${feature.id}`,
            tour: feature.nav.tour as { title: MessageKey; body: MessageKey } | undefined,
          },
          { featureId: feature.id },
        ),
      );
    }
    if (feature.browse) {
      resolutions.push(
        answer(
          searchBrowseHook,
          {
            label: feature.browse.label as MessageKey,
            path: feature.browse.path ?? path,
            icon: feature.browse.iconName as IconName,
            hue: feature.browse.hue,
            order: feature.browse.order,
          },
          { featureId: feature.id },
        ),
      );
    }
    for (const item of feature.create ?? []) {
      const implementation = item.action ? implementations[item.action] : undefined;
      const perform = typeof implementation === "function" ? implementation : implementation?.perform;
      const navigateTo = item.action ? manifest.features.flatMap((f) => f.actions ?? []).find((a) => a.id === item.action)?.navigate : undefined;
      resolutions.push(
        answer(
          createItemsHook,
          {
            key: item.key,
            entityType: item.entityType ?? item.key,
            label: item.label as MessageKey,
            section: item.section as MessageKey,
            iconName: item.iconName as IconName,
            path: item.path ?? navigateTo,
            perform: item.path || navigateTo ? undefined : perform,
            order: item.order,
          },
          { featureId: feature.id },
        ),
      );
    }

    return {
      id: feature.id,
      name: getLocalizedText(feature.name, "en"),
      description: feature.description ? getLocalizedText(feature.description, "en") : undefined,
      iconName: feature.iconName,
      path: feature.path,
      aliases: feature.aliases,
      hiddenFromNav: feature.hiddenFromNav,
      Page: lazy(async () => ({ default: await load() })),
      // No `actions` gets a default "Open …" palette action; an empty list means none.
      actions: feature.actions?.map(toAction),
    };
  });

  for (const [type, entity] of Object.entries(manifest.entities ?? {})) {
    resolutions.push(answer(entityTypesHook, entityContribution(type, entity, definition.entitySources?.[type as EntityType])));
  }
  for (const [type, source] of Object.entries(definition.entitySources ?? {})) {
    if (manifest.entities?.[type]) continue;
    resolutions.push(answer(entityTypesHook, { type: type as EntityType, source }));
  }
  for (const service of manifest.services ?? []) {
    if ("countries" in service && "purpose" in service) {
      resolutions.push(answer(privacyServicesHook, {
        ...service,
        name: getLocalizedText(service.name, "en"),
        countries: service.countries,
        purpose: service.purpose,
      }));
    }
  }
  if (manifest.staticPaths || manifest.uuidPaths || manifest.menuAspects) {
    resolutions.push(answer(routingHook, { staticPaths: manifest.staticPaths, uuidPaths: manifest.uuidPaths, menuAspects: manifest.menuAspects }));
  }

  for (const serviceId of Object.keys(definition.services ?? {})) {
    if (!manifest.services?.some((service) => service.id === serviceId && "aspects" in service)) throw new Error(`${where}: code for service "${serviceId}", which its manifest doesn't declare`);
  }
  const services: ServiceDefinition[] = (manifest.services ?? []).flatMap((service) => {
    if (!("aspects" in service)) return [];
    const create = definition.services?.[service.id] ?? (service.surface ? createSurfaceService : undefined);
    if (!create) throw new Error(`${where}: service "${service.id}" has no \`surface\` and no code in defineApp's services`);
    return [{
      id: service.id,
      name: getLocalizedText(service.name, "en"),
      aspects: [...service.aspects],
      iconName: service.iconName,
      hosts: service.hosts,
      schemes: service.schemes,
      surface: service.surface,
      create,
    }];
  });

  return {
    id: manifest.id,
    slug: manifest.slug,
    name: getLocalizedText(manifest.name, "en"),
    description: getLocalizedText(manifest.description, "en"),
    iconName: manifest.iconName,
    defaultFeatureId: manifest.defaultFeatureId,
    dependencies: manifest.dependencies,
    manifest,
    features,
    widgets: definition.widgets,
    isInternal: true,
    defaultActive: manifest.defaultActive ?? true,
    hooks: definition.hooks,
    resolutions: [...resolutions, ...(definition.resolutions ?? [])],
    ...(services.length ? { services } : {}),
    ...(definition.concept ? { concept: definition.concept } : {}),
  };
}
