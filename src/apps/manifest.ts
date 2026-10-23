import { z } from "zod/v4";
import { SITE_ASPECTS, SITE_ROLES } from "../sites/capabilities";
import { appSettingsSchema } from "../settings/schema";
import { settingsProblems } from "../settings/tree";
import { appApiSchema } from "../api/openapi";

/**
 * The schema of an app's `manifest.json`: everything an app declares about itself as data, checked
 * when the app is defined (defineApp) so a broken manifest fails loudly instead of quietly hiding a
 * feature. `manifest.schema.json` next to this file is generated from it (`bun run manifest-schema`)
 * for editors: point a manifest's `$schema` at it.
 *
 * What a manifest declares, the shell reads without knowing any app (see ./contributions.ts): the
 * features and their paths, palette actions, the root navigation items, the create picker's items,
 * the search page's browse tiles, the app's entity types (addresses, tile art, where their rows
 * live), its settings (../settings/schema.ts) and its HTTP API (../api/openapi.ts). Code an app needs (pages, widgets, actions that do more than navigate) is attached in its
 * index.ts with defineApp.
 */

/** Text in every locale the app ships; `en` is required. */
const localized = z
  .object({ en: z.string().min(1) })
  .catchall(z.string())
  .meta({ description: "Text per locale (`en` required, e.g. `sv`)." });

/** A key of the host app's message catalogue (its i18n), e.g. `nav.ideas`. */
const messageKey = z.string().min(1).meta({ description: "A key of the host app's message catalogue (e.g. `nav.ideas`)." });

const iconName = z.string().min(1).meta({ description: "A glyph of the bungalow icon font (IconName)." });

/** An in-app path: `/ideas/new`. */
const appPath = z.string().regex(/^\/[\w\-./]*$/, "must start with / and hold only path characters");

/** An in-app path with a `{key}` placeholder for the row's key: `/ideas/{key}/edit`. */
const keyTemplate = z.string().regex(/^\/[\w\-./]*\{key\}[\w\-./]*$/, "must start with / and contain {key}");

const id = z.string().regex(/^[A-Za-z0-9][\w.-]*$/, "letters, digits, -, _ and . only");

const capability = {
  roles: z.array(z.enum(SITE_ROLES)).optional().meta({ description: "Who it is for; a site offers it when the roles overlap." }),
  aspects: z.array(z.enum(SITE_ASPECTS)).optional().meta({ description: "What kind of work it does; a site offers it when the aspects overlap." }),
};

/**
 * A palette action (the actions menu, keyboard shortcuts). With `navigate` it goes to that path;
 * without, the app's index.ts implements it (defineApp's `actions`).
 */
export const manifestActionSchema = z
  .object({
    id,
    title: z.string().min(1),
    description: z.string().optional(),
    category: z.string().optional(),
    iconName: iconName.optional(),
    shortcut: z.string().optional().meta({ description: "e.g. `Mod+Alt+N` (Mod is ⌘ on macOS, Ctrl elsewhere)." }),
    keywords: z.array(z.string()).optional(),
    navigate: appPath.optional().meta({ description: "Where the action goes. Without it, defineApp's `actions` must implement it." }),
    ...capability,
  })
  .strict();

/** An item of the create picker (the plus button): it opens `path`, or runs the app's action `action`. */
export const manifestCreateItemSchema = z
  .object({
    key: id.meta({ description: "Unique among create items; also its `create-<key>` tour target." }),
    entityType: z.string().optional().meta({ description: "The entity type it creates, when it differs from `key` (sites hide types they don't show)." }),
    label: messageKey,
    section: messageKey.meta({ description: "The area it belongs to, shown next to the label." }),
    iconName,
    path: appPath.optional(),
    action: id.optional().meta({ description: "An action id of this app to run instead of opening a path." }),
    order: z.number().optional().meta({ description: "Position in the picker (ascending)." }),
  })
  .strict()
  .refine((item) => !!item.path !== !!item.action, "a create item needs exactly one of `path` and `action`");

/** A tile of the search page's "Browse all" grid; it opens the feature's path unless it names its own. */
export const manifestBrowseTileSchema = z
  .object({
    label: messageKey,
    iconName,
    hue: z.number().min(0).max(360),
    path: appPath.optional(),
    order: z.number().optional().meta({ description: "Position in the grid (ascending)." }),
  })
  .strict();

/**
 * An item of the shell's own navigation (the top of the sidebar and the phone tab bar, next to
 * Home and Search), rather than the app's section. It opens the feature's path unless it names its
 * own, and goes with the feature (activation, sites).
 */
export const manifestNavItemSchema = z
  .object({
    label: messageKey,
    iconName: iconName.meta({ description: "A glyph, or `@saved` for the saved-to-library glyph the user picked." }),
    order: z.number().meta({ description: "Position among the shell's items: Home is 0, Search 20." }),
    path: appPath.optional(),
    tourId: z.string().optional().meta({ description: "Its `data-tour` key (defaults to nav-<feature id>)." }),
    tour: z
      .object({ title: messageKey, body: messageKey })
      .strict()
      .optional()
      .meta({ description: "A step of the first-run walkthrough, pointing at the item." }),
    drawer: z.boolean().optional().meta({ description: "Also in the phones' menu drawer." }),
    tab: z.boolean().optional().meta({ description: "A root tab: the palette's Go to … actions and Mod+<n> shortcuts." }),
    extra: z.boolean().optional().meta({ description: "Desktop sidebar only, not the phone tab bar." }),
    mobileOnly: z.boolean().optional(),
    afterAdd: z.boolean().optional().meta({ description: "After the plus button in the phone tab bar." }),
  })
  .strict();

export const manifestFeatureSchema = z
  .object({
    id,
    name: localized,
    description: localized.optional(),
    path: z.string().regex(/^[\w\-./]+$/, "a path without the leading /"),
    aliases: z.array(z.string()).optional().meta({ description: "Other paths that open the feature." }),
    iconName: iconName.optional(),
    hiddenFromNav: z.boolean().optional().meta({ description: "Routable, but left out of the app's menu section." }),
    entityTypes: z
      .array(z.string())
      .optional()
      .meta({ description: "Entity types whose rows belong to this feature when its path doesn't hold their edit sheet or page." }),
    actions: z.array(manifestActionSchema).optional(),
    create: z.array(manifestCreateItemSchema).optional(),
    browse: manifestBrowseTileSchema.optional(),
    nav: manifestNavItemSchema.optional(),
    ...capability,
  })
  .strict();

/**
 * Where a type's rows live and how to name one: `label` is a column, or columns joined by
 * `separator` (or the first with a value, with `first`).
 */
export const manifestEntitySourceSchema = z
  .object({
    table: z.string().min(1),
    columns: z.string().min(1).meta({ description: "The select list, e.g. `id, name`." }),
    label: z.union([z.string(), z.array(z.string()).min(1)]),
    separator: z.string().optional().meta({ description: "Between label columns (default a space)." }),
    first: z.boolean().optional().meta({ description: "Use the first label column with a value instead of joining them." }),
    prefix: z.record(z.string(), z.string()).optional().meta({ description: "Text before a column's value, e.g. `{ \"entry_number\": \"#\" }`." }),
  })
  .strict();

/** An entity type the app owns: its public addresses, its tile art and where its rows live. */
export const manifestEntitySchema = z
  .object({
    slug: z.string().nullable().meta({ description: "The singular public segment (/<slug>/<key>); null for none." }),
    view: keyTemplate.optional().meta({ description: "The row's own page, e.g. `/boards/{key}`; else the generic entity view." }),
    edit: keyTemplate.optional().meta({ description: "The row's edit sheet, e.g. `/ideas/{key}/edit`." }),
    plural: z.string().optional().meta({ description: "The plural segment of its shelf sub-view, when adding -s is wrong (media)." }),
    sheet: z.boolean().optional().meta({ description: "Opens in a sheet the app owns rather than a route (registerEntitySheetOpener)." }),
    art: z.object({ iconName, hue: z.number().min(0).max(360) }).strict().optional(),
    source: manifestEntitySourceSchema.optional(),
  })
  .strict();

export const appManifestSchema = z
  .object({
    $schema: z.string().optional(),
    id,
    slug: id,
    name: localized,
    description: localized,
    iconName,
    defaultFeatureId: id,
    dependencies: z.array(id).default([]).meta({ description: "Apps this one needs; they are built and enabled with it." }),
    defaultActive: z.boolean().optional().meta({ description: "Whether it is on before the user switches it (default true)." }),
    ...capability,
    features: z.array(manifestFeatureSchema).min(1),
    entities: z.record(z.string(), manifestEntitySchema).optional(),
    staticPaths: z
      .array(appPath)
      .optional()
      .meta({ description: "Static sub-routes under a list that are never a row's key (/calendar/events)." }),
    uuidPaths: z
      .array(appPath)
      .optional()
      .meta({ description: "Path prefixes whose uuids stay uuids (a person's id), not swapped for slugs." }),
    menuAspects: z
      .record(z.string(), z.array(z.enum(SITE_ASPECTS)))
      .optional()
      .meta({ description: "The aspect of the app's ActionMenu items by key, for keys gondol doesn't know." }),
    settings: appSettingsSchema.optional(),
    api: appApiSchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const features = new Set<string>();
    const actions = new Set<string>();
    const createKeys = new Set<string>();
    for (const [index, feature] of manifest.features.entries()) {
      if (features.has(feature.id)) ctx.addIssue({ code: "custom", path: ["features", index, "id"], message: `duplicate feature id "${feature.id}"` });
      features.add(feature.id);
      for (const [a, action] of (feature.actions ?? []).entries()) {
        if (actions.has(action.id)) ctx.addIssue({ code: "custom", path: ["features", index, "actions", a, "id"], message: `duplicate action id "${action.id}"` });
        actions.add(action.id);
      }
      for (const [c, item] of (feature.create ?? []).entries()) {
        if (createKeys.has(item.key)) ctx.addIssue({ code: "custom", path: ["features", index, "create", c, "key"], message: `duplicate create key "${item.key}"` });
        createKeys.add(item.key);
      }
    }
    if (!features.has(manifest.defaultFeatureId)) {
      ctx.addIssue({ code: "custom", path: ["defaultFeatureId"], message: `no feature "${manifest.defaultFeatureId}"` });
    }
    for (const problem of manifest.settings ? settingsProblems(manifest.settings) : []) {
      ctx.addIssue({ code: "custom", path: ["settings", ...problem.path], message: problem.message });
    }
    if (manifest.dependencies.includes(manifest.id)) {
      ctx.addIssue({ code: "custom", path: ["dependencies"], message: "an app can't depend on itself" });
    }
    for (const [index, feature] of manifest.features.entries()) {
      for (const [c, item] of (feature.create ?? []).entries()) {
        if (item.action && !actions.has(item.action)) {
          ctx.addIssue({ code: "custom", path: ["features", index, "create", c, "action"], message: `no action "${item.action}" in this app` });
        }
      }
    }
  });

/** An app's manifest.json, as validated (appManifestSchema). */
export type AppManifest = z.infer<typeof appManifestSchema>;
export type AppManifestFeature = AppManifest["features"][number];
export type ManifestAction = z.infer<typeof manifestActionSchema>;
export type ManifestCreateItem = z.infer<typeof manifestCreateItemSchema>;
export type ManifestBrowseTile = z.infer<typeof manifestBrowseTileSchema>;
export type ManifestNavItem = z.infer<typeof manifestNavItemSchema>;
export type ManifestEntity = z.infer<typeof manifestEntitySchema>;
export type ManifestEntitySource = z.infer<typeof manifestEntitySourceSchema>;

/** Validates a manifest.json, throwing an error that names the app and every problem. */
export function parseManifest(json: unknown): AppManifest {
  const result = appManifestSchema.safeParse(json);
  if (result.success) return result.data;
  const appId = typeof json === "object" && json && "id" in json ? String((json as { id: unknown }).id) : "?";
  const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
  throw new Error(`Invalid manifest.json of app "${appId}":\n${problems}`);
}
