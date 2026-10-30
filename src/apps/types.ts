import type { ComponentType } from "react";
import type { IconName } from "../design-system/bungalow-79d923";
export type { IconName };
import type { Register } from "../register";
import type { Capability } from "../sites/capabilities";
import type { AppManifest, AppManifestFeature } from "./manifest";
import type { Resolution } from "./contributions";
export type { Capability };

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

/** Roles and aspects as manifest.json declares them (validated by ./manifest.ts). */
export type ManifestCapability = Pick<AppManifest, "roles" | "aspects">;

export type { AppManifest, AppManifestFeature };

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
  toggleSidebar?: () => void;
  toggleTheme?: () => void;
  openShortcutsHelp?: () => void;
  openActionsMenu?: () => void;
  closeActionsMenu?: () => void;
  activeTab?: string;
  pathname?: string;
  [key: string]: unknown;
}

/** A palette action. Untagged, it takes its feature's roles and aspects (sites/capabilities.ts). */
export interface AppAction extends Capability {
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

/** An app's page. Its `roles`/`aspects`, else those declared in the manifest, say which sites offer it. */
export interface AppFeature extends Capability {
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

/** Props of `menuWidgets`: what the menu section they sit in navigates with. */
export interface AppMenuWidgetProps {
  pathname: string;
  onNavigate: (path: string) => void;
  /** Desktop sidebar only (NavItem's `extra`): left out of the phone tab bar. */
  extra?: boolean;
  /** The desktop sidebar is collapsed to its icons. */
  collapsed?: boolean;
}

export interface AppBottomWidgetProps {
  className?: string;
  /** False: show only while something plays or is queued (the player setting "auto"). */
  alwaysShow?: boolean;
  [key: string]: unknown;
}

export interface AppWidgets {
  /** Rendered at the very top of the home view, above every app's `overviewWidgets`. */
  overviewHeadWidgets?: ComponentType<AppOverviewWidgetProps>[];
  overviewWidgets?: ComponentType<AppOverviewWidgetProps>[];
  sidebarNavWidgets?: ComponentType<AppSidebarWidgetProps>[];
  sidebarPanelWidgets?: ComponentType<AppSidebarWidgetProps>[];
  /** Inside the app's own menu section, below its pages (sidebar, apps submenu and menu drawer). */
  menuWidgets?: ComponentType<AppMenuWidgetProps>[];
  sidebarWidgets?: ComponentType<AppSidebarWidgetProps>[];
  bottomWidgets?: ComponentType<AppBottomWidgetProps>[];
  /** Sheets and dialogs the app owns, rendered over everything (the shell's `overlays`). */
  overlayWidgets?: ComponentType[];
  /** Above the view's content on every page but external apps (e.g. a load error the app reports). */
  contentHeadWidgets?: ComponentType[];
  /** Wrap the whole shell; never lazy, since the shell waits for them. */
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
  /** The app's answers to the shell's hooks (./contributions.ts); defineApp adds the manifest's. */
  resolutions?: Resolution[];
  /**
   * For bundles made at run time (registerDynamicApps): the app they are part of, whose site
   * settings they follow (a site with the studio app has the apps users built with it).
   */
  partOf?: string;
  /** For apps loaded at run time from an apps runtime (./remote/loader.ts): where they came from. */
  remote?: RemoteAppInfo;
}

/** Where a remote app (./remote/loader.ts) was loaded from, and what its backend is. */
export interface RemoteAppInfo {
  /** The source as the user added it (the runtime's address or its index URL). */
  source: string;
  /** The index it is listed in. */
  indexUrl: string;
  /** Its client entry module. */
  clientUrl: string;
  /** Its stylesheets, added to the page while it's registered. */
  styles: string[];
  version?: string;
  /** Served by `gondol-apps dev` (Vite): backend functions are called on the runtime directly. */
  dev: boolean;
  /** Its backend functions' names; served through the app router once an admin approves them (dev: directly). */
  functions: string[];
  /** Where the runtime serves those functions (`<functionsUrl>/<name>`). */
  functionsUrl?: string;
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
  /** The app's `menuWidgets`, rendered below its items. */
  widgets?: ComponentType<AppMenuWidgetProps>[];
}

export interface DynamicRouteMatch {
  app: InternalAppBundle;
  feature: AppFeature;
  isActive: boolean;
  appId: string;
  featureId: string;
  /** False when the site served here doesn't offer the feature (its roles/aspects, sites/capabilities.ts). */
  offeredBySite: boolean;
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
