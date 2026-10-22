import { SETTING_SCOPES, type AppSetting, type AppSettings, type AppSettingsSection, type AppSettingsSubmenu, type SettingScope } from "./schema";

type ScopeDeclaration = SettingScope | SettingScope[] | undefined;

/** The scopes a declaration names, or `inherited` when it names none. */
export function scopesOf(declared: ScopeDeclaration, inherited: readonly SettingScope[]): SettingScope[] {
  if (!declared) return [...inherited];
  const list = Array.isArray(declared) ? declared : [declared];
  return SETTING_SCOPES.filter((scope) => list.includes(scope));
}

/** A setting with the scopes it is stored at and the submenus it sits under (ids, outermost first). */
export interface ResolvedSetting {
  setting: AppSetting;
  scopes: SettingScope[];
  submenus: string[];
  section: string;
}

/** Every setting of an app, depth first, in the order the manifest lists them. */
export function flattenSettings(settings: AppSettings | undefined): ResolvedSetting[] {
  if (!settings) return [];
  const out: ResolvedSetting[] = [];
  const visitSections = (sections: AppSettingsSection[] | undefined, inherited: SettingScope[], submenus: string[]) => {
    for (const section of sections ?? []) {
      const sectionScopes = scopesOf(section.scope, inherited);
      for (const setting of section.settings) {
        out.push({ setting, scopes: scopesOf(setting.scope, sectionScopes), submenus, section: section.id });
      }
    }
  };
  const visitSubmenus = (list: AppSettingsSubmenu[] | undefined, inherited: SettingScope[], path: string[]) => {
    for (const submenu of list ?? []) {
      const scopes = scopesOf(submenu.scope, inherited);
      const next = [...path, submenu.id];
      visitSections(submenu.sections, scopes, next);
      visitSubmenus(submenu.submenus, scopes, next);
    }
  };
  const top = scopesOf(settings.scope, ["user"]);
  visitSections(settings.sections, top, []);
  visitSubmenus(settings.submenus, top, []);
  return out;
}

/** Whether a section has a setting stored at `scope`. */
export function sectionHasScope(section: AppSettingsSection, inherited: SettingScope[], scope: SettingScope): boolean {
  const sectionScopes = scopesOf(section.scope, inherited);
  return section.settings.some((setting) => scopesOf(setting.scope, sectionScopes).includes(scope));
}

/** Whether a submenu (or one under it) has a setting stored at `scope`. */
export function submenuHasScope(submenu: AppSettingsSubmenu, inherited: SettingScope[], scope: SettingScope): boolean {
  const scopes = scopesOf(submenu.scope, inherited);
  return (
    (submenu.sections ?? []).some((section) => sectionHasScope(section, scopes, scope)) ||
    (submenu.submenus ?? []).some((child) => submenuHasScope(child, scopes, scope))
  );
}

/** Problems a schema can't see: duplicate keys and ids, defaults that aren't options. */
export function settingsProblems(settings: AppSettings): { path: (string | number)[]; message: string }[] {
  const problems: { path: (string | number)[]; message: string }[] = [];
  const keys = new Set<string>();
  const submenuIds = new Set<string>();
  const checkSections = (sections: AppSettingsSection[] | undefined, path: (string | number)[]) => {
    const sectionIds = new Set<string>();
    for (const [s, section] of (sections ?? []).entries()) {
      if (sectionIds.has(section.id)) problems.push({ path: [...path, "sections", s, "id"], message: `duplicate section id "${section.id}"` });
      sectionIds.add(section.id);
      for (const [i, setting] of section.settings.entries()) {
        const at = [...path, "sections", s, "settings", i];
        if (keys.has(setting.key)) problems.push({ path: [...at, "key"], message: `duplicate setting key "${setting.key}"` });
        keys.add(setting.key);
        if (setting.type === "select" && setting.default !== undefined && !setting.options.some((o) => o.value === setting.default)) {
          problems.push({ path: [...at, "default"], message: `"${setting.default}" is not one of its options` });
        }
        if (setting.type === "checkboxes") {
          for (const value of setting.default ?? []) {
            if (!setting.options.some((o) => o.value === value)) problems.push({ path: [...at, "default"], message: `"${value}" is not one of its options` });
          }
        }
        if (setting.type === "number" && setting.min !== undefined && setting.max !== undefined && setting.min > setting.max) {
          problems.push({ path: [...at, "min"], message: "min is greater than max" });
        }
      }
    }
  };
  const checkSubmenus = (list: AppSettingsSubmenu[] | undefined, path: (string | number)[]) => {
    for (const [m, submenu] of (list ?? []).entries()) {
      const at = [...path, "submenus", m];
      if (submenuIds.has(submenu.id)) problems.push({ path: [...at, "id"], message: `duplicate submenu id "${submenu.id}"` });
      submenuIds.add(submenu.id);
      checkSections(submenu.sections, at);
      checkSubmenus(submenu.submenus, at);
    }
  };
  checkSections(settings.sections, []);
  checkSubmenus(settings.submenus, []);
  return problems;
}
