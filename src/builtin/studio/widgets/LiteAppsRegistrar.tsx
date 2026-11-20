import { lazy, useEffect, useMemo } from "react";
import { registerDynamicApps } from "../../../apps/registry";
import type { AppFeature, AppFeaturePageProps, AppManifest, InternalAppBundle } from "../../../apps/types";
import type { ComponentType } from "react";
import { liteBundleId } from "../components/LiteAppPage";
import { useLiteApps } from "../models/studio";
import type { LiteAppTree } from "../models/types";

const LiteAppPage = lazy(() => import("../components/LiteAppPage")) as ComponentType<AppFeaturePageProps>;

/** What a bundle depends on, so an unchanged app keeps its bundle (and the menu doesn't re-render). */
const signature = (app: LiteAppTree) =>
  JSON.stringify([app.name, app.slug, app.identifier, app.icon_name, app.in_menu, app.description, app.pages.map((page) => [page.id, page.key, page.title, page.icon_name, page.in_menu])]);

/** An app built in the studio as an app bundle: one feature per page, at `/lite/<app>/<page>`. */
export function liteAppBundle(app: LiteAppTree): InternalAppBundle | null {
  if (!app.pages.length) return null;
  const id = liteBundleId(app.id);
  const icon = app.icon_name || "brush";
  const segment = app.slug || app.identifier;
  const features: AppFeature[] = app.pages.map((page) => ({
    id: page.key,
    name: page.title,
    iconName: page.icon_name || icon,
    path: `lite/${segment}/${page.key}`,
    hiddenFromNav: !app.in_menu || !page.in_menu,
    Page: LiteAppPage,
    actions: [],
  }));
  const manifest = {
    id,
    slug: id,
    name: { en: app.name },
    description: { en: app.description ?? app.name },
    iconName: icon,
    defaultFeatureId: features[0].id,
    dependencies: ["studio"],
    features: features.map((feature) => ({ id: feature.id, name: { en: feature.name }, path: feature.path, iconName: feature.iconName, hiddenFromNav: feature.hiddenFromNav, actions: [] })),
  } as unknown as AppManifest;
  return {
    id,
    slug: id,
    name: app.name,
    description: app.description ?? "",
    iconName: icon,
    defaultFeatureId: features[0].id,
    dependencies: ["studio"],
    manifest,
    features,
    isInternal: true,
    defaultActive: true,
    partOf: "studio",
  };
}

const cache = new Map<string, { signature: string; bundle: InternalAppBundle | null }>();

/**
 * Registers the user's built apps as app bundles, so their pages route and show in the main menu
 * like any app's (gondol's registerDynamicApps). An overlay widget that renders nothing.
 */
export function LiteAppsRegistrar() {
  const apps = useLiteApps();
  const bundles = useMemo(() => {
    const out: InternalAppBundle[] = [];
    for (const app of apps.data ?? []) {
      const sig = signature(app);
      let entry = cache.get(app.id);
      if (!entry || entry.signature !== sig) {
        entry = { signature: sig, bundle: liteAppBundle(app) };
        cache.set(app.id, entry);
      }
      if (entry.bundle) out.push(entry.bundle);
    }
    return out;
  }, [apps.data]);

  useEffect(() => {
    registerDynamicApps("studio", bundles);
  }, [bundles]);
  useEffect(() => () => registerDynamicApps("studio", []), []);

  return null;
}
