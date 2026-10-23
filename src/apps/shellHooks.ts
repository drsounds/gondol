import { defineHook } from "./contributions";
import type { AppActionContext, AppLocaleString, IconName } from "./types";
import type { EntityRoute } from "../entities/uri";
import type { EntitySource } from "../entities/lookup";
import type { EntityArtStyle } from "../entities/EntityArt";
import type { EntityExtensions } from "../entities/extensions";
import type { EntityType, MessageKey } from "../register";
import type { SiteAspect } from "../sites/capabilities";

/**
 * The shell's own hooks (see ./contributions.ts). Manifests answer most of them through defineApp;
 * code can answer any of them with `answer(hook, value)`.
 */

/** An item of the shell's own navigation, next to Home and Search (a manifest feature's `nav`). */
export interface ShellNavItem {
  id: string;
  label: MessageKey;
  /** Its feature's name, for the palette's "Go to …" action. */
  title: string;
  /** A glyph, or `@saved` for the saved-to-library glyph the user picked. */
  iconName: IconName | "@saved";
  /** Position among the shell's items: Home is 0, Search 20. */
  order: number;
  path: string;
  tourId?: string;
  tour?: { title: MessageKey; body: MessageKey };
  drawer?: boolean;
  tab?: boolean;
  extra?: boolean;
  mobileOnly?: boolean;
  afterAdd?: boolean;
}
export const navItemsHook = defineHook<ShellNavItem>("gondol.navItems");

/** An item of the create picker: it opens `path`, or calls `perform`. */
export interface CreateItem {
  key: string;
  /** The entity type it creates (sites hide types they don't show). */
  entityType: string;
  label: MessageKey;
  section: MessageKey;
  iconName: IconName;
  path?: string;
  perform?: (context: AppActionContext) => void;
  /** Position in the picker (ascending; without one, after those that have one, in app order). */
  order?: number;
}
export const createItemsHook = defineHook<CreateItem>("gondol.createItems");

/** A tile of the search page's "Browse all" grid. */
export interface SearchBrowseTile {
  label: MessageKey;
  path: string;
  icon: IconName;
  hue: number;
  /** Position in the grid (ascending; without one, after those that have one, in app order). */
  order?: number;
}
export const searchBrowseHook = defineHook<SearchBrowseTile>("gondol.searchBrowse");

/** An entity type an app owns: its addresses, where its rows live, its tile art. */
export interface EntityTypeContribution {
  type: EntityType;
  route?: EntityRoute;
  source?: EntitySource;
  art?: EntityArtStyle;
  /** Opens in a sheet the app owns (registerEntitySheetOpener) rather than a route. */
  sheet?: boolean;
}
export const entityTypesHook = defineHook<EntityTypeContribution>("gondol.entityTypes");

/** What an app adds to the entity UI (covers, tags, likes, restrictions); read once, at configure. */
export const entityExtensionsHook = defineHook<Partial<EntityExtensions>>("gondol.entityExtensions");

/** Routing facts an app declares (its manifest's `staticPaths`, `uuidPaths`, `menuAspects`). */
export interface RoutingContribution {
  staticPaths?: string[];
  uuidPaths?: string[];
  menuAspects?: Record<string, readonly SiteAspect[]>;
}
export const routingHook = defineHook<RoutingContribution>("gondol.routing");

/** Something a service keeps in the user's browser. */
export interface PrivacyServiceStorage {
  name: string;
  kind: "cookie" | "localStorage" | "sessionStorage" | "indexedDB";
  purpose: AppLocaleString;
  /** How long it is kept ("2 years", "until you sign out"). */
  duration: AppLocaleString;
}

/**
 * A third-party service an app uses that stores or processes personal data (a manifest's
 * `services`): the cookie notice lists it under its consent category and the privacy policy among
 * the providers, with where it processes data and which domains it talks to.
 */
export interface PrivacyService {
  id: string;
  name: string;
  /** The legal entity behind it, when it differs from `name` ("Google Ireland Ltd"). */
  provider?: string;
  /** Its consent category: "necessary" (default, no consent needed), "analytics", or a host's own. */
  category: string;
  /** Where data is stored or processed: ISO 3166-1 alpha-2 codes, or "EU"/"EEA". */
  countries: string[];
  /** Domains the app contacts for it (for the policy, and for a host's CSP). */
  domains?: string[];
  purpose: AppLocaleString;
  /** Which personal data it gets. */
  data?: AppLocaleString;
  /** Defaults to consent for optional categories and contract for necessary ones. */
  legalBasis?: "consent" | "contract" | "legitimateInterest" | "legalObligation";
  /** How transfers outside the EU/EEA are safeguarded. */
  transfer?: AppLocaleString;
  /** Its own privacy policy. */
  policyUrl?: string;
  /** Cookies and storage it sets in the browser. */
  storage?: PrivacyServiceStorage[];
}
export const privacyServicesHook = defineHook<PrivacyService>("gondol.privacyServices");

/** Sorts answers by their `order` (stable; unordered ones last, in app order). */
export function byOrder<T extends { order?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.order ?? Infinity) - (b.item.order ?? Infinity) || a.index - b.index)
    .map(({ item }) => item);
}
