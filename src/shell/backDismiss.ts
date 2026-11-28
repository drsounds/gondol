import { useCallback, useEffect, useRef } from "react";

/**
 * Lets the browser's Back (and Android's back button, which the Android app turns into
 * `history.back()`) dismiss something open over the page, such as a row's menu sheet on a phone,
 * instead of leaving the page. While `open`, an extra history entry with the same address is on
 * top; Back pops it and calls `onDismiss`. Closing it any other way must go through `release()`,
 * which takes the entry off again and resolves once it's gone (navigate only after that, or the
 * pending Back would undo the navigation).
 */
export function useBackDismiss(open: boolean, onDismiss: () => void): { release: () => Promise<void> } {
  const pushedRef = useRef<string | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // The router's own state (its index and key) stays, so popping back to its entry changes nothing for it.
    window.history.pushState({ ...(window.history.state ?? {}), gondolDismiss: token }, "", window.location.href);
    pushedRef.current = token;
    const onPopState = () => {
      if (pushedRef.current !== token) return;
      if ((window.history.state as { gondolDismiss?: string } | null)?.gondolDismiss === token) return;
      pushedRef.current = null;
      dismissRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Unmounted or closed without release(): leave no stray entry behind.
      if (pushedRef.current === token && (window.history.state as { gondolDismiss?: string } | null)?.gondolDismiss === token) {
        pushedRef.current = null;
        window.history.back();
      }
    };
  }, [open]);

  const release = useCallback(() => {
    const token = pushedRef.current;
    pushedRef.current = null;
    if (!token || (window.history.state as { gondolDismiss?: string } | null)?.gondolDismiss !== token) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        window.removeEventListener("popstate", done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 400);
      window.addEventListener("popstate", done);
      window.history.back();
    });
  }, []);

  return { release };
}
