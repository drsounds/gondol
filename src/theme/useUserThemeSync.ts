import { useCallback, useEffect, useRef, useState } from "react";
import type { Json } from "../supabase/types";
import { supabase } from "../supabase/client";
import { useSession } from "../supabase/useSession";
import type { Theme } from "./theme";
import { defaultUserTheme, isThemeEngine, type SavedTheme, type ThemeEngine, type UserTheme } from "./userTheme";

/** Everything the appearance settings consist of, i.e. one public.user_themes row. */
export interface AppearanceSnapshot {
  mode: Theme;
  accentColor: string | null;
  engine: ThemeEngine;
  theme: UserTheme;
  savedThemes: SavedTheme[];
}

const LAST_SYNC_STORAGE_KEY = "cashflow-theme-last-synced";
const PUSH_DEBOUNCE_MS = 800;

/** Computed lazily: userTheme.tsx imports this file, so it isn't initialized yet at module load. */
function defaultKey(): string {
  return keyOf({ mode: "system", accentColor: null, engine: "advanced", theme: defaultUserTheme(), savedThemes: [] });
}

function keyOf(snapshot: AppearanceSnapshot): string {
  return JSON.stringify(snapshot);
}

function readLastSynced(userId: string): string | null {
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { userId?: string; key?: string }) : null;
    return parsed?.userId === userId && typeof parsed.key === "string" ? parsed.key : null;
  } catch {
    return null;
  }
}

function writeLastSynced(userId: string, key: string) {
  try {
    window.localStorage.setItem(LAST_SYNC_STORAGE_KEY, JSON.stringify({ userId, key }));
  } catch {
    /* ignore */
  }
}

/**
 * Keeps the appearance settings in public.user_themes in step with this device.
 *
 * - On sign-in (and whenever the tab becomes visible again) the row is fetched.
 *   If this device has no unsynced edits the remote settings are adopted;
 *   if it does, local wins and is pushed. A device that has never synced and
 *   still has the default appearance always adopts the remote row.
 * - Afterwards every local change is upserted, debounced.
 *
 * Signed-out use keeps working from localStorage alone.
 */
export function useUserThemeSync(options: {
  /** True once localStorage has been read into state. */
  ready: boolean;
  current: AppearanceSnapshot;
  adopt: (remote: Partial<AppearanceSnapshot>) => void;
}) {
  const { ready, current, adopt } = options;
  const { session } = useSession();
  const userId = session?.user.id;
  const [synced, setSynced] = useState(false);
  const lastSynced = useRef<string | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const adoptRef = useRef(adopt);
  adoptRef.current = adopt;
  const currentKey = keyOf(current);

  const push = useCallback(async (uid: string, snapshot: AppearanceSnapshot) => {
    const key = keyOf(snapshot);
    const { error } = await supabase.from("user_themes").upsert(
      {
        user_id: uid,
        mode: snapshot.mode,
        accent_color: snapshot.accentColor,
        engine: snapshot.engine,
        theme: snapshot.theme as Json,
        saved_themes: snapshot.savedThemes as unknown as Json,
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.warn("Could not sync appearance settings", error);
      return;
    }
    lastSynced.current = key;
    writeLastSynced(uid, key);
  }, []);

  const reconcile = useCallback(
    async (uid: string) => {
      const { data, error } = await supabase.from("user_themes").select("*").eq("user_id", uid).maybeSingle();
      if (error) {
        console.warn("Could not load appearance settings", error);
        return false;
      }
      const local = currentRef.current;
      const baseline = lastSynced.current ?? readLastSynced(uid) ?? defaultKey();
      const hasLocalEdits = keyOf(local) !== baseline;

      if (data && !hasLocalEdits) {
        const remote: Partial<AppearanceSnapshot> = {
          mode: (data.mode as Theme | null) ?? local.mode,
          accentColor: data.accent_color,
          engine: isThemeEngine(data.engine) ? data.engine : "advanced",
          theme: (data.theme ?? {}) as UserTheme,
          savedThemes: Array.isArray(data.saved_themes) ? (data.saved_themes as unknown as SavedTheme[]) : [],
        };
        const key = keyOf({ ...local, ...remote } as AppearanceSnapshot);
        lastSynced.current = key;
        writeLastSynced(uid, key);
        if (key !== keyOf(local)) adoptRef.current(remote);
      } else if (hasLocalEdits) {
        await push(uid, local);
      } else {
        lastSynced.current = keyOf(local);
        writeLastSynced(uid, lastSynced.current);
      }
      return true;
    },
    [push],
  );

  useEffect(() => {
    if (!ready || !userId) {
      setSynced(false);
      lastSynced.current = null;
      return;
    }
    let cancelled = false;
    void reconcile(userId).then((ok) => {
      if (!cancelled && ok) setSynced(true);
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcile(userId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, userId, reconcile]);

  useEffect(() => {
    if (!synced || !userId || currentKey === lastSynced.current) return;
    const timer = window.setTimeout(() => void push(userId, currentRef.current), PUSH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [synced, userId, currentKey, push]);
}
