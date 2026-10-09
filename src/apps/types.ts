import type { ComponentType } from "react";
import type { IconName } from "../design-system/bungalow-79d923";
export type { IconName };
import type { Register } from "../register";

/** A type the app registers under `key` on gondol's `Register`, else `fallback`. */
type Registered<K extends string, Fallback> = Register extends { [P in K]: infer T } ? T : Fallback;

/** Localization dictionary supporting 'en', 'sv', etc. */
export interface AppLocaleString {
  en: string;
  sv?: string;
  [locale: string]: string | undefined;
}

/** Resolves a string or localized dictionary to text */
export function getLocalizedText(
  value: string | AppLocaleString | undefined,
  locale = "en"
): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] || value.en || Object.values(value)[0] || "";
}

/** Feature metadata declared in manifest.json */
export interface AppManifestFeature {
  id: string;
  name: AppLocaleString;
  description?: AppLocaleString;
  path: string;
  iconName?: IconName | string;
}

/** App manifest specification (manifest.json) */
export interface AppManifest {
  id: string;
  slug: string;
  name: AppLocaleString;
  description: AppLocaleString;
  iconName: IconName | string;
  defaultFeatureId: string;
  dependencies: string[];
  features: AppManifestFeature[];
}

/** Context and props passed to a feature page */
export interface BaseAppFeaturePageProps {
  appId?: string;
  featureId?: string;
  splat?: string;
  onNavigateFeature?: (featureId: string, subpath?: string) => void;
  onOpenUri?: (uri: string) => void;
  [key: string]: unknown;
}

/**
 * The props the shell passes every feature page: gondol's own, plus whatever the app's shell hands
 * its pages (`Register["appFeaturePageProps"]`, e.g. shared data the shell has already loaded).
 */
export type AppFeaturePageProps = BaseAppFeaturePageProps & Registered<"appFeaturePageProps", unknown>;



export interface AppActionContext {
  navigate: (path: string) => void;
  openCreate?: () => void;
  openNewEntry?: () => void;
  toggleSidebar?: () => void;
  toggleTheme?: () => void;
  openShortcutsHelp?: () => void;
  openActionsMenu?: () => void;
  closeActionsMenu?: () => void;
  activeTab?: string;
  pathname?: string;
  [key: string]: unknown;
}

export interface AppAction {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  category?: string;
  iconName?: IconName | string;
  shortcut?: string;
  keywords?: string[];
  perform: (context: AppActionContext) => void | Promise<void>;
  disabled?: boolean;
}

export interface AppFeature {
  id: string;
  name: string;
  description?: string;
  iconName?: IconName | string;
  path: string;
  aliases?: string[];
  /** Routable, but left out of the app's menu section (linked from elsewhere, e.g. the main nav). */
  hiddenFromNav?: boolean;
  Page: ComponentType<AppFeaturePageProps>;
  actions?: AppAction[];
}

/** Props of the home view's widgets: the app's own (`Register["overviewWidgetProps"]`). */
export type AppOverviewWidgetProps = Registered<"overviewWidgetProps", { [key: string]: unknown }>;

export interface AppSidebarWidgetProps {
  onOpenUri?: (uri: string) => void;
  collapsed?: boolean;
  className?: string;
  [key: string]: unknown;
}

export interface AppBottomWidgetProps {
  className?: string;
  alwaysShow?: boolean;
  [key: string]: unknown;
}

export interface AppWidgets {
  /** Rendered at the very top of the home view, above every app's `overviewWidgets`. */
  overviewHeadWidgets?: ComponentType<AppOverviewWidgetProps>[];
  overviewWidgets?: ComponentType<AppOverviewWidgetProps>[];
  sidebarNavWidgets?: ComponentType<AppSidebarWidgetProps>[];
  sidebarPanelWidgets?: ComponentType<AppSidebarWidgetProps>[];
  sidebarWidgets?: ComponentType<AppSidebarWidgetProps>[];
  bottomWidgets?: ComponentType<AppBottomWidgetProps>[];
  Providers?: ComponentType<{ children: React.ReactNode }>[];
}

/** Hooks exposed by an app bundle */
export interface AppBundleHooks {
  useAppStatus?: () => { isActive: boolean; toggle: () => void };
  [hookName: string]: unknown;
}

/**
 * An internal App Bundle preregistered in the source code.
 * Cannot be deleted, but can be activated and deactivated.
 */
export interface InternalAppBundle {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconName: IconName | string;
  iconUrl?: string;
  defaultFeatureId: string;
  dependencies: string[];
  manifest: AppManifest;
  features: AppFeature[];
  actions?: AppAction[];
  widgets?: AppWidgets;
  isInternal: true;
  defaultActive?: boolean;
  hooks?: AppBundleHooks;
}

export interface DynamicMenuItem {
  id: string;
  appId: string;
  featureId: string;
  name: string;
  path: string;
  iconName: IconName;
  description?: string;
  badge?: string;
}

export interface DynamicMenuSection {
  id: string;
  appId: string;
  title: string;
  iconName?: IconName;
  items: DynamicMenuItem[];
}

export interface DynamicRouteMatch {
  app: InternalAppBundle;
  feature: AppFeature;
  isActive: boolean;
  appId: string;
  featureId: string;
  isAppView?: boolean;
  subpath?: string;
}

export type AppKind = "internal" | "external";

/**
 * Unified representation of either an internal pre-registered bundle
 * or an external user-created HTML5 embed app.
 */
export interface UnifiedApp {
  id: string;
  name: string;
  description: string | null;
  kind: AppKind;
  isInternal: boolean;
  isActive: boolean;
  canDelete: boolean;
  iconUrl?: string | null;
  iconName?: IconName;
  embedUrl?: string;
  isPublic?: boolean;
  features?: AppFeature[];
  bundle?: InternalAppBundle;
}
