import type { AppPackage } from "./server.mjs";

export function buildAppPackage(
  dir: string,
  options?: { logLevel?: "info" | "warn" | "error" | "silent" },
): Promise<{ app: AppPackage; outputs: { client: string; styles: string[]; server: string | null } }>;
