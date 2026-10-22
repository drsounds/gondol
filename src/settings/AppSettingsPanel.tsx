import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Icon, Input, Select, type IconName } from "../design-system/bungalow-79d923";
import { useI18n, type MessageKey } from "../i18n/i18n";
import { useRegisteredBundles } from "../apps/hooks";
import { getLocalizedText, type InternalAppBundle } from "../apps/types";
import type { AppSetting, AppSettingsSection, AppSettingsSubmenu, AppSettingValue, SettingScope } from "./schema";
import { scopesOf, sectionHasScope, submenuHasScope } from "./tree";
import {
  appSettingDefinitions,
  appSettingsOf,
  coerceSettingValue,
  resolveAppSettings,
  settingValueProblem,
  useSaveAppSetting,
  useScopeSettings,
  useSettingsScopeIds,
  type SettingSource,
} from "./settings";

export interface AppSettingsPanelProps {
  /** Which values it edits: the account's (Account), a site's (its sheet) or a workspace's. */
  scope: SettingScope;
  /** The site or workspace edited; defaults to the one served (or open) here, or the signed-in account. */
  scopeId?: string | null;
  /** Shows the values without letting them change (e.g. a workspace member who isn't an admin). */
  readOnly?: boolean;
  /** Only these apps (default: every app with settings at the scope; Account: only apps that are on). */
  appIds?: string[];
  /** The heading above the list of apps; null for none. */
  title?: string | null;
}

/**
 * The app-specific settings of every app with settings stored at `scope`: a list of apps, each
 * opening its sections and submenu rows, and submenus opening their own (like iPhone settings).
 * Every change is saved as it's made (text when the field loses focus).
 */
export function AppSettingsPanel({ scope, scopeId, readOnly = false, appIds, title }: AppSettingsPanelProps) {
  const { t, locale } = useI18n();
  const ids = useSettingsScopeIds();
  const targetId = scopeId === undefined ? ids[scope] : scopeId;
  const bundles = useRegisteredBundles();
  const apps = useMemo(
    () =>
      bundles.filter((app) => {
        if (appIds && !appIds.includes(app.id)) return false;
        if (scope === "user" && !app.isActive) return false;
        return appSettingDefinitions(app.id).some((d) => d.scopes.includes(scope));
      }),
    [bundles, appIds, scope],
  );
  const single = apps.length === 1 && appIds?.length === 1;
  const [path, setPath] = useState<string[]>([]);
  const appId = single ? apps[0].id : path[0];
  const app = apps.find((a) => a.id === appId);
  const submenuPath = single ? path : path.slice(1);

  const heading = title === undefined ? t("settings.apps.title") : title;
  if (!apps.length) {
    return (
      <div className="app-settings">
        {heading ? <div className="panel-title">{heading}</div> : null}
        <p className="muted">{t("settings.apps.empty")}</p>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="app-settings">
        {heading ? <div className="panel-title">{heading}</div> : null}
        <ul className="app-settings__menu">
          {apps.map((a) => (
            <li key={a.id}>
              <button type="button" className="app-settings__row" onClick={() => setPath([a.id])}>
                <Icon name={a.iconName as IconName} className="app-settings__row-icon" />
                <span className="app-settings__row-text">
                  <span className="app-settings__row-title">{getLocalizedText(a.manifest.name, locale) || a.name}</span>
                </span>
                <span className="app-settings__chevron" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <AppSettingsPage
      app={app}
      scope={scope}
      scopeId={targetId}
      readOnly={readOnly}
      submenuPath={submenuPath}
      onOpen={(id) => setPath((p) => [...p, id])}
      onBack={single && !submenuPath.length ? undefined : () => setPath((p) => p.slice(0, -1))}
    />
  );
}

function AppSettingsPage({
  app,
  scope,
  scopeId,
  readOnly,
  submenuPath,
  onOpen,
  onBack,
}: {
  app: InternalAppBundle;
  scope: SettingScope;
  scopeId: string | null;
  readOnly: boolean;
  submenuPath: string[];
  onOpen: (submenuId: string) => void;
  onBack?: () => void;
}) {
  const { t, locale } = useI18n();
  const settings = appSettingsOf(app);
  const ids = useSettingsScopeIds();
  const own = useScopeSettings(scope, scopeId);
  // What applies when this scope sets nothing: in Account, the open workspace's and the site's values.
  const workspace = useScopeSettings("workspace", scope === "user" ? ids.workspace : null);
  const site = useScopeSettings("site", scope === "user" ? ids.site : null);
  const save = useSaveAppSetting(scope, scopeId);
  const definitions = useMemo(() => appSettingDefinitions(app.id), [app.id]);
  const inherited = useMemo(
    () => resolveAppSettings(app.id, definitions, { workspace: workspace.data, site: site.data }, ["user", ...(scope === "user" ? [] : (["workspace", "site"] as const))]),
    [app.id, definitions, workspace.data, site.data, scope],
  );

  // Walk down to the open submenu, carrying the scopes each level passes on.
  let level: { title: string; description?: string; sections?: AppSettingsSection[]; submenus?: AppSettingsSubmenu[] } = {
    title: getLocalizedText(app.manifest.name, locale) || app.name,
    sections: settings?.sections,
    submenus: settings?.submenus,
  };
  let scopes = scopesOf(settings?.scope, ["user"]);
  for (const id of submenuPath) {
    const submenu = level.submenus?.find((s) => s.id === id);
    if (!submenu) break;
    scopes = scopesOf(submenu.scope, scopes);
    level = {
      title: getLocalizedText(submenu.title, locale),
      description: submenu.description ? getLocalizedText(submenu.description, locale) : undefined,
      sections: submenu.sections,
      submenus: submenu.submenus,
    };
  }
  const sections = (level.sections ?? []).filter((section) => sectionHasScope(section, scopes, scope));
  const submenus = (level.submenus ?? []).filter((submenu) => submenuHasScope(submenu, scopes, scope));
  const stored = own.data?.[app.id] ?? {};

  return (
    <div className="app-settings">
      <div className="app-settings__head">
        {onBack ? (
          <Button type="button" variant="ghost" size="sm" className="app-settings__back" onClick={onBack}>
            ‹ {t("settings.back")}
          </Button>
        ) : null}
        <div className="panel-title">{level.title}</div>
        <span className="app-settings__status muted" aria-live="polite">
          {save.isPending ? t("settings.saving") : save.isSuccess ? t("settings.saved") : ""}
        </span>
      </div>
      {level.description ? <p className="muted">{level.description}</p> : null}
      {readOnly ? <p className="muted">{t("settings.readOnly")}</p> : null}
      {save.error ? <p className="bungalow-help bungalow-help--error">{t("settings.saveFailed", { message: save.error.message })}</p> : null}
      {!scopeId ? <p className="muted">{t("settings.noScope")}</p> : null}
      {sections.map((section) => {
        const sectionScopes = scopesOf(section.scope, scopes);
        const fields = section.settings.filter((setting) => scopesOf(setting.scope, sectionScopes).includes(scope));
        return (
          <section key={section.id} className="app-settings__section">
            {section.title ? <p className="form-section-title">{getLocalizedText(section.title, locale)}</p> : null}
            {section.description ? <p className="muted">{getLocalizedText(section.description, locale)}</p> : null}
            <div className="stack">
              {fields.map((setting) => (
                <SettingField
                  key={setting.key}
                  setting={setting}
                  value={coerceSettingValue(setting, stored[setting.key])}
                  inherited={inherited.values[setting.key]}
                  inheritedFrom={inherited.sources[setting.key]}
                  disabled={readOnly || !scopeId || own.isLoading}
                  onChange={(value) => save.mutate({ appId: app.id, key: setting.key, value })}
                />
              ))}
            </div>
          </section>
        );
      })}
      {submenus.length ? (
        <ul className="app-settings__menu">
          {submenus.map((submenu) => (
            <li key={submenu.id}>
              <button type="button" className="app-settings__row" onClick={() => onOpen(submenu.id)}>
                <Icon name={(submenu.iconName ?? "settings") as IconName} className="app-settings__row-icon" />
                <span className="app-settings__row-text">
                  <span className="app-settings__row-title">{getLocalizedText(submenu.title, locale)}</span>
                  {submenu.description ? <span className="app-settings__row-hint">{getLocalizedText(submenu.description, locale)}</span> : null}
                </span>
                <span className="app-settings__chevron" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function displayValue(setting: AppSetting, value: AppSettingValue | undefined, locale: string): string {
  if (value === undefined || value === "") return "";
  if (setting.type === "select") return getLocalizedText(setting.options.find((o) => o.value === value)?.label, locale) || String(value);
  if (setting.type === "checkboxes" && Array.isArray(value)) {
    return value.map((v) => getLocalizedText(setting.options.find((o) => o.value === v)?.label, locale) || v).join(", ");
  }
  if (setting.type === "string" && setting.format === "password") return "••••••";
  if (setting.type === "number" && setting.unit) return `${value} ${setting.unit}`;
  return String(value);
}

/** One setting's control: its own value at the scope, or what applies without one shown beside it. */
function SettingField({
  setting,
  value,
  inherited,
  inheritedFrom,
  disabled,
  onChange,
}: {
  setting: AppSetting;
  value: AppSettingValue | undefined;
  inherited: AppSettingValue | undefined;
  inheritedFrom: SettingSource | undefined;
  disabled: boolean;
  onChange: (value: AppSettingValue | undefined) => void;
}) {
  const { t, locale } = useI18n();
  const label = getLocalizedText(setting.label, locale);
  const description = setting.description ? getLocalizedText(setting.description, locale) : undefined;
  const shown = value ?? inherited;
  const inheritedText = displayValue(setting, inherited, locale);
  const fallbackHint = inheritedText
    ? t(inheritedFrom === "site" ? "settings.fromSite" : inheritedFrom === "workspace" ? "settings.fromWorkspace" : "settings.default", { value: inheritedText })
    : undefined;
  const hint = [description, value === undefined ? fallbackHint : undefined].filter(Boolean).join(" · ") || undefined;
  const reset =
    value !== undefined && !disabled ? (
      <Button type="button" variant="ghost" size="sm" className="app-settings__reset" onClick={() => onChange(undefined)}>
        {t("settings.reset")}
      </Button>
    ) : null;

  switch (setting.type) {
    case "checkbox":
      return (
        <div className="bungalow-field app-settings__field">
          <Checkbox label={label} checked={shown === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          {hint ? <span className="bungalow-help">{hint}</span> : null}
          {reset}
        </div>
      );
    case "checkboxes": {
      const selected = Array.isArray(shown) ? shown : [];
      return (
        <div className="bungalow-field app-settings__field" role="group" aria-label={label}>
          <span className="bungalow-label">{label}</span>
          <div className="app-settings__options">
            {setting.options.map((option) => (
              <Checkbox
                key={option.value}
                label={getLocalizedText(option.label, locale)}
                checked={selected.includes(option.value)}
                disabled={disabled}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected.filter((v) => v !== option.value), option.value] : selected.filter((v) => v !== option.value))
                }
              />
            ))}
          </div>
          {hint ? <span className="bungalow-help">{hint}</span> : null}
          {reset}
        </div>
      );
    }
    case "select":
      if (setting.display === "radio") {
        return (
          <div className="bungalow-field app-settings__field" role="radiogroup" aria-label={label}>
            <span className="bungalow-label">{label}</span>
            <div className="app-settings__options">
              {setting.options.map((option) => (
                <label key={option.value} className={`bungalow-check${disabled ? " bungalow-check--disabled" : ""}`}>
                  <input type="radio" checked={shown === option.value} disabled={disabled} onChange={() => onChange(option.value)} />
                  <span>
                    {getLocalizedText(option.label, locale)}
                    {option.description ? <span className="bungalow-help"> {getLocalizedText(option.description, locale)}</span> : null}
                  </span>
                </label>
              ))}
            </div>
            {hint ? <span className="bungalow-help">{hint}</span> : null}
            {reset}
          </div>
        );
      }
      return (
        <div className="app-settings__field">
          <Select label={label} hint={hint} value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">{inheritedText ? t("settings.useInherited", { value: inheritedText }) : t("settings.notSet")}</option>
            {setting.options.map((option) => (
              <option key={option.value} value={option.value}>
                {getLocalizedText(option.label, locale)}
              </option>
            ))}
          </Select>
        </div>
      );
    case "text":
    case "string":
    case "number":
      return <TypedField setting={setting} label={label} hint={hint} value={value} placeholder={inheritedText} disabled={disabled} onChange={onChange} reset={reset} />;
  }
}

/** Free text, strings and numbers: edited as a draft, saved when the field loses focus (or Enter). */
function TypedField({
  setting,
  label,
  hint,
  value,
  placeholder,
  disabled,
  onChange,
  reset,
}: {
  setting: Extract<AppSetting, { type: "text" | "string" | "number" }>;
  label: string;
  hint?: string;
  value: AppSettingValue | undefined;
  placeholder: string;
  disabled: boolean;
  onChange: (value: AppSettingValue | undefined) => void;
  reset: React.ReactNode;
}) {
  const { t } = useI18n();
  const stored = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(stored);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setDraft(stored), [stored]);

  const parse = (text: string): AppSettingValue | undefined => {
    if (text.trim() === "") return undefined;
    return setting.type === "number" ? Number(text.replace(",", ".")) : text;
  };
  const commit = () => {
    if (draft === stored) return;
    const next = parse(draft);
    const issue = settingValueProblem(setting, next);
    setProblem(issue);
    if (!issue) onChange(next);
  };
  const error = problem
    ? t(problem as MessageKey, {
        min: setting.type === "number" ? (setting.min ?? "−∞") : "",
        max: setting.type === "number" ? (setting.max ?? "∞") : "",
        max_length: setting.type !== "number" ? (setting.maxLength ?? "") : "",
      })
    : undefined;
  const ownPlaceholder = "placeholder" in setting ? setting.placeholder : undefined;

  if (setting.type === "text") {
    const id = `app-setting-${setting.key}`;
    return (
      <div className="bungalow-field app-settings__field">
        <label className="bungalow-label" htmlFor={id}>
          {label}
        </label>
        <textarea
          id={id}
          className="bungalow-input form-textarea"
          rows={setting.rows ?? 4}
          maxLength={setting.maxLength}
          placeholder={placeholder || ownPlaceholder}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
        {error || hint ? <span className={`bungalow-help${error ? " bungalow-help--error" : ""}`}>{error ?? hint}</span> : null}
        {reset}
      </div>
    );
  }

  const type = setting.type === "number" ? "number" : setting.format === "password" ? "password" : setting.format === "url" ? "url" : setting.format === "email" ? "email" : "text";
  return (
    <div className="app-settings__field">
      <Input
        label={setting.type === "number" && setting.unit ? `${label} (${setting.unit})` : label}
        hint={hint}
        error={error}
        type={type}
        inputMode={setting.type === "number" ? (setting.integer ? "numeric" : "decimal") : undefined}
        min={setting.type === "number" ? setting.min : undefined}
        max={setting.type === "number" ? setting.max : undefined}
        step={setting.type === "number" ? (setting.step ?? (setting.integer ? 1 : "any")) : undefined}
        maxLength={setting.type === "string" ? setting.maxLength : undefined}
        autoComplete={setting.type === "string" && setting.format === "password" ? "new-password" : "off"}
        placeholder={setting.type === "string" && setting.format === "password" ? ownPlaceholder : placeholder || ownPlaceholder}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {reset}
    </div>
  );
}
