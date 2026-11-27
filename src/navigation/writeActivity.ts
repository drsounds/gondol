/**
 * Requests that change data (POST, PUT, PATCH, DELETE to the database or storage) in flight. The
 * loading bar always shows while any is (NavigationProgress), whatever the "Loading bar for page
 * loads" preference says; reads (GET, HEAD) only show it when that preference is on. Calls to
 * database functions (/rest/v1/rpc/…) are POSTs even when they only read, and the writes among
 * them run as React Query mutations, which the bar also follows, so they aren't counted here.
 * Sign-in calls aren't either.
 */

let inFlight = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeWriteActivity(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWriteActivity() {
  return inFlight;
}

/** Whether a request changes data the loading bar should show for. */
export function isTrackedWrite(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  let path = url;
  try {
    path = new URL(url, "http://localhost").pathname;
  } catch {
    // A relative or odd URL: match on the text as it is.
  }
  if (path.includes("/rest/v1/rpc/")) return false;
  return path.includes("/rest/v1/") || path.includes("/storage/v1/");
}

/** Counts `request` as a write while it is in flight, when it is one. Returns it unchanged. */
export function trackWrite<T>(method: string, url: string, request: Promise<T>): Promise<T> {
  if (!isTrackedWrite(method, url)) return request;
  inFlight += 1;
  emit();
  const done = () => {
    inFlight = Math.max(0, inFlight - 1);
    emit();
  };
  request.then(done, done);
  return request;
}
