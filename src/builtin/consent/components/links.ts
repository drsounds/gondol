import type { MouseEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import type { PolicyLocale } from "../models";

/** Opens `path` in place, keeping the plain link for a reload or a new tab. */
export function useInAppLink() {
  const router = useRouter();
  return (path: string) => ({
    href: path,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void router.navigate({ to: path } as Parameters<typeof router.navigate>[0]);
    },
  });
}

export const policyLocale = (locale: string): PolicyLocale => (locale === "sv" ? "sv" : "en");
