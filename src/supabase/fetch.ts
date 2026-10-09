function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/** A fetch that sends `supabaseKey` as the apikey header (new opaque API keys are not bearer JWTs). */
export function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/** Throws (and logs) when any of the named environment variables is missing. */
export function requireEnv<T extends Record<string, string | undefined>>(vars: T): { [K in keyof T]: string } {
  const missing = Object.entries(vars)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Set them in your deployment environment.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }
  return vars as { [K in keyof T]: string };
}

/** A stand-in that creates the real object on first use, so importing a client never needs the environment. */
export function lazy<T extends object>(create: () => T): T {
  let instance: T | undefined;
  return new Proxy({} as T, {
    get(_, prop, receiver) {
      instance ??= create();
      return Reflect.get(instance, prop, receiver);
    },
  });
}
