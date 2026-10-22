import { z } from "zod/v4";

/**
 * The schema of an app's settings (`settings` in its manifest.json): what the user, a site's owner
 * or a workspace's admins can set for the app, laid out as sections of settings, and submenus that
 * open a page of their own sections (and submenus) beside them, like iPhone settings.
 *
 * Every setting is stored at one or more **scopes**: `user` (the signed-in account, in Account),
 * `site` (the site served here, in its site sheet) and `workspace` (the open workspace, in its
 * sheet). A setting, section, submenu or the whole `settings` block names its scopes; whatever
 * doesn't inherits them from the level above, and the top defaults to `user`. When a setting has
 * values at several scopes, the most specific wins: user, then workspace, then site, then the
 * setting's `default` (see ./settings.ts).
 */

export const SETTING_SCOPES = ["user", "workspace", "site"] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number];

const localized = z
  .object({ en: z.string().min(1) })
  .catchall(z.string())
  .meta({ description: "Text per locale (`en` required, e.g. `sv`)." });

const iconName = z.string().min(1).meta({ description: "A glyph of the bungalow icon font (IconName)." });

const id = z.string().regex(/^[A-Za-z0-9][\w.-]*$/, "letters, digits, -, _ and . only");

const scope = z
  .union([z.enum(SETTING_SCOPES), z.array(z.enum(SETTING_SCOPES)).min(1)])
  .meta({ description: "Where it is stored: `user`, `workspace`, `site`, or several (the most specific value wins)." });

const option = z
  .object({
    value: z.string().min(1),
    label: localized,
    description: localized.optional(),
  })
  .strict();

const common = {
  key: id.meta({ description: "Unique within the app; the key its value is stored under." }),
  label: localized,
  description: localized.optional(),
  scope: scope.optional(),
};

/** A choice of one option: a dropdown, or radio buttons with `display: "radio"`. */
const selectSetting = z
  .object({
    ...common,
    type: z.literal("select"),
    options: z.array(option).min(1),
    display: z.enum(["dropdown", "radio"]).optional(),
    default: z.string().optional(),
  })
  .strict();

/** On or off. */
const checkboxSetting = z
  .object({
    ...common,
    type: z.literal("checkbox"),
    default: z.boolean().optional(),
  })
  .strict();

/** Any number of the options, as a list of checkboxes. */
const checkboxesSetting = z
  .object({
    ...common,
    type: z.literal("checkboxes"),
    options: z.array(option).min(1),
    default: z.array(z.string()).optional(),
  })
  .strict();

/** Free text over several lines. */
const textSetting = z
  .object({
    ...common,
    type: z.literal("text"),
    rows: z.number().int().min(1).max(40).optional(),
    maxLength: z.number().int().min(1).optional(),
    placeholder: z.string().optional(),
    default: z.string().optional(),
  })
  .strict();

/** A single-line string: plain, or a `url`, `email` or `password` (masked) field. */
const stringSetting = z
  .object({
    ...common,
    type: z.literal("string"),
    format: z.enum(["plain", "url", "email", "password"]).optional(),
    pattern: z.string().optional().meta({ description: "A regular expression the whole value must match." }),
    maxLength: z.number().int().min(1).optional(),
    placeholder: z.string().optional(),
    default: z.string().optional(),
  })
  .strict();

/** A number, optionally whole, bounded and with a unit shown after it. */
const numberSetting = z
  .object({
    ...common,
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    integer: z.boolean().optional(),
    unit: z.string().optional(),
    placeholder: z.string().optional(),
    default: z.number().optional(),
  })
  .strict();

export const appSettingSchema = z.discriminatedUnion("type", [
  selectSetting,
  checkboxSetting,
  checkboxesSetting,
  textSetting,
  stringSetting,
  numberSetting,
]);

export const appSettingsSectionSchema = z
  .object({
    id,
    title: localized.optional(),
    description: localized.optional(),
    scope: scope.optional(),
    settings: z.array(appSettingSchema).min(1),
  })
  .strict();

export interface AppSettingsSubmenuInput {
  id: string;
  title: z.input<typeof localized>;
  description?: z.input<typeof localized>;
  iconName?: string;
  scope?: z.input<typeof scope>;
  sections?: z.input<typeof appSettingsSectionSchema>[];
  submenus?: AppSettingsSubmenuInput[];
}

/** A row that opens a page of its own sections and submenus. */
export const appSettingsSubmenuSchema: z.ZodType<AppSettingsSubmenu, AppSettingsSubmenuInput> = z.lazy(() =>
  z
    .object({
      id,
      title: localized,
      description: localized.optional(),
      iconName: iconName.optional(),
      scope: scope.optional(),
      sections: z.array(appSettingsSectionSchema).optional(),
      submenus: z.array(appSettingsSubmenuSchema).optional(),
    })
    .strict(),
);

export const appSettingsSchema = z
  .object({
    scope: scope.optional(),
    sections: z.array(appSettingsSectionSchema).optional(),
    submenus: z.array(appSettingsSubmenuSchema).optional(),
  })
  .strict()
  .meta({ description: "The app's settings: sections of settings, and submenus with their own." });

export type AppSettingOption = z.infer<typeof option>;
export type AppSetting = z.infer<typeof appSettingSchema>;
export type AppSettingType = AppSetting["type"];
export type AppSettingsSection = z.infer<typeof appSettingsSectionSchema>;
export interface AppSettingsSubmenu {
  id: string;
  title: z.infer<typeof localized>;
  description?: z.infer<typeof localized>;
  iconName?: string;
  scope?: SettingScope | SettingScope[];
  sections?: AppSettingsSection[];
  submenus?: AppSettingsSubmenu[];
}
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** A stored value of any setting type. */
export type AppSettingValue = string | number | boolean | string[];
