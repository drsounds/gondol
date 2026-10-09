import { supabase } from "./client";

/**
 * Returns the current authenticated user ID from Supabase session,
 * throwing an error if the user is not authenticated.
 */
export async function sessionUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

