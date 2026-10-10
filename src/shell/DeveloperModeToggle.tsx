import { useEffect, useState } from "react";
import { Checkbox } from "../design-system/bungalow-79d923";
import { isDesktopApp } from "./desktopApp";
import { useBrowserDeveloperMode } from "./developerMode";
import { useI18n } from "../i18n/i18n";
import { SiteLockHint } from "../sites/SiteLockHint";
import { useSitePreferenceLock } from "../sites/preferences";

/** Account settings, browser only (the desktop app's developer mode is in AppSourcePicker):
 * lets the browser's own right-click menu and text selection back in (src/lib/developerMode.ts). */
export function DeveloperModeToggle() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useBrowserDeveloperMode();
  const [desktop, setDesktop] = useState(true);
  const locked = !!useSitePreferenceLock("developerMode");

  useEffect(() => setDesktop(isDesktopApp()), []);

  if (desktop) return null;

  return (
    <div className="bungalow-field">
      <Checkbox
        label={t("developerMode.label")}
        checked={enabled}
        disabled={locked}
        onChange={(event) => setEnabled(event.target.checked)}
      />
      <span className="bungalow-help">{t("developerMode.hint")}</span>
      <SiteLockHint preference="developerMode" />
    </div>
  );
}
