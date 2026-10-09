import { invoke, isTauri } from "@tauri-apps/api/core";

let publicOriginUrl = "";
let bridgeName = "gondolDesktop";

/**
 * Configures the desktop shells (Tauri and Electron): `publicOrigin` is the web app's public
 * address, which links that leave the app (ICS feeds, e-mail confirmations) must point to even when
 * it runs from the desktop app's bundled sp:// assets; `bridge` is the `window` property the
 * Electron preload script exposes (`window.<bridge>`).
 */
export function configureDesktopApp(options: { publicOrigin: string; bridge?: string }): void {
  publicOriginUrl = options.publicOrigin;
  if (options.bridge) bridgeName = options.bridge;
}

/** Which build the desktop app's window loads: the UI app bundled into the app (sp://xpui/), or
 * what is live at the public origin. */
export type AppSource = "bundled" | "live";

export interface AppSourceInfo {
  source: AppSource;
  url: string;
  /** A launch option (--live, --bundled, --url=…) decides this run; a change applies next launch. */
  overridden: boolean;
  liveUrl: string;
  /** sp:// apps prefer uncompressed ones in `developerFolder`; DevTools and Reload are enabled. */
  developerMode: boolean;
  developerFolder: string | null;
}

/** What the Electron preload script exposes as `window.<bridge>` (see configureDesktopApp). */
interface ElectronBridge {
  shell: "electron";
  appSource(): Promise<AppSourceInfo>;
  setAppSource(source: AppSource): Promise<void>;
  setDeveloperMode(enabled: boolean): Promise<void>;
}

function electron(): ElectronBridge | undefined {
  return typeof window === "undefined" ? undefined : ((window as unknown as Record<string, unknown>)[bridgeName] as ElectronBridge | undefined);
}

/** True inside the Tauri desktop/mobile app or the Electron app (bundled or live), false in a
 * browser. */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && (isTauri() || electron() !== undefined);
}

/** The origin to put in links that are opened outside this window. */
export function publicOrigin(): string {
  if (typeof window === "undefined") return "";
  const { protocol, hostname, origin } = window.location;
  // Internal apps are sp://<slug>/ (in Electron, and Tauri on macOS/Linux/iOS) and
  // https://sp.<slug>/ in Tauri on Windows/Android.
  const bundled = protocol === "sp:" || (isDesktopApp() && /^sp\.[a-z0-9-]+$/.test(hostname));
  return bundled ? publicOriginUrl || origin : origin;
}

export function getAppSource(): Promise<AppSourceInfo> {
  return electron()?.appSource() ?? invoke<AppSourceInfo>("app_source");
}

/** Saves the choice and reloads the window from it (unless a launch option overrides it). */
export function setAppSource(source: AppSource): Promise<void> {
  return electron()?.setAppSource(source) ?? invoke("set_app_source", { source });
}

/** Saves developer mode and reloads the window. */
export function setDeveloperMode(enabled: boolean): Promise<void> {
  return electron()?.setDeveloperMode(enabled) ?? invoke("set_developer_mode", { enabled });
}
