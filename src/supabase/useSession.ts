import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";

// Every route renders Home, so switching views remounts it. Remember the last known session so a
// remount starts from it instead of flashing the full-page loading state again.
let knownSession: { session: Session | null } | undefined;

export function useSession() {
  const [session, setSession] = useState<Session | null>(() => knownSession?.session ?? null);
  const [loading, setLoading] = useState(() => knownSession === undefined);

  useEffect(() => {
    function apply(next: Session | null) {
      knownSession = { session: next };
      setSession(next);
      setLoading(false);
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => apply(next));

    supabase.auth.getSession().then(({ data }) => apply(data.session));

    return () => subscription.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

/** Whether a signed-in session is already known (outside React, e.g. in route loaders). */
export function hasKnownSession(): boolean {
  return !!knownSession?.session;
}
