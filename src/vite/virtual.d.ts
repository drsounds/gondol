// Types of the virtual module gondol/vite/apps.mjs generates. Reference it from the app:
// /// <reference types="gondol/vite/virtual" />  (or list "gondol/vite/virtual" in tsconfig "types").
declare module "virtual:gondol/apps" {
  import type { InternalAppBundle } from "gondol/apps/types";
  /** The apps built in, in menu order. */
  const apps: InternalAppBundle[];
  /** Their ids. */
  export const appIds: string[];
  export default apps;
}
