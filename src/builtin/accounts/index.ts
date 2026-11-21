import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";

/** OAuth connections to services the user's agents and projects may use. */
export const accountsApp = defineApp({
  manifest,
  pages: {
    accounts: () => import("./features/accounts/src/pages/AccountsPage").then((m) => m.AccountsPage),
  },
});

export default accountsApp;
