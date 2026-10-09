import { useEffect, useState } from "react";
import { Checkbox } from "../design-system/bungalow-79d923";
import { isDesktopApp } from "./desktopApp";
import { useBrowserDeveloperMode } from "./developerMode";
import { useI18n } from "../i18n/i18n";

/** Account settings, browser only (the desktop app's developer mode is in AppSourcePicker):
 * lets the browser's own right-click menu and text selection back in (src/lib/developerMode.ts). */
export function DeveloperModeToggle() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useBrowserDeveloperMode();
  const [desktop, setDesktop] = useState(true);

  useEffect(() => setDesktop(isDesktopApp()), []);

  if (desktop) return null;

  return (
    <div className="bungalow-field">
      <Checkbox label={t("developerMode.label")} checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      <span className="bungalow-help">{t("developerMode.hint")}</span>
    </div>
  );
}
