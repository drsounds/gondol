import { useMemo, type ReactNode, type ComponentType } from "react";
import { useActiveBundles, useRegisteredBundles } from "./hooks";
import { getLocalizedText } from "./types";
import { featureCapability } from "./registry";
import { useSiteOffers } from "../sites/capabilities";
import type {
  InternalAppBundle,
  AppFeature,
  DynamicMenuItem,
  DynamicMenuSection,
  DynamicRouteMatch,
  AppOverviewWidgetProps,
  AppSidebarWidgetProps,
  AppBottomWidgetProps,
  IconName,
} from "./types";

/**
 * Dynamically builds menu sections and items for currently active apps.
 * Deactivated apps are omitted immediately, and so are features the site served here doesn't
 * offer (its roles and aspects, sites/capabilities.ts).
 */
export function useAppNavigation(locale = "en"): DynamicMenuSection[] {
  const activeBundles = useActiveBundles();
  const offers = useSiteOffers();

  return useMemo(() => {
    const sections: DynamicMenuSection[] = [];

    for (const bundle of activeBundles) {
      if (!bundle.features || bundle.features.length === 0) continue;

      const offered = bundle.features.filter((feature) => offers(featureCapability(bundle, feature)));
      if (offered.length === 0) continue;

      const items: DynamicMenuItem[] = offered
        .filter((feature) => !feature.hiddenFromNav)
        .map((feature) => {
        const featurePath = feature.path.startsWith("/") ? feature.path : `/${feature.path}`;
        return {
          id: `${bundle.id}-${feature.id}`,
          appId: bundle.id,
          featureId: feature.id,
          name: feature.name,
          path: featurePath,
          iconName: (feature.iconName || bundle.iconName || "three-dots-h") as IconName,
          description: feature.description,
        };
      });

      sections.push({
        id: bundle.id,
        appId: bundle.id,
        title: bundle.name,
        iconName: bundle.iconName as IconName,
        items,
      });
    }

    return sections;
  }, [activeBundles, locale, offers]);
}

/**
 * Dynamically resolves any URL pathname against all registered apps and their features.
 * Returns the matched app bundle and feature, along with its live `isActive` state.
 */
export function useDynamicRoute(pathname: string): DynamicRouteMatch | null {
  const allBundles = useRegisteredBundles();
  const offers = useSiteOffers();

  const match = useMemo((): Omit<DynamicRouteMatch, "offeredBySite"> | null => {
    const cleanPath = pathname.replace(/\/+$/, "") || "/";

    // 1. Matches Teams-style app route: /app/:appId/:featureId or /app/:appId
    const appRouteMatch = /^\/app\/([^/]+)(?:\/([^/]+))?(?:\/(.*))?$/.exec(cleanPath);
    if (appRouteMatch) {
      const appId = appRouteMatch[1];
      const featureIdOrSub = appRouteMatch[2];
      const remainder = appRouteMatch[3];

      const bundle = allBundles.find((b) => b.id === appId || b.slug === appId);
      if (bundle) {
        let feature = bundle.features.find((f) => f.id === featureIdOrSub || f.path === featureIdOrSub);
        let subpath: string | undefined = remainder;
        if (!feature) {
          feature = bundle.features.find((f) => f.id === bundle.defaultFeatureId) || bundle.features[0];
          subpath = featureIdOrSub ? `${featureIdOrSub}${remainder ? `/${remainder}` : ""}` : undefined;
        }

        if (feature) {
          return {
            app: bundle,
            feature,
            isActive: bundle.isActive,
            appId: bundle.id,
            featureId: feature.id,
            isAppView: true,
            subpath,
          };
        }
      }
    }

    // 2. Matches registered feature top-level aliases (e.g. /calendar, /entries, /tasks)
    for (const bundle of allBundles) {
      for (const feature of bundle.features) {
        const featureRoot = `/${feature.path.replace(/^\/+/, "")}`;
        if (cleanPath === featureRoot) {
          return {
            app: bundle,
            feature,
            isActive: bundle.isActive,
            appId: bundle.id,
            featureId: feature.id,
            isAppView: false,
          };
        }
        if (cleanPath.startsWith(`${featureRoot}/`)) {
          const subpath = cleanPath.slice(featureRoot.length + 1);
          return {
            app: bundle,
            feature,
            isActive: bundle.isActive,
            appId: bundle.id,
            featureId: feature.id,
            isAppView: false,
            subpath,
          };
        }
        if (feature.aliases) {
          for (const alias of feature.aliases) {
            const aliasRoot = `/${alias.replace(/^\/+/, "")}`;
            if (cleanPath === aliasRoot) {
              return {
                app: bundle,
                feature,
                isActive: bundle.isActive,
                appId: bundle.id,
                featureId: feature.id,
                isAppView: false,
              };
            }
            if (cleanPath.startsWith(`${aliasRoot}/`)) {
              const subpath = cleanPath.slice(aliasRoot.length + 1);
              return {
                app: bundle,
                feature,
                isActive: bundle.isActive,
                appId: bundle.id,
                featureId: feature.id,
                isAppView: false,
                subpath,
              };
            }
          }
        }
      }
    }

    return null;
  }, [allBundles, pathname]);

  return useMemo(
    () => (match ? { ...match, offeredBySite: offers(featureCapability(match.app, match.feature)) } : null),
    [match, offers],
  );
}

/**
 * Returns all extension widgets and providers exported by currently active apps.
 */
export function useActiveAppWidgets() {
  const activeBundles = useActiveBundles();

  return useMemo(() => {
    const overviewHeadWidgets: ComponentType<AppOverviewWidgetProps>[] = [];
    const overviewWidgets: ComponentType<AppOverviewWidgetProps>[] = [];
    const sidebarNavWidgets: ComponentType<AppSidebarWidgetProps>[] = [];
    const sidebarPanelWidgets: ComponentType<AppSidebarWidgetProps>[] = [];
    const sidebarWidgets: ComponentType<AppSidebarWidgetProps>[] = [];
    const bottomWidgets: ComponentType<AppBottomWidgetProps>[] = [];
    const Providers: ComponentType<{ children: ReactNode }>[] = [];

    for (const bundle of activeBundles) {
      if (bundle.widgets) {
        if (bundle.widgets.overviewHeadWidgets) {
          overviewHeadWidgets.push(...bundle.widgets.overviewHeadWidgets);
        }
        if (bundle.widgets.overviewWidgets) {
          overviewWidgets.push(...bundle.widgets.overviewWidgets);
        }
        if (bundle.widgets.sidebarNavWidgets) {
          sidebarNavWidgets.push(...bundle.widgets.sidebarNavWidgets);
        }
        if (bundle.widgets.sidebarPanelWidgets) {
          sidebarPanelWidgets.push(...bundle.widgets.sidebarPanelWidgets);
        }
        if (bundle.widgets.sidebarWidgets) {
          sidebarWidgets.push(...bundle.widgets.sidebarWidgets);
        }
        if (bundle.widgets.bottomWidgets) {
          bottomWidgets.push(...bundle.widgets.bottomWidgets);
        }
        if (bundle.widgets.Providers) {
          Providers.push(...bundle.widgets.Providers);
        }
      }
    }

    return {
      overviewWidgets: [...overviewHeadWidgets, ...overviewWidgets],
      sidebarNavWidgets,
      sidebarPanelWidgets,
      sidebarWidgets,
      bottomWidgets,
      Providers,
    };
  }, [activeBundles]);
}

/**
 * Composes context providers provided by active apps around the children.
 * If an app is deactivated, its provider is bypassed.
 */
export function ActiveAppsProvider({ children }: { children: ReactNode }) {
  const { Providers } = useActiveAppWidgets();

  return (
    <>
      {Providers.reduceRight((acc, Provider) => {
        return <Provider>{acc}</Provider>;
      }, children)}
    </>
  );
}
