// The yt-music-service app's search (gondol/builtin/yt-music-service), ported from Bungalow's
// YouTubeSearch: turns a query into YouTube videos, for the "Play with…" chooser and for playing a
// musik: URI by its title and artist. The browser can't search YouTube itself (no CORS), so it asks
// this function, as the signed-in user.
//
// POST body: { action: "search", query, max? }  →  { results: [{ videoId, title, channel, thumbnail, durationMs? }], via }
//
// With a YouTube Data API key on the user's signed-in YouTube account (external_service_accounts,
// its secret in external_service_account_secrets, which only the service role reads) it uses the
// Data API (embeddable videos only); otherwise, or when the key fails (quota), it reads YouTube's
// public results page.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-spacify-workspace",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const deno = (globalThis as typeof globalThis & {
  Deno: { env: { get: (name: string) => string | undefined }; serve: (handler: (request: Request) => Promise<Response>) => void };
}).Deno;

interface Result {
  videoId: string;
  title: string;
  channel?: string;
  thumbnail?: string;
  durationMs?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** "3:45" or "1:02:03" in milliseconds. */
function clockMs(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const parts = text.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  return parts.reduce((sum, n) => sum * 60 + n, 0) * 1000;
}

/** ISO 8601 duration (PT3M45S) in milliseconds. */
function isoMs(text: string | undefined): number | undefined {
  const m = text ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(text) : null;
  if (!m) return undefined;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}

async function apiSearch(query: string, key: string, max: number): Promise<Result[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({ part: "snippet", type: "video", videoEmbeddable: "true", maxResults: String(max), q: query, key }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return [];
  const body = (await response.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> } }[] };
  const results: Result[] = (body.items ?? [])
    .filter((item) => item.id?.videoId)
    .map((item) => ({
      videoId: item.id!.videoId!,
      title: item.snippet?.title ?? item.id!.videoId!,
      channel: item.snippet?.channelTitle,
      thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url,
    }));
  // Durations need a second call.
  if (results.length) {
    const details = new URL("https://www.googleapis.com/youtube/v3/videos");
    details.search = new URLSearchParams({ part: "contentDetails", id: results.map((r) => r.videoId).join(","), key }).toString();
    const more = await fetch(details, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { items?: { id: string; contentDetails?: { duration?: string } }[] } | null;
    for (const item of more?.items ?? []) {
      const found = results.find((r) => r.videoId === item.id);
      if (found) found.durationMs = isoMs(item.contentDetails?.duration);
    }
  }
  return results;
}

/** Every `videoRenderer` in YouTube's results page data, in order. */
function collectRenderers(node: unknown, out: Record<string, unknown>[], depth = 0) {
  if (!node || typeof node !== "object" || depth > 40 || out.length >= 40) return;
  if (Array.isArray(node)) {
    for (const child of node) collectRenderers(child, out, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  if (record.videoRenderer && typeof record.videoRenderer === "object") out.push(record.videoRenderer as Record<string, unknown>);
  for (const value of Object.values(record)) collectRenderers(value, out, depth + 1);
}

const text = (value: unknown): string | undefined => {
  const v = value as { simpleText?: string; runs?: { text?: string }[] } | undefined;
  return v?.simpleText ?? v?.runs?.map((r) => r.text ?? "").join("") ?? undefined;
};

async function scrapeSearch(query: string, max: number): Promise<Result[]> {
  const url = `https://www.youtube.com/results?hl=en&gl=US&search_query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return [];
  const html = await response.text();
  const start = html.indexOf("ytInitialData = ");
  if (start < 0) return [];
  const from = start + "ytInitialData = ".length;
  const end = html.indexOf(";</script>", from);
  let data: unknown;
  try {
    data = JSON.parse(html.slice(from, end));
  } catch {
    return [];
  }
  const renderers: Record<string, unknown>[] = [];
  collectRenderers(data, renderers);
  const seen = new Set<string>();
  const results: Result[] = [];
  for (const r of renderers) {
    const videoId = typeof r.videoId === "string" ? r.videoId : null;
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    const thumbs = (r.thumbnail as { thumbnails?: { url?: string }[] } | undefined)?.thumbnails ?? [];
    results.push({
      videoId,
      title: text(r.title) ?? videoId,
      channel: text(r.ownerText) ?? text(r.longBylineText),
      thumbnail: thumbs[thumbs.length - 1]?.url,
      durationMs: clockMs(text(r.lengthText)),
    });
    if (results.length >= max) break;
  }
  return results;
}

deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  const url = deno.env.get("SUPABASE_URL");
  const anon = deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon) return json({ error: "The function isn't configured" }, 500);
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: user } = await asUser.auth.getUser(token);
  if (!user?.user) return json({ error: "Sign in first" }, 401);

  let body: { action?: string; query?: string; max?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Not JSON" }, 400);
  }
  if (body.action !== "search") return json({ error: "Unknown action" }, 400);
  const query = (body.query ?? "").trim().slice(0, 300);
  if (!query) return json({ results: [], via: "none" });
  const max = Math.max(1, Math.min(Number(body.max) || 8, 20));

  // The key of the user's signed-in YouTube account, when it has one.
  let key: string | null = null;
  if (serviceRole) {
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const { data: account } = await admin
      .from("external_service_accounts")
      .select("id")
      .eq("user_id", user.user.id)
      .eq("service_id", "youtube")
      .eq("status", "signed_in")
      .order("signed_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (account) {
      const { data: secret } = await admin.from("external_service_account_secrets").select("secret").eq("account_id", account.id).maybeSingle();
      const candidate = (secret?.secret as { apiKey?: unknown } | null)?.apiKey;
      if (typeof candidate === "string" && candidate.trim()) key = candidate.trim();
    }
  }

  try {
    if (key) {
      const viaApi = await apiSearch(query, key, max).catch(() => []);
      if (viaApi.length) return json({ results: viaApi, via: "api" });
    }
    return json({ results: await scrapeSearch(query, max), via: "page" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
});
