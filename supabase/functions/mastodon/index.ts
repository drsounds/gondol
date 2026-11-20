// The mastodon app's server (src/builtin/mastodon; `gondol-api --builtin mastodon --functions <dir>`
// writes it into the host): federation over ActivityPub, the Mastodon client API, and the work the
// app's browser side can't do itself. The host's web server forwards an instance's public paths here
// (spacify's serve.mjs), naming the instance's domain in `x-mastodon-host`:
//
//   GET  /.well-known/webfinger, /.well-known/host-meta, /.well-known/nodeinfo, /nodeinfo/2.0
//   GET  /ap/users/<name>                  a local account's actor (also /@<name> asking for JSON)
//   GET  /ap/users/<name>/{outbox,followers,following,collections/featured}
//   GET  /ap/statuses/<id>                 a public or unlisted status as a Note
//   GET  /ap/actor                         the instance's own actor (it signs fetches)
//   POST /ap/inbox, /ap/users/<name>/inbox the shared and personal inboxes (HTTP signatures checked)
//   …    /api/v1/…, /api/v2/…              the Mastodon client API (a subset, see API below)
//
// and for the app and the database:
//
//   POST /client/resolve  {q, account?}     looks up `user@domain` or a URL on its server and keeps
//                                            what it finds (accounts, statuses) here
//   POST /client/refresh  {account_id}      fetches a remote account and its latest posts again
//   POST /deliver                            turns queued activities (mastodon_activities) into signed
//                                            deliveries and delivers what's due; pg_cron pokes it
//                                            with `x-mastodon-secret` (set_mastodon_function_url()),
//                                            and the app pokes it after a write
//
// Statuses, follows and the rest are written by the app through PostgREST, as the user (RLS); this
// function writes only the federation's side (remote accounts and statuses, incoming follows,
// favourites, boosts) with the service role.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, JWT_SECRET (or
// SUPABASE_JWT_SECRET). Optional: MASTODON_DEFAULT_DOMAIN (the instance when no host is named),
// MASTODON_ALLOW_PRIVATE=true (fetch from private addresses, for development), MASTODON_DEFAULT_AVATAR.
// Deploy with `verify_jwt = false`: other servers call it unauthenticated (with signatures), and
// Mastodon apps with OAuth tokens, which it checks itself.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, jwtVerify } from "npm:jose@5";
import {
  ACTIVITY_STREAMS,
  AP_CONTENT_TYPE,
  PUBLIC_COLLECTION,
  generateKeyPair,
  parseAcct,
  parseSignatureHeader,
  sanitizeHtml,
  signRequest,
  statusTextToHtml,
  verifySignature,
  wantsActivityJson,
} from "../_shared/activitypub.ts";

const env = (name: string) => Deno.env.get(name)?.trim() || undefined;
const SUPABASE_URL = env("SUPABASE_URL")!;
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = env("SUPABASE_ANON_KEY") ?? env("SUPABASE_PUBLISHABLE_KEY") ?? "";
const JWT_SECRET = env("JWT_SECRET") ?? env("SUPABASE_JWT_SECRET") ?? "";
const DEFAULT_DOMAIN = env("MASTODON_DEFAULT_DOMAIN");
const ALLOW_PRIVATE = env("MASTODON_ALLOW_PRIVATE") === "true";
const DEFAULT_AVATAR = env("MASTODON_DEFAULT_AVATAR");
const USER_AGENT = "gondol-mastodon/0.1 (+https://github.com/drsounds/gondol)";
const SOFTWARE = { name: "gondol", version: "0.1.0" };
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY = 1_000_000;
const WORK_MS = 40_000;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const jwtKey = new TextEncoder().encode(JWT_SECRET);

type Json = Record<string, unknown>;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "link",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...headers } });
}
function activityJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": AP_CONTENT_TYPE, "Cache-Control": "max-age=60", ...CORS } });
}
const notFound = () => json({ error: "Record not found" }, 404);
const fail = (status: number, error: string) => json({ error }, status);

// ── Instances, accounts, keys ─────────────────────────────────────────────────────────────────

function requestHost(req: Request): string | null {
  const raw = req.headers.get("x-mastodon-host") ?? req.headers.get("x-forwarded-host") ?? DEFAULT_DOMAIN ?? null;
  return raw ? raw.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "") : null;
}

async function instanceFor(domain: string | null): Promise<Row | null> {
  if (!domain) return null;
  const { data } = await admin.from("mastodon_instances").select("*").eq("domain", domain).is("soft_deleted_at", null).maybeSingle();
  return data;
}

async function instanceById(id: string): Promise<Row | null> {
  const { data } = await admin.from("mastodon_instances").select("*").eq("id", id).maybeSingle();
  return data;
}

const base = (instance: Row) => `https://${instance.domain}`;
const instanceActor = (instance: Row) => `${base(instance)}/ap/actor`;

/** The key pair of a local account or an instance's actor, made on first use. */
async function keysFor(ownerId: string, kind: "account" | "instance"): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
  const { data } = await admin.from("mastodon_keys").select("public_key_pem, private_key_pem").eq("owner_id", ownerId).maybeSingle();
  if (data) return { publicKeyPem: data.public_key_pem, privateKeyPem: data.private_key_pem };
  const pair = await generateKeyPair();
  await admin.from("mastodon_keys").upsert(
    { owner_id: ownerId, owner_kind: kind, public_key_pem: pair.publicKeyPem, private_key_pem: pair.privateKeyPem },
    { onConflict: "owner_id", ignoreDuplicates: true },
  );
  const { data: stored } = await admin.from("mastodon_keys").select("public_key_pem, private_key_pem").eq("owner_id", ownerId).single();
  if (kind === "account") await admin.from("mastodon_accounts").update({ public_key_pem: stored!.public_key_pem }).eq("id", ownerId);
  return { publicKeyPem: stored!.public_key_pem, privateKeyPem: stored!.private_key_pem };
}

async function localAccount(instance: Row, username: string): Promise<Row | null> {
  const { data } = await admin
    .from("mastodon_accounts")
    .select("*")
    .eq("instance_id", instance.id)
    .is("domain", null)
    .ilike("username", username.replace(/[%_\\]/g, "\\$&"))
    .in("status", ["active", "silenced"])
    .is("soft_deleted_at", null)
    .maybeSingle();
  return data;
}

// ── ActivityPub documents ─────────────────────────────────────────────────────────────────────

const ACTOR_CONTEXT = [
  ACTIVITY_STREAMS,
  "https://w3id.org/security/v1",
  {
    manuallyApprovesFollowers: "as:manuallyApprovesFollowers",
    toot: "http://joinmastodon.org/ns#",
    featured: { "@id": "toot:featured", "@type": "@id" },
    discoverable: "toot:discoverable",
    indexable: "toot:indexable",
    schema: "http://schema.org#",
    PropertyValue: "schema:PropertyValue",
    value: "schema:value",
    sensitive: "as:sensitive",
    Hashtag: "as:Hashtag",
  },
];

function bioHtml(instance: Row, note: string | null): string {
  return note ? statusTextToHtml(note, { tagUrl: (name) => `${base(instance)}/tags/${encodeURIComponent(name.toLowerCase())}` }) : "";
}

async function actorDocument(instance: Row, account: Row): Promise<Json> {
  const keys = await keysFor(account.id, "account");
  const fields = Array.isArray(account.fields) ? account.fields : [];
  return {
    "@context": ACTOR_CONTEXT,
    id: account.actor_uri,
    type: account.actor_type ?? "Person",
    preferredUsername: account.username,
    name: account.display_name ?? "",
    summary: bioHtml(instance, account.note),
    url: account.url,
    inbox: account.inbox_url,
    outbox: account.outbox_url,
    followers: account.followers_url,
    following: account.following_url,
    featured: account.featured_url,
    endpoints: { sharedInbox: account.shared_inbox_url },
    manuallyApprovesFollowers: !!account.locked,
    discoverable: !!account.discoverable,
    indexable: !!account.indexable,
    published: account.created_at,
    ...(account.avatar_url ? { icon: { type: "Image", url: account.avatar_url } } : {}),
    ...(account.header_url ? { image: { type: "Image", url: account.header_url } } : {}),
    attachment: fields.map((field: Row) => ({ type: "PropertyValue", name: String(field.name ?? ""), value: bioHtml(instance, String(field.value ?? "")) })),
    publicKey: { id: account.public_key_id, owner: account.actor_uri, publicKeyPem: keys.publicKeyPem },
  };
}

async function instanceActorDocument(instance: Row): Promise<Json> {
  const keys = await keysFor(instance.id, "instance");
  const id = instanceActor(instance);
  return {
    "@context": ACTOR_CONTEXT,
    id,
    type: "Application",
    preferredUsername: instance.domain,
    name: instance.title,
    inbox: `${base(instance)}/ap/inbox`,
    outbox: `${id}/outbox`,
    url: base(instance),
    manuallyApprovesFollowers: true,
    endpoints: { sharedInbox: `${base(instance)}/ap/inbox` },
    publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: keys.publicKeyPem },
  };
}

/** Who a status is addressed to, as Mastodon addresses it. */
function addressing(visibility: string, followers: string, mentions: string[]): { to: string[]; cc: string[] } {
  switch (visibility) {
    case "public":
      return { to: [PUBLIC_COLLECTION], cc: [followers, ...mentions] };
    case "unlisted":
      return { to: [followers], cc: [PUBLIC_COLLECTION, ...mentions] };
    case "private":
      return { to: [followers], cc: mentions };
    default:
      return { to: mentions, cc: [] };
  }
}

interface LoadedStatus {
  status: Row;
  account: Row;
  mentions: Row[];
  tags: string[];
  media: Row[];
  poll: Row | null;
  replyTo: string | null;
}

async function loadStatus(id: string): Promise<LoadedStatus | null> {
  const { data: status } = await admin.from("mastodon_statuses").select("*").eq("id", id).maybeSingle();
  if (!status) return null;
  const [account, mentions, tags, media, poll] = await Promise.all([
    admin.from("mastodon_accounts").select("*").eq("id", status.account_id).single(),
    admin.from("mastodon_mentions").select("silent, account:mastodon_accounts!inner(id, username, domain, actor_uri, url, instance_id)").eq("status_id", id),
    admin.from("mastodon_status_tags").select("tag:mastodon_tags!inner(name)").eq("status_id", id),
    admin.from("mastodon_media_attachments").select("*").eq("status_id", id).order("position"),
    admin.from("mastodon_polls").select("*").eq("status_id", id).maybeSingle(),
  ]);
  return {
    status,
    account: account.data!,
    mentions: (mentions.data ?? []).map((m: Row) => ({ ...m.account, silent: m.silent })),
    tags: (tags.data ?? []).map((t: Row) => t.tag.name),
    media: media.data ?? [],
    poll: poll.data ?? null,
    replyTo: status.in_reply_to_uri ?? null,
  };
}

const MEDIA_TYPES: Record<string, string> = { image: "image/jpeg", gifv: "video/mp4", video: "video/mp4", audio: "audio/mpeg", unknown: "application/octet-stream" };

function guessMediaType(url: string, type: string): string {
  const ext = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url)?.[1]?.toLowerCase();
  const byExt: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4" };
  return (ext && byExt[ext]) || MEDIA_TYPES[type] || "application/octet-stream";
}

/** A local status as a Note (or a Question when it has a poll). */
function noteDocument(instance: Row, loaded: LoadedStatus): Json {
  const { status, account, mentions, tags, media, poll } = loaded;
  const mentionUris = mentions.map((m) => m.actor_uri);
  const { to, cc } = addressing(status.visibility, account.followers_url, mentionUris);
  const domainOf = (m: Row) => m.domain ?? instance.domain;
  const content = statusTextToHtml(status.text ?? "", {
    mentionUrl: (username, domain) =>
      mentions.find((m) => m.username.toLowerCase() === username.toLowerCase() && (!domain || domainOf(m) === domain))?.url ?? null,
    tagUrl: (name) => `${base(instance)}/tags/${encodeURIComponent(name.toLowerCase())}`,
  });
  const note: Json = {
    id: status.uri,
    type: poll ? "Question" : "Note",
    summary: status.spoiler_text || null,
    inReplyTo: loaded.replyTo,
    published: status.published_at,
    ...(status.edited_at ? { updated: status.edited_at } : {}),
    url: status.url,
    attributedTo: account.actor_uri,
    to,
    cc,
    sensitive: !!status.sensitive,
    conversation: status.conversation_uri,
    content,
    ...(status.language ? { contentMap: { [status.language]: content } } : {}),
    attachment: media.map((m) => ({
      type: "Document",
      mediaType: guessMediaType(m.url, m.type),
      url: m.url,
      name: m.description ?? null,
      ...(m.blurhash ? { blurhash: m.blurhash } : {}),
    })),
    tag: [
      ...mentions.filter((m) => !m.silent).map((m) => ({ type: "Mention", href: m.actor_uri, name: `@${m.username}@${domainOf(m)}` })),
      ...tags.map((name) => ({ type: "Hashtag", href: `${base(instance)}/tags/${encodeURIComponent(name)}`, name: `#${name}` })),
    ],
  };
  if (poll) {
    const options = (poll.options as Row[]).map((o) => ({ type: "Note", name: o.title, replies: { type: "Collection", totalItems: o.votes_count ?? 0 } }));
    note[poll.multiple ? "anyOf" : "oneOf"] = options;
    note.endTime = poll.expires_at;
    note.votersCount = poll.voters_count;
    if (poll.expires_at && new Date(poll.expires_at) <= new Date()) note.closed = poll.expires_at;
  }
  return note;
}

const withContext = (doc: Json): Json => ({ "@context": [ACTIVITY_STREAMS, { sensitive: "as:sensitive", Hashtag: "as:Hashtag", toot: "http://joinmastodon.org/ns#", votersCount: "toot:votersCount", blurhash: "toot:blurhash" }], ...doc });

// ── Fetching from other servers ───────────────────────────────────────────────────────────────

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const value = address.toLowerCase();
    if (value === "::1" || value === "::" || value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) return true;
    if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
    return false;
  }
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** Only public HTTPS hosts (no addresses on the server's own networks), unless MASTODON_ALLOW_PRIVATE. */
async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (ALLOW_PRIVATE) {
    if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) addresses");
    return url;
  }
  if (url.protocol !== "https:") throw new Error("Only https addresses");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("Not a public host");
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    if (isPrivateAddress(host)) throw new Error("Not a public host");
    return url;
  }
  const addresses = [
    ...(await Deno.resolveDns(host, "A").catch(() => [] as string[])),
    ...(await Deno.resolveDns(host, "AAAA").catch(() => [] as string[])),
  ];
  if (!addresses.length) throw new Error(`Can't find ${host}`);
  if (addresses.some(isPrivateAddress)) throw new Error("Not a public host");
  return url;
}

async function readLimited(response: Request | Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error("The answer is too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(all);
}

/** GETs an ActivityPub document, signed as the instance's actor (servers with authorized fetch want that). */
async function fetchActivity(raw: string, signer: Row | null): Promise<Json> {
  const url = await assertPublicUrl(raw);
  const headers: Record<string, string> = { Accept: 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"', "User-Agent": USER_AGENT };
  if (signer) {
    const keys = await keysFor(signer.id, "instance");
    Object.assign(headers, await signRequest({ method: "GET", url: url.href, keyId: `${instanceActor(signer)}#main-key`, privateKeyPem: keys.privateKeyPem }));
  }
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw Object.assign(new Error(`${url.host} answered ${response.status}`), { status: response.status });
  return JSON.parse(await readLimited(response)) as Json;
}

async function webfinger(username: string, domain: string): Promise<string> {
  const url = await assertPublicUrl(`https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${username}@${domain}`)}`);
  const response = await fetch(url, { headers: { Accept: "application/jrd+json, application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${domain} doesn't know @${username}`);
  const doc = JSON.parse(await readLimited(response)) as { links?: { rel?: string; type?: string; href?: string }[] };
  const self = doc.links?.find((link) => link.rel === "self" && /activity\+json|ld\+json/.test(link.type ?? ""));
  if (!self?.href) throw new Error(`${domain} has no ActivityPub actor for @${username}`);
  return self.href;
}

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const firstUrl = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return firstUrl(value.find((v) => typeof v === "string" || (v as Row)?.mediaType === "text/html") ?? value[0]);
  if (value && typeof value === "object") return str((value as Row).href) ?? str((value as Row).url);
  return null;
};
const idOf = (value: unknown): string | null => (typeof value === "string" ? value : value && typeof value === "object" ? str((value as Row).id) : null);
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

/** Keeps (or refreshes) a remote actor as a remote account. */
async function upsertActor(doc: Json): Promise<Row> {
  const id = str(doc.id);
  if (!id) throw new Error("The actor has no id");
  const domain = new URL(id).hostname.toLowerCase();
  const key = doc.publicKey as Row | undefined;
  const fields = asList(doc.attachment)
    .filter((a) => (a as Row)?.type === "PropertyValue")
    .slice(0, 16)
    .map((a) => ({ name: String((a as Row).name ?? "").slice(0, 255), value: sanitizeHtml(String((a as Row).value ?? "")).slice(0, 2000) }));
  const row = {
    domain,
    username: (str(doc.preferredUsername) ?? id.split("/").pop() ?? "unknown").slice(0, 200),
    display_name: str(doc.name)?.slice(0, 200) ?? null,
    note_html: doc.summary ? sanitizeHtml(String(doc.summary)).slice(0, 50000) : null,
    avatar_url: firstUrl((doc.icon as Row)?.url ?? doc.icon),
    header_url: firstUrl((doc.image as Row)?.url ?? doc.image),
    fields,
    locked: doc.manuallyApprovesFollowers === true,
    bot: doc.type === "Service" || doc.type === "Application",
    discoverable: doc.discoverable !== false,
    indexable: doc.indexable === true,
    actor_uri: id,
    url: firstUrl(doc.url) ?? id,
    inbox_url: str(doc.inbox),
    shared_inbox_url: str((doc.endpoints as Row)?.sharedInbox),
    outbox_url: str(doc.outbox),
    followers_url: str(doc.followers),
    following_url: str(doc.following),
    featured_url: str(doc.featured),
    public_key_id: str(key?.id),
    public_key_pem: str(key?.publicKeyPem),
    actor_type: ["Person", "Service", "Application", "Group", "Organization"].includes(String(doc.type)) ? String(doc.type) : "Person",
    fetched_at: new Date().toISOString(),
  };
  for (const field of ["avatar_url", "header_url"] as const) if (row[field] && !/^https?:\/\//.test(row[field]!)) row[field] = null;
  const { data, error } = await admin.from("mastodon_accounts").upsert(row, { onConflict: "actor_uri" }).select("*").single();
  if (error) throw new Error(`Couldn't keep ${id}: ${error.message}`);
  return data;
}

/** A remote actor by its URI (or the URI of its key): kept, fetched when unknown or stale. */
async function remoteActor(uri: string, signer: Row | null, fresh = false): Promise<Row> {
  const actorUri = uri.split("#")[0];
  if (!fresh) {
    const { data } = await admin.from("mastodon_accounts").select("*").or(`actor_uri.eq.${JSON.stringify(actorUri)},public_key_id.eq.${JSON.stringify(uri)}`).limit(1).maybeSingle();
    if (data && (data.domain === null || (data.fetched_at && Date.now() - new Date(data.fetched_at).getTime() < 86400_000))) return data;
  }
  const doc = await fetchActivity(actorUri, signer);
  // A key document points at its owner.
  if (!doc.preferredUsername && str(doc.owner)) return await remoteActor(String(doc.owner), signer, true);
  return await upsertActor(doc);
}

/** What a remote status's addressing means here. */
function visibilityOf(object: Json, actor: Row): string {
  const to = asList(object.to).map(String);
  const cc = asList(object.cc).map(String);
  const isPublic = (list: string[]) => list.some((v) => v === PUBLIC_COLLECTION || v === "as:Public" || v === "Public");
  if (isPublic(to)) return "public";
  if (isPublic(cc)) return "unlisted";
  if (actor.followers_url && [...to, ...cc].includes(actor.followers_url)) return "private";
  return "direct";
}

function mediaKind(mediaType: string | null, type: string | null): string {
  const value = (mediaType ?? type ?? "").toLowerCase();
  if (value.startsWith("image") || value === "image") return "image";
  if (value.startsWith("video") || value === "video") return "video";
  if (value.startsWith("audio") || value === "audio") return "audio";
  return "unknown";
}

/** Keeps a remote Note/Question/Article/Page (and its author) here; returns the status id. */
async function ingestObject(object: Json, author: Row): Promise<string> {
  const uri = str(object.id);
  if (!uri) throw new Error("The object has no id");
  if (new URL(uri).hostname !== author.domain) throw new Error("The object isn't from its author's server");
  const content = object.type === "Article" || object.type === "Page"
    ? `<p><a href="${firstUrl(object.url) ?? uri}">${String(object.name ?? "")}</a></p>${String(object.summary ?? "")}`
    : String(object.content ?? "");
  const tags = asList(object.tag) as Row[];
  const language = object.contentMap && typeof object.contentMap === "object" ? Object.keys(object.contentMap as Row)[0] ?? null : null;
  const choices = asList(object.oneOf ?? object.anyOf) as Row[];
  const payload = {
    uri,
    url: firstUrl(object.url) ?? uri,
    account_id: author.id,
    content_html: sanitizeHtml(content).slice(0, 500000),
    spoiler_text: object.type === "Note" || object.type === "Question" ? String(object.summary ?? "").slice(0, 1000) : "",
    sensitive: object.sensitive === true,
    visibility: visibilityOf(object, author),
    language: language?.slice(0, 20) ?? null,
    published_at: str(object.published) ?? new Date().toISOString(),
    edited_at: str(object.updated),
    in_reply_to_uri: idOf(object.inReplyTo),
    mentions: tags.filter((t) => t?.type === "Mention").map((t) => str(t.href)).filter(Boolean),
    tags: tags.filter((t) => t?.type === "Hashtag").map((t) => String(t.name ?? "").replace(/^#/, "")).filter(Boolean).slice(0, 50),
    media: asList(object.attachment).slice(0, 8).map((a) => {
      const item = a as Row;
      const url = firstUrl(item.url);
      return {
        type: mediaKind(str(item.mediaType), str(item.type)),
        url,
        remote_url: url,
        description: str(item.name),
        blurhash: str(item.blurhash),
        meta: item.width && item.height ? { original: { width: item.width, height: item.height } } : {},
      };
    }),
    poll: choices.length >= 2
      ? {
          options: choices.slice(0, 10).map((c) => ({ title: String(c.name ?? "").slice(0, 200), votes_count: Number((c.replies as Row)?.totalItems ?? 0) || 0 })),
          multiple: !!object.anyOf,
          expires_at: str(object.endTime) ?? str(object.closed),
          voters_count: Number(object.votersCount ?? 0) || 0,
        }
      : null,
  };
  const { data, error } = await admin.rpc("mastodon_ingest_status", { p: payload });
  if (error) throw new Error(error.message);
  return data as string;
}

async function knownStatus(uri: string): Promise<Row | null> {
  const { data } = await admin.from("mastodon_statuses").select("*").eq("uri", uri).maybeSingle();
  return data;
}

/** A status by its URI: kept, or fetched from its server. */
async function resolveStatus(uri: string, signer: Row | null): Promise<string> {
  const known = await knownStatus(uri);
  if (known) return known.id;
  const object = await fetchActivity(uri, signer);
  const author = await remoteActor(idOf(object.attributedTo) ?? "", signer);
  return await ingestObject(object, author);
}

/** A remote account's latest public posts (the first page of its outbox). */
async function backfill(account: Row, signer: Row | null, limit = 20): Promise<number> {
  if (!account.outbox_url) return 0;
  const outbox = await fetchActivity(account.outbox_url, signer);
  let page: Json = outbox;
  if (!outbox.orderedItems && !outbox.items && outbox.first) {
    page = typeof outbox.first === "string" ? await fetchActivity(outbox.first, signer) : (outbox.first as Json);
  }
  const items = asList(page.orderedItems ?? page.items).slice(0, limit) as Json[];
  let count = 0;
  const counts = { statuses_count: Number(outbox.totalItems) || undefined };
  for (const item of items) {
    try {
      if (item.type === "Create" && item.object && typeof item.object === "object") {
        await ingestObject(item.object as Json, account);
        count++;
      } else if (item.type === "Announce" && idOf(item.object)) {
        const original = await resolveStatus(idOf(item.object)!, signer);
        await admin.rpc("mastodon_ingest_status", {
          p: { uri: str(item.id), account_id: account.id, reblog_of_id: original, visibility: "public", published_at: str(item.published) },
        });
        count++;
      }
    } catch (error) {
      console.warn("[mastodon] backfill item", (error as Error).message);
    }
  }
  const collectionCount = async (url: string | null) => {
    if (!url) return undefined;
    try {
      return Number((await fetchActivity(url, signer)).totalItems) || 0;
    } catch {
      return undefined;
    }
  };
  const [followers, following] = await Promise.all([collectionCount(account.followers_url), collectionCount(account.following_url)]);
  await admin
    .from("mastodon_accounts")
    .update({ followers_count: followers ?? account.followers_count, following_count: following ?? account.following_count, statuses_count: counts.statuses_count ?? account.statuses_count })
    .eq("id", account.id);
  return count;
}

// ── Delivering ────────────────────────────────────────────────────────────────────────────────

async function accountInstance(account: Row): Promise<Row | null> {
  return account.instance_id ? await instanceById(account.instance_id) : null;
}

async function inboxes(accountId: string, followers: boolean, accounts: string[] = []): Promise<string[]> {
  const { data } = await admin.rpc("mastodon_inboxes", { p_account: accountId, p_followers: followers, p_accounts: accounts });
  return ((data ?? []) as { inbox_url: string }[]).map((row) => row.inbox_url);
}

async function accountById(id: string | null | undefined): Promise<Row | null> {
  if (!id) return null;
  const { data } = await admin.from("mastodon_accounts").select("*").eq("id", id).maybeSingle();
  return data;
}

/** An activity of mastodon_activities as the ActivityPub activity to send, and where to. */
async function buildActivity(activity: Row): Promise<{ body: Json; inboxes: string[] } | null> {
  const actor = await accountById(activity.account_id);
  const snapshot = (activity.object ?? {}) as Row;
  if (!actor) {
    // A deleted account's last word.
    if (activity.type === "Delete" && activity.object_type === "account" && snapshot.actor_uri) {
      return {
        body: { "@context": ACTIVITY_STREAMS, id: `${snapshot.actor_uri}#delete`, type: "Delete", actor: snapshot.actor_uri, to: [PUBLIC_COLLECTION], object: snapshot.actor_uri },
        inboxes: (snapshot.inboxes ?? []) as string[],
      };
    }
    return null;
  }
  const instance = await accountInstance(actor);
  if (!instance) return null;
  const now = new Date().toISOString();
  const id = (suffix: string) => `${actor.actor_uri}#${suffix}/${activity.id}`;

  switch (`${activity.type}:${activity.object_type}`) {
    case "Create:status":
    case "Update:status": {
      const loaded = await loadStatus(activity.object_id);
      if (!loaded || loaded.status.soft_deleted_at) return null;
      const note = noteDocument(instance, loaded);
      const remoteMentions = loaded.mentions.filter((m) => m.domain).map((m) => m.id);
      return {
        body: withContext({
          id: activity.type === "Create" ? `${loaded.status.uri}/activity` : id("updates"),
          type: activity.type,
          actor: actor.actor_uri,
          published: activity.type === "Create" ? loaded.status.published_at : now,
          to: note.to,
          cc: note.cc,
          object: note,
        }),
        inboxes: await inboxes(actor.id, loaded.status.visibility !== "direct", remoteMentions),
      };
    }
    case "Announce:status": {
      const { data: boost } = await admin.from("mastodon_statuses").select("*").eq("id", activity.object_id).maybeSingle();
      if (!boost || boost.soft_deleted_at) return null;
      const { data: original } = await admin.from("mastodon_statuses").select("uri, account_id").eq("id", boost.reblog_of_id).maybeSingle();
      if (!original) return null;
      const author = await accountById(original.account_id);
      return {
        body: {
          "@context": ACTIVITY_STREAMS,
          id: `${boost.uri}/activity`,
          type: "Announce",
          actor: actor.actor_uri,
          published: boost.published_at,
          to: [PUBLIC_COLLECTION],
          cc: [author?.actor_uri, actor.followers_url].filter(Boolean),
          object: original.uri,
        },
        inboxes: await inboxes(actor.id, true, author?.domain ? [author.id] : []),
      };
    }
    case "Delete:status": {
      const mentions = (snapshot.mentions ?? []) as string[];
      return {
        body: { "@context": ACTIVITY_STREAMS, id: `${snapshot.uri}#delete`, type: "Delete", actor: actor.actor_uri, to: [PUBLIC_COLLECTION], object: { id: snapshot.uri, type: "Tombstone" } },
        inboxes: await inboxes(actor.id, snapshot.visibility !== "direct", mentions),
      };
    }
    case "Undo:status": {
      const author = await accountById(snapshot.reblog_of_account);
      return {
        body: {
          "@context": ACTIVITY_STREAMS,
          id: `${snapshot.uri}#undo`,
          type: "Undo",
          actor: actor.actor_uri,
          to: [PUBLIC_COLLECTION],
          object: { id: `${snapshot.uri}/activity`, type: "Announce", actor: actor.actor_uri, object: snapshot.reblog_of_uri },
        },
        inboxes: await inboxes(actor.id, true, author?.domain ? [author.id] : []),
      };
    }
    case "Like:favourite": {
      const { data: fav } = await admin.from("mastodon_favourites").select("uri, status:mastodon_statuses!inner(uri, account_id)").eq("id", activity.object_id).maybeSingle();
      if (!fav) return null;
      const author = await accountById((fav.status as Row).account_id);
      if (!author?.domain) return null;
      return { body: { "@context": ACTIVITY_STREAMS, id: fav.uri, type: "Like", actor: actor.actor_uri, object: (fav.status as Row).uri }, inboxes: await inboxes(actor.id, false, [author.id]) };
    }
    case "Undo:favourite": {
      const author = await accountById(snapshot.status_account_id);
      if (!author?.domain) return null;
      return {
        body: { "@context": ACTIVITY_STREAMS, id: `${snapshot.uri}#undo`, type: "Undo", actor: actor.actor_uri, object: { id: snapshot.uri, type: "Like", actor: actor.actor_uri, object: snapshot.status_uri } },
        inboxes: await inboxes(actor.id, false, [author.id]),
      };
    }
    case "Follow:follow": {
      const { data: follow } = await admin.from("mastodon_follows").select("*").eq("id", activity.object_id).maybeSingle();
      const target = await accountById(follow?.target_account_id);
      if (!follow || !target?.domain) return null;
      return { body: { "@context": ACTIVITY_STREAMS, id: follow.uri, type: "Follow", actor: actor.actor_uri, object: target.actor_uri }, inboxes: await inboxes(actor.id, false, [target.id]) };
    }
    case "Undo:follow": {
      const target = await accountById(snapshot.target_account_id);
      if (!target?.domain) return null;
      return {
        body: { "@context": ACTIVITY_STREAMS, id: `${snapshot.uri}#undo`, type: "Undo", actor: actor.actor_uri, object: { id: snapshot.uri, type: "Follow", actor: actor.actor_uri, object: target.actor_uri } },
        inboxes: await inboxes(actor.id, false, [target.id]),
      };
    }
    case "Accept:follow":
    case "Reject:follow": {
      let followUri: string | null = snapshot.uri ?? null;
      let follower = await accountById(snapshot.follower_account_id);
      if (activity.object_id) {
        const { data: follow } = await admin.from("mastodon_follows").select("*").eq("id", activity.object_id).maybeSingle();
        if (!follow) return null;
        followUri = follow.uri;
        follower = await accountById(follow.account_id);
      }
      if (!follower?.domain) return null;
      return {
        body: {
          "@context": ACTIVITY_STREAMS,
          id: id(activity.type === "Accept" ? "accepts" : "rejects"),
          type: activity.type,
          actor: actor.actor_uri,
          object: { id: followUri, type: "Follow", actor: follower.actor_uri, object: actor.actor_uri },
        },
        inboxes: await inboxes(actor.id, false, [follower.id]),
      };
    }
    case "Block:block": {
      const { data: block } = await admin.from("mastodon_blocks").select("*").eq("id", activity.object_id).maybeSingle();
      const target = await accountById(block?.target_account_id);
      if (!block || !target?.domain) return null;
      return { body: { "@context": ACTIVITY_STREAMS, id: block.uri ?? id("blocks"), type: "Block", actor: actor.actor_uri, object: target.actor_uri }, inboxes: await inboxes(actor.id, false, [target.id]) };
    }
    case "Undo:block": {
      const target = await accountById(snapshot.target_account_id);
      if (!target?.domain) return null;
      return {
        body: { "@context": ACTIVITY_STREAMS, id: `${snapshot.uri ?? id("blocks")}#undo`, type: "Undo", actor: actor.actor_uri, object: { id: snapshot.uri, type: "Block", actor: actor.actor_uri, object: target.actor_uri } },
        inboxes: await inboxes(actor.id, false, [target.id]),
      };
    }
    case "Update:account":
      return {
        body: { "@context": ACTOR_CONTEXT, id: id("updates"), type: "Update", actor: actor.actor_uri, to: [PUBLIC_COLLECTION], object: await actorDocument(instance, actor) },
        inboxes: await inboxes(actor.id, true),
      };
    case "Create:poll_vote": {
      const { data: vote } = await admin.from("mastodon_poll_votes").select("*, poll:mastodon_polls!inner(options, status:mastodon_statuses!inner(uri, account_id))").eq("id", activity.object_id).maybeSingle();
      if (!vote) return null;
      const poll = vote.poll as Row;
      const author = await accountById(poll.status.account_id);
      if (!author?.domain) return null;
      return {
        body: {
          "@context": ACTIVITY_STREAMS,
          id: `${vote.uri}/activity`,
          type: "Create",
          actor: actor.actor_uri,
          to: [author.actor_uri],
          object: { id: vote.uri, type: "Note", name: (poll.options as Row[])[vote.choice]?.title, attributedTo: actor.actor_uri, to: [author.actor_uri], inReplyTo: poll.status.uri },
        },
        inboxes: await inboxes(actor.id, false, [author.id]),
      };
    }
  }
  return null;
}

async function deliverOne(delivery: Row): Promise<void> {
  try {
    const signerAccount = await accountById(delivery.account_id);
    const keyId = signerAccount ? signerAccount.public_key_id : `${(delivery.body as Row).actor}#main-key`;
    const keys = await keysFor(delivery.account_id, "account");
    const url = await assertPublicUrl(delivery.inbox_url);
    const body = JSON.stringify(delivery.body);
    const headers = await signRequest({ method: "POST", url: url.href, body, keyId, privateKeyPem: keys.privateKeyPem });
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": AP_CONTENT_TYPE, Accept: "application/activity+json", "User-Agent": USER_AGENT },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    await response.body?.cancel();
    await admin.rpc("mastodon_delivery_result", { p_id: delivery.id, p_status: response.status, p_error: response.ok ? null : `${response.status} ${response.statusText}` });
  } catch (error) {
    await admin.rpc("mastodon_delivery_result", { p_id: delivery.id, p_status: 0, p_error: (error as Error).message });
  }
}

/** Expands queued activities into deliveries, then delivers what's due, for up to WORK_MS. */
async function runDeliveries(): Promise<{ activities: number; delivered: number }> {
  const started = Date.now();
  let activities = 0;
  let delivered = 0;
  for (;;) {
    const { data: claimed } = await admin.rpc("mastodon_claim_activities", { p_limit: 25 });
    const rows = (claimed ?? []) as Row[];
    if (!rows.length) break;
    for (const activity of rows) {
      try {
        const built = await buildActivity(activity);
        if (built?.inboxes.length) {
          await admin.from("mastodon_deliveries").insert(
            [...new Set(built.inboxes)].map((inbox_url) => ({ activity_id: activity.id, account_id: activity.account_id, inbox_url, body: built.body })),
          );
        }
      } catch (error) {
        await admin.from("mastodon_activities").update({ error: (error as Error).message.slice(0, 1000) }).eq("id", activity.id);
      }
      activities++;
    }
    if (Date.now() - started > WORK_MS / 2) break;
  }
  while (Date.now() - started < WORK_MS) {
    const { data: due } = await admin.rpc("mastodon_claim_deliveries", { p_limit: 40 });
    const rows = (due ?? []) as Row[];
    if (!rows.length) break;
    for (let i = 0; i < rows.length; i += 8) {
      await Promise.all(rows.slice(i, i + 8).map(deliverOne));
    }
    delivered += rows.length;
  }
  return { activities, delivered };
}

// ── The inbox ─────────────────────────────────────────────────────────────────────────────────

async function domainSuspended(instance: Row | null, domain: string): Promise<boolean> {
  const { data } = await admin.rpc("mastodon_domain_blocked", { p_instance: instance?.id ?? null, p_domain: domain, p_severity: "suspend" });
  return data === true;
}

/** Whether anyone here cares about a remote post: a local account follows its author, it mentions
 * or answers someone here, or it's a vote. */
async function relevant(object: Json, author: Row): Promise<boolean> {
  const { count } = await admin.from("mastodon_follows").select("id", { count: "exact", head: true }).eq("target_account_id", author.id).not("user_id", "is", null);
  if (count) return true;
  const mentions = (asList(object.tag) as Row[]).filter((t) => t?.type === "Mention").map((t) => String(t.href ?? ""));
  if (mentions.length) {
    const { count: local } = await admin.from("mastodon_accounts").select("id", { count: "exact", head: true }).in("actor_uri", mentions).is("domain", null);
    if (local) return true;
  }
  const reply = idOf(object.inReplyTo);
  if (reply && (await knownStatus(reply))) return true;
  return false;
}

async function handleInbox(req: Request, path: string, instance: Row | null): Promise<Response> {
  const body = await readLimited(req);
  let activity: Json;
  try {
    activity = JSON.parse(body) as Json;
  } catch {
    return fail(400, "Not JSON");
  }
  const signature = parseSignatureHeader(req.headers.get("signature"));
  if (!signature) return fail(401, "Unsigned request");
  const host = requestHost(req);
  const header = (name: string) => (name === "host" ? host : req.headers.get(name));
  const signerDomain = new URL(signature.keyId).hostname.toLowerCase();
  if (await domainSuspended(instance, signerDomain)) return new Response(null, { status: 202, headers: CORS });

  let signer: Row;
  try {
    signer = await remoteActor(signature.keyId, instance);
  } catch (error) {
    // A deleted actor's own Delete can't be checked any more: nothing to do with it anyway.
    if (activity.type === "Delete") return new Response(null, { status: 202, headers: CORS });
    return fail(401, `Can't find the signing key: ${(error as Error).message}`);
  }
  let checked = signer.public_key_pem
    ? await verifySignature({ method: req.method, path, header, body, signature, publicKeyPem: signer.public_key_pem })
    : { ok: false as const, reason: "No key" };
  if (!checked.ok && signer.domain) {
    // Keys get rotated: fetch the actor once more.
    signer = await remoteActor(signature.keyId, instance, true);
    if (signer.public_key_pem) checked = await verifySignature({ method: req.method, path, header, body, signature, publicKeyPem: signer.public_key_pem });
  }
  if (!checked.ok) return fail(401, checked.reason);
  if (!signer.domain) return fail(403, "Local accounts don't post to the inbox");
  const actorId = idOf(activity.actor);
  if (actorId && new URL(actorId).hostname.toLowerCase() !== signer.domain) return fail(403, "The activity isn't from the signer's server");

  try {
    await processActivity(activity, signer, instance);
  } catch (error) {
    console.warn("[mastodon] inbox", activity.type, (error as Error).message);
    return fail(422, (error as Error).message);
  }
  return new Response(null, { status: 202, headers: CORS });
}

async function localByActor(uri: string | null): Promise<Row | null> {
  if (!uri) return null;
  const { data } = await admin.from("mastodon_accounts").select("*").eq("actor_uri", uri).is("domain", null).maybeSingle();
  return data;
}

async function processActivity(activity: Json, signer: Row, instance: Row | null): Promise<void> {
  const object = activity.object as Json | string | undefined;
  const objectId = idOf(object);
  const objectType = typeof object === "object" && object ? String(object.type ?? "") : "";
  switch (activity.type) {
    case "Follow": {
      const target = await localByActor(objectId);
      if (!target) return;
      const { data: existing } = await admin.from("mastodon_follows").select("*").eq("account_id", signer.id).eq("target_account_id", target.id).maybeSingle();
      if (existing) {
        await admin.from("mastodon_follows").update({ uri: str(activity.id) }).eq("id", existing.id);
        if (existing.state === "accepted") await admin.rpc("mastodon_queue", { p_account: target.id, p_type: "Accept", p_object_type: "follow", p_object_id: existing.id });
        return;
      }
      const { error } = await admin.from("mastodon_follows").insert({ account_id: signer.id, target_account_id: target.id, uri: str(activity.id) });
      if (error) {
        await admin.rpc("mastodon_queue", { p_account: target.id, p_type: "Reject", p_object_type: "follow", p_object_id: null, p_object: { uri: str(activity.id), follower_account_id: signer.id } });
      }
      return;
    }
    case "Accept":
    case "Reject": {
      const followUri = objectType === "Follow" || typeof object === "string" ? objectId : null;
      const followerUri = typeof object === "object" && object ? idOf(object.actor) : null;
      let query = admin.from("mastodon_follows").select("*").eq("target_account_id", signer.id);
      if (followUri) query = query.eq("uri", followUri);
      let { data: follow } = await query.maybeSingle();
      if (!follow && followerUri) {
        const follower = await localByActor(followerUri);
        if (follower) ({ data: follow } = await admin.from("mastodon_follows").select("*").eq("account_id", follower.id).eq("target_account_id", signer.id).maybeSingle());
      }
      if (!follow) return;
      if (activity.type === "Accept") await admin.from("mastodon_follows").update({ state: "accepted" }).eq("id", follow.id).eq("state", "pending");
      else await admin.from("mastodon_follows").delete().eq("id", follow.id);
      return;
    }
    case "Undo": {
      const inner = typeof object === "object" && object ? object : null;
      const innerType = inner ? String(inner.type) : "";
      if (innerType === "Follow") {
        const target = await localByActor(idOf(inner!.object));
        if (target) await admin.from("mastodon_follows").delete().eq("account_id", signer.id).eq("target_account_id", target.id);
      } else if (innerType === "Like") {
        const status = await knownStatus(idOf(inner!.object) ?? "");
        if (status) await admin.from("mastodon_favourites").delete().eq("account_id", signer.id).eq("status_id", status.id);
      } else if (innerType === "Announce" || !inner) {
        await admin.from("mastodon_statuses").delete().eq("account_id", signer.id).eq("uri", objectId ?? "");
      } else if (innerType === "Block") {
        const target = await localByActor(idOf(inner!.object));
        if (target) await admin.from("mastodon_blocks").delete().eq("account_id", signer.id).eq("target_account_id", target.id);
      }
      return;
    }
    case "Create": {
      if (typeof object !== "object" || !object) return;
      if (!["Note", "Question", "Article", "Page"].includes(objectType)) return;
      if (idOf(object.attributedTo) !== signer.actor_uri) return;
      // A vote on a local poll: a Note with only a name, answering the Question.
      const reply = idOf(object.inReplyTo);
      if (objectType === "Note" && str(object.name) && !object.content && reply) {
        const status = await knownStatus(reply);
        if (status?.local) {
          const { data: poll } = await admin.from("mastodon_polls").select("*").eq("status_id", status.id).maybeSingle();
          const choice = poll ? (poll.options as Row[]).findIndex((o) => o.title === object.name) : -1;
          if (poll && choice >= 0) await admin.from("mastodon_poll_votes").insert({ poll_id: poll.id, account_id: signer.id, choice, uri: str(object.id) });
          return;
        }
      }
      if (!(await relevant(object, signer))) return;
      await ingestObject(object, signer);
      return;
    }
    case "Update": {
      if (typeof object !== "object" || !object) return;
      if (["Person", "Service", "Application", "Group", "Organization"].includes(objectType)) {
        if (objectId === signer.actor_uri) await upsertActor(object);
        return;
      }
      if (["Note", "Question", "Article", "Page"].includes(objectType) && (await knownStatus(objectId ?? ""))) await ingestObject(object, signer);
      return;
    }
    case "Delete": {
      if (objectId === signer.actor_uri) {
        await admin.from("mastodon_accounts").delete().eq("id", signer.id);
        return;
      }
      if (objectId) await admin.from("mastodon_statuses").delete().eq("uri", objectId).eq("account_id", signer.id);
      return;
    }
    case "Like": {
      const status = await knownStatus(objectId ?? "");
      if (!status?.local) return;
      await admin.from("mastodon_favourites").upsert({ account_id: signer.id, status_id: status.id, uri: str(activity.id) }, { onConflict: "account_id,status_id", ignoreDuplicates: true });
      return;
    }
    case "Announce": {
      if (!objectId) return;
      const known = await knownStatus(objectId);
      const { count } = await admin.from("mastodon_follows").select("id", { count: "exact", head: true }).eq("target_account_id", signer.id).not("user_id", "is", null);
      if (!known?.local && !count) return;
      const original = known?.id ?? (await resolveStatus(objectId, instance));
      await admin.rpc("mastodon_ingest_status", {
        p: { uri: str(activity.id), account_id: signer.id, reblog_of_id: original, visibility: "public", published_at: str(activity.published) },
      });
      return;
    }
    case "Block": {
      const target = await localByActor(objectId);
      if (target) await admin.from("mastodon_blocks").upsert({ account_id: signer.id, target_account_id: target.id, uri: str(activity.id) }, { onConflict: "account_id,target_account_id", ignoreDuplicates: true });
      return;
    }
  }
}

// ── Public documents ──────────────────────────────────────────────────────────────────────────

async function handleWebfinger(url: URL, instance: Row): Promise<Response> {
  const resource = url.searchParams.get("resource") ?? "";
  let username: string | null = null;
  const acct = parseAcct(resource);
  if (acct && acct.domain === instance.domain) username = acct.username;
  const byUrl = /^https:\/\/([^/]+)\/(?:@|ap\/users\/)([A-Za-z0-9_]+)$/.exec(resource);
  if (byUrl && byUrl[1] === instance.domain) username = byUrl[2];
  if (resource === `acct:${instance.domain}@${instance.domain}` || resource === instanceActor(instance)) {
    return json({ subject: `acct:${instance.domain}@${instance.domain}`, links: [{ rel: "self", type: "application/activity+json", href: instanceActor(instance) }] }, 200, { "Content-Type": "application/jrd+json" });
  }
  const account = username ? await localAccount(instance, username) : null;
  if (!account) return notFound();
  return json(
    {
      subject: `acct:${account.username}@${instance.domain}`,
      aliases: [account.url, account.actor_uri],
      links: [
        { rel: "http://webfinger.net/rel/profile-page", type: "text/html", href: account.url },
        { rel: "self", type: "application/activity+json", href: account.actor_uri },
        { rel: "http://ostatus.org/schema/1.0/subscribe", template: `${base(instance)}/authorize_interaction?uri={uri}` },
      ],
    },
    200,
    { "Content-Type": "application/jrd+json; charset=utf-8" },
  );
}

async function nodeinfo(instance: Row): Promise<Json> {
  const { data: info } = await admin.rpc("mastodon_instance_info", { p_domain: instance.domain });
  const stats = (info ?? {}) as Row;
  return {
    version: "2.0",
    software: SOFTWARE,
    protocols: ["activitypub"],
    services: { outbound: [], inbound: [] },
    usage: { users: { total: stats.user_count ?? 0, activeMonth: stats.active_month ?? 0 }, localPosts: stats.status_count ?? 0 },
    openRegistrations: instance.registrations === "open",
    metadata: { nodeName: instance.title, nodeDescription: instance.short_description ?? "" },
  };
}

async function outboxDocument(instance: Row, account: Row, url: URL): Promise<Json> {
  const id = account.outbox_url;
  const { count } = await admin.from("mastodon_statuses").select("id", { count: "exact", head: true }).eq("account_id", account.id).in("visibility", ["public", "unlisted"]).is("soft_deleted_at", null);
  if (!url.searchParams.has("page")) return { "@context": ACTIVITY_STREAMS, id, type: "OrderedCollection", totalItems: count ?? 0, first: `${id}?page=true` };
  const before = url.searchParams.get("max_published");
  let query = admin.from("mastodon_statuses").select("id, published_at, reblog_of_id, uri").eq("account_id", account.id).in("visibility", ["public", "unlisted"]).is("soft_deleted_at", null).order("published_at", { ascending: false }).limit(20);
  if (before) query = query.lt("published_at", before);
  const { data: rows } = await query;
  const items: Json[] = [];
  for (const row of rows ?? []) {
    if (row.reblog_of_id) {
      const { data: original } = await admin.from("mastodon_statuses").select("uri").eq("id", row.reblog_of_id).maybeSingle();
      if (original) items.push({ id: `${row.uri}/activity`, type: "Announce", actor: account.actor_uri, published: row.published_at, to: [PUBLIC_COLLECTION], cc: [account.followers_url], object: original.uri });
      continue;
    }
    const loaded = await loadStatus(row.id);
    if (!loaded) continue;
    const note = noteDocument(instance, loaded);
    items.push({ id: `${row.uri}/activity`, type: "Create", actor: account.actor_uri, published: row.published_at, to: note.to, cc: note.cc, object: note });
  }
  const last = rows?.[rows.length - 1];
  return withContext({
    id: `${id}?page=true${before ? `&max_published=${encodeURIComponent(before)}` : ""}`,
    type: "OrderedCollectionPage",
    partOf: id,
    orderedItems: items,
    ...(last && rows!.length === 20 ? { next: `${id}?page=true&max_published=${encodeURIComponent(last.published_at)}` } : {}),
  });
}

async function handlePublic(req: Request, path: string, url: URL, instance: Row): Promise<Response | null> {
  if (path === "/.well-known/webfinger") return await handleWebfinger(url, instance);
  if (path === "/.well-known/host-meta") {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">\n  <Link rel="lrdd" template="${base(instance)}/.well-known/webfinger?resource={uri}"/>\n</XRD>\n`,
      { headers: { "Content-Type": "application/xrd+xml; charset=utf-8", ...CORS } },
    );
  }
  if (path === "/.well-known/nodeinfo") return json({ links: [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: `${base(instance)}/nodeinfo/2.0` }] });
  if (path === "/nodeinfo/2.0" || path === "/nodeinfo/2.0.json") return json(await nodeinfo(instance));
  if (path === "/ap/actor") return activityJson(await instanceActorDocument(instance));
  if (path === "/ap/actor/outbox") return activityJson({ "@context": ACTIVITY_STREAMS, id: `${instanceActor(instance)}/outbox`, type: "OrderedCollection", totalItems: 0, orderedItems: [] });

  const user = /^\/(?:ap\/users\/|@)([A-Za-z0-9_]+)(\/.*)?$/.exec(path);
  if (user && (req.method === "GET" || req.method === "HEAD")) {
    const account = await localAccount(instance, user[1]);
    if (!account) return notFound();
    const rest = user[2] ?? "";
    if (rest === "" ) return activityJson(await actorDocument(instance, account));
    if (rest === "/outbox") return activityJson(await outboxDocument(instance, account, url));
    if (rest === "/followers" || rest === "/following") {
      return activityJson({ "@context": ACTIVITY_STREAMS, id: `${account.actor_uri}${rest}`, type: "OrderedCollection", totalItems: rest === "/followers" ? account.followers_count : account.following_count });
    }
    if (rest === "/collections/featured") return activityJson({ "@context": ACTIVITY_STREAMS, id: account.featured_url, type: "OrderedCollection", totalItems: 0, orderedItems: [] });
    // /@user/<identifier>: a status by its address.
    const byIdentifier = /^\/([A-Za-z0-9]{22}|[a-z0-9-]+)$/.exec(rest);
    if (byIdentifier) {
      const { data: status } = await admin.from("mastodon_statuses").select("id").eq("account_id", account.id).or(`identifier.eq.${byIdentifier[1]},slug.eq.${byIdentifier[1]}`).maybeSingle();
      if (status) return await statusDocument(instance, status.id);
    }
    return notFound();
  }
  const status = /^\/ap\/statuses\/([0-9a-f-]{36})(\/activity)?$/.exec(path);
  if (status && (req.method === "GET" || req.method === "HEAD")) return await statusDocument(instance, status[1], !!status[2]);
  return null;
}

async function statusDocument(instance: Row, id: string, asActivity = false): Promise<Response> {
  const loaded = await loadStatus(id);
  if (!loaded || !loaded.status.local || loaded.status.soft_deleted_at || !["public", "unlisted"].includes(loaded.status.visibility) || loaded.status.reblog_of_id) {
    return notFound();
  }
  if (loaded.account.status === "suspended") return notFound();
  const note = noteDocument(instance, loaded);
  if (!asActivity) return activityJson(withContext(note));
  return activityJson(withContext({ id: `${loaded.status.uri}/activity`, type: "Create", actor: loaded.account.actor_uri, published: loaded.status.published_at, to: note.to, cc: note.cc, object: note }));
}

// ── Callers: the app's users, Mastodon apps ───────────────────────────────────────────────────

interface Caller {
  userId: string;
  /** A JWT to act as the user through PostgREST (RLS). */
  token: string;
  scopes: string[] | null;
}

async function callerFor(req: Request): Promise<Caller | null> {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!bearer) return null;
  if (bearer.split(".").length === 3) {
    try {
      const { payload } = await jwtVerify(bearer, jwtKey);
      if (payload.role !== "authenticated" || !payload.sub) return null;
      return { userId: payload.sub, token: bearer, scopes: null };
    } catch {
      // Not ours: maybe an opaque token after all.
    }
  }
  const { data } = await admin.rpc("oauth_authenticate", { p_access_token: bearer });
  const row = (data as { user_id: string; client_id: string; scopes: string[]; app_uri: string | null }[] | null)?.[0];
  if (!row) return null;
  const token = await new SignJWT({ role: "authenticated", oauth_client_id: row.client_id, oauth_app_uri: row.app_uri, oauth_scopes: row.scopes })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(row.user_id)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(jwtKey);
  return { userId: row.user_id, token, scopes: row.scopes };
}

function userClient(caller: Caller): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${caller.token}` } },
  });
}

/** Whether the caller's token allows `scope` (Mastodon's: read, write, follow, push; read:x, write:x). */
function allows(caller: Caller, scope: string): boolean {
  if (caller.scopes === null) return true;
  const [group] = scope.split(":");
  return caller.scopes.some((s) => s === scope || s === group || (group === "write" && s === "follow" && /follows|blocks|mutes/.test(scope)) || (group === "read" && s === "follow" && /follows|blocks|mutes/.test(scope)));
}

async function handleClient(req: Request, path: string): Promise<Response> {
  const caller = await callerFor(req);
  if (!caller) return fail(401, "Sign in first");
  const input = (await req.json().catch(() => ({}))) as Row;
  const db = userClient(caller);
  if (path === "/client/deliver") {
    return json(await runDeliveries());
  }
  // The caller's account (any of theirs) picks whose instance signs the fetches.
  const { data: mine } = await db.from("mastodon_accounts").select("id, instance_id").eq("user_id", caller.userId).is("domain", null).limit(1);
  const signer = mine?.[0]?.instance_id ? await instanceById(mine[0].instance_id) : null;
  if (path === "/client/resolve") {
    const q = String(input.q ?? "").trim();
    if (!q) return fail(422, "Nothing to look up");
    const acct = parseAcct(q);
    try {
      if (acct) {
        const { data: local } = await admin.from("mastodon_instances").select("id").eq("domain", acct.domain).is("soft_deleted_at", null).maybeSingle();
        if (local) {
          const { data } = await db.from("mastodon_accounts").select("id").eq("instance_id", local.id).ilike("username", acct.username).maybeSingle();
          return json({ accounts: data ? [data.id] : [], statuses: [] });
        }
        const account = await remoteActor(await webfinger(acct.username, acct.domain), signer, true);
        if (await domainSuspended(signer, account.domain)) return fail(403, "That server is blocked here");
        await backfill(account, signer).catch((error) => console.warn("[mastodon] backfill", error.message));
        return json({ accounts: [account.id], statuses: [] });
      }
      if (/^https?:\/\//.test(q)) {
        const known = await knownStatus(q);
        if (known) return json({ accounts: [], statuses: [known.id] });
        const doc = await fetchActivity(q, signer);
        if (["Person", "Service", "Application", "Group", "Organization"].includes(String(doc.type))) {
          const account = await upsertActor(doc);
          await backfill(account, signer).catch(() => 0);
          return json({ accounts: [account.id], statuses: [] });
        }
        if (["Note", "Question", "Article", "Page"].includes(String(doc.type))) {
          const author = await remoteActor(idOf(doc.attributedTo) ?? "", signer);
          return json({ accounts: [author.id], statuses: [await ingestObject(doc, author)] });
        }
      }
      return json({ accounts: [], statuses: [] });
    } catch (error) {
      return fail(422, (error as Error).message);
    }
  }
  if (path === "/client/refresh") {
    const account = await accountById(String(input.account_id ?? ""));
    if (!account?.domain) return fail(422, "Only remote accounts are fetched again");
    try {
      const fresh = await remoteActor(account.actor_uri, signer, true);
      return json({ account: fresh.id, statuses: await backfill(fresh, signer) });
    } catch (error) {
      return fail(422, (error as Error).message);
    }
  }
  return notFound();
}

// ── The Mastodon client API (a subset) ────────────────────────────────────────────────────────
// Enough for Mastodon apps to sign in (OAuth through gondol's oauth app: /oauth/authorize is its
// consent page, /oauth/token the app API's token endpoint), read timelines, notifications and
// profiles, post, reply, favourite, boost, bookmark, follow and vote.

function defaultAvatar(instance: Row): string {
  return DEFAULT_AVATAR ?? `${base(instance)}/favicon.ico`;
}

function apiAccount(instance: Row, account: Row | null): Json | null {
  if (!account) return null;
  const local = account.local ?? account.domain === instance.domain;
  const fields = (Array.isArray(account.fields) ? account.fields : []) as Row[];
  return {
    id: account.id,
    username: account.username,
    acct: account.domain === instance.domain ? account.username : account.acct,
    display_name: account.display_name ?? "",
    locked: !!account.locked,
    bot: !!account.bot,
    discoverable: !!account.discoverable,
    group: false,
    created_at: account.created_at,
    note: local ? bioHtml(instance, account.note) : account.note_html ?? "",
    url: account.url,
    uri: account.uri,
    avatar: account.avatar ?? defaultAvatar(instance),
    avatar_static: account.avatar ?? defaultAvatar(instance),
    header: account.header ?? "",
    header_static: account.header ?? "",
    followers_count: account.followers_count ?? 0,
    following_count: account.following_count ?? 0,
    statuses_count: account.statuses_count ?? 0,
    last_status_at: account.last_status_at ? String(account.last_status_at).slice(0, 10) : null,
    emojis: [],
    fields: fields.map((f) => ({ name: f.name, value: local ? bioHtml(instance, String(f.value ?? "")) : String(f.value ?? ""), verified_at: f.verified_at ?? null })),
  };
}

function apiStatus(instance: Row, status: Row | null): Json | null {
  if (!status) return null;
  const mentions = (status.mentions ?? []) as Row[];
  const content = status.local
    ? statusTextToHtml(status.text ?? "", {
        mentionUrl: (username, domain) => mentions.find((m) => m.username.toLowerCase() === username.toLowerCase() && (!domain || String(m.acct).endsWith(`@${domain}`) || !String(m.acct).includes("@")))?.url ?? null,
        tagUrl: (name) => `${base(instance)}/tags/${encodeURIComponent(name.toLowerCase())}`,
      })
    : status.content_html ?? "";
  return {
    id: status.id,
    uri: status.uri,
    url: status.url,
    created_at: status.created_at,
    edited_at: status.edited_at,
    account: apiAccount(instance, status.account),
    content,
    spoiler_text: status.spoiler_text ?? "",
    sensitive: !!status.sensitive,
    visibility: status.visibility,
    language: status.language,
    in_reply_to_id: status.in_reply_to_id,
    in_reply_to_account_id: status.in_reply_to_account_id,
    replies_count: status.replies_count,
    reblogs_count: status.reblogs_count,
    favourites_count: status.favourites_count,
    favourited: !!status.favourited,
    reblogged: !!status.reblogged,
    bookmarked: !!status.bookmarked,
    muted: false,
    pinned: false,
    reblog: status.reblog ? apiStatus(instance, status.reblog) : null,
    media_attachments: ((status.media_attachments ?? []) as Row[]).map((m) => ({ ...m, text_url: null })),
    mentions: mentions.map((m) => ({ id: m.id, username: m.username, acct: m.acct, url: m.url })),
    tags: ((status.tags ?? []) as Row[]).map((t) => ({ name: t.name, url: `${base(instance)}/tags/${encodeURIComponent(t.name)}` })),
    emojis: [],
    card: null,
    poll: status.poll ? { ...status.poll, emojis: [], own_votes: status.poll.own_votes ?? [] } : null,
    application: null,
    filtered: [],
    text: status.local ? status.text : null,
  };
}

function apiInstanceV1(instance: Row, info: Row): Json {
  return {
    uri: instance.domain,
    title: instance.title,
    short_description: instance.short_description ?? "",
    description: instance.description ?? instance.short_description ?? "",
    email: instance.contact_email ?? "",
    version: `4.2.0 (compatible; gondol ${SOFTWARE.version})`,
    urls: { streaming_api: `wss://${instance.domain}` },
    stats: { user_count: info.user_count ?? 0, status_count: info.status_count ?? 0, domain_count: info.domain_count ?? 0 },
    thumbnail: instance.thumbnail_url ?? null,
    languages: instance.languages ?? ["en"],
    registrations: instance.registrations !== "closed",
    approval_required: instance.registrations === "approval",
    invites_enabled: false,
    configuration: apiConfiguration(instance),
    contact_account: info.contact_account ? apiAccount(instance, info.contact_account) : null,
    rules: ((instance.rules ?? []) as Row[]).map((rule, i) => ({ id: String(i + 1), text: typeof rule === "string" ? rule : String(rule.text ?? "") })),
  };
}

function apiConfiguration(instance: Row): Json {
  return {
    accounts: { max_featured_tags: 0 },
    statuses: { max_characters: instance.max_status_chars ?? 500, max_media_attachments: 4, characters_reserved_per_url: 23 },
    media_attachments: { supported_mime_types: [], image_size_limit: 0, image_matrix_limit: 0, video_size_limit: 0, video_frame_rate_limit: 0, video_matrix_limit: 0 },
    polls: { max_options: 10, max_characters_per_option: 200, min_expiration: 300, max_expiration: 2678400 },
    translation: { enabled: false },
  };
}

function apiInstanceV2(instance: Row, info: Row): Json {
  return {
    domain: instance.domain,
    title: instance.title,
    version: `4.2.0 (compatible; gondol ${SOFTWARE.version})`,
    source_url: "https://github.com/drsounds/gondol",
    description: instance.short_description ?? "",
    usage: { users: { active_month: info.active_month ?? 0 } },
    thumbnail: { url: instance.thumbnail_url ?? defaultAvatar(instance) },
    languages: instance.languages ?? ["en"],
    configuration: { urls: { streaming: `wss://${instance.domain}` }, ...apiConfiguration(instance) },
    registrations: { enabled: instance.registrations !== "closed", approval_required: instance.registrations === "approval", message: instance.registration_message ?? null },
    contact: { email: instance.contact_email ?? "", account: info.contact_account ? apiAccount(instance, info.contact_account) : null },
    rules: ((instance.rules ?? []) as Row[]).map((rule, i) => ({ id: String(i + 1), text: typeof rule === "string" ? rule : String(rule.text ?? "") })),
  };
}

async function readInput(req: Request): Promise<Row> {
  if (req.method === "GET" || req.method === "DELETE") return {};
  const type = req.headers.get("content-type") ?? "";
  const text = await readLimited(req);
  if (type.includes("application/json")) {
    try {
      return JSON.parse(text || "{}") as Row;
    } catch {
      return {};
    }
  }
  const out: Row = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const array = /^(.+)\[\]$/.exec(key);
    const nested = /^(.+)\[(.+)\]$/.exec(key);
    if (array) (out[array[1]] ??= []).push(value);
    else if (nested) {
      const inner = /^(.+)\]\[$/.exec(nested[2]);
      if (inner) ((out[nested[1]] ??= {})[inner[1]] ??= []).push(value);
      else (out[nested[1]] ??= {})[nested[2]] = value;
    } else out[key] = value;
  }
  return out;
}

const truthy = (value: unknown) => value === true || value === "true" || value === "1" || value === 1;

async function handleApi(req: Request, path: string, url: URL, instance: Row): Promise<Response> {
  const get = req.method === "GET";
  // Open to anyone.
  if (get && (path === "/api/v1/instance" || path === "/api/v2/instance")) {
    const { data } = await admin.rpc("mastodon_instance_info", { p_domain: instance.domain });
    return json(path === "/api/v1/instance" ? apiInstanceV1(instance, (data ?? {}) as Row) : apiInstanceV2(instance, (data ?? {}) as Row));
  }
  if (get && path === "/api/v1/instance/rules") return json(apiInstanceV1(instance, {}).rules);
  if (get && path === "/api/v1/instance/peers") {
    const { data } = await admin.from("mastodon_accounts").select("domain").not("domain", "is", null).limit(1000);
    return json([...new Set((data ?? []).map((r: Row) => r.domain))]);
  }
  if (get && (path === "/api/v1/custom_emojis" || path === "/api/v1/trends" || path === "/api/v1/trends/tags" || path === "/api/v1/announcements")) return json([]);
  if (req.method === "POST" && path === "/api/v1/apps") {
    const input = await readInput(req);
    const redirect = String(input.redirect_uris ?? "").split(/\s+/).filter(Boolean)[0] ?? "";
    if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s#]+$/.test(redirect)) return fail(422, "Validation failed: a redirect URI (https:// or an app's own scheme) is required; out-of-band codes aren't supported");
    const scopes = String(input.scopes ?? "read").split(/[\s+]+/).filter((s) => /^[a-z][a-z0-9_:.-]*$/.test(s));
    const secret = `gcs_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
    const clientId = `gc_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data, error } = await admin
      .from("oauth_clients")
      .insert({
        user_id: instance.user_id,
        app_uri: `spacify:mastodon_instance:${instance.id}`,
        name: String(input.client_name ?? "Mastodon app").slice(0, 200) || "Mastodon app",
        client_id: clientId,
        secret_hash: hash,
        secret_hint: secret.slice(-4),
        redirect_uri: redirect,
        callback_url: /^https?:\/\//.test(String(input.website ?? "")) ? String(input.website) : null,
        scopes,
      })
      .select("id")
      .single();
    if (error) return fail(422, error.message);
    return json({ id: data.id, name: input.client_name ?? "Mastodon app", website: input.website ?? null, redirect_uri: redirect, client_id: clientId, client_secret: secret, vapid_key: "" });
  }

  const caller = await callerFor(req);
  if (!caller) return fail(401, "The access token is invalid");
  const db = userClient(caller);
  const { data: me } = await admin.from("mastodon_accounts").select("*").eq("user_id", caller.userId).eq("instance_id", instance.id).is("domain", null).in("status", ["active", "silenced"]).order("created_at").limit(1).maybeSingle();
  if (!me) return fail(403, "You have no account on this server yet: set one up in the app first");
  const need = (scope: string) => (allows(caller, scope) ? null : fail(403, "This action is outside the authorized scopes"));
  const input = await readInput(req);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 40);
  const accountJson = async (id: string) => {
    const { data } = await db.rpc("mastodon_account_card", { p_id: id });
    return (data ?? null) as Row | null;
  };
  const statusJson = async (id: string): Promise<Row | null> => {
    const { data } = await db.rpc("mastodon_thread", { p_status: id, p_viewer: me.id });
    return ((data as Row | null)?.status ?? null) as Row | null;
  };
  const before = async (): Promise<string | null> => {
    const maxId = url.searchParams.get("max_id");
    if (!maxId) return null;
    const { data } = await db.from("mastodon_statuses").select("published_at").eq("id", maxId).maybeSingle();
    return data?.published_at ?? null;
  };
  const timeline = async (kind: string, arg: string | null = null, withReplies = true) => {
    const { data, error } = await db.rpc("mastodon_timeline", { p_kind: kind, p_viewer: me.id, p_arg: arg, p_before: await before(), p_limit: limit, p_with_replies: withReplies });
    if (error) return fail(422, error.message);
    const rows = (data ?? []) as Row[];
    const headers: Record<string, string> = {};
    if (rows.length) {
      const next = new URL(`${base(instance)}${path}`);
      for (const [key, value] of url.searchParams) if (key !== "max_id") next.searchParams.set(key, value);
      next.searchParams.set("max_id", rows[rows.length - 1].id);
      headers.Link = `<${next.href}>; rel="next"`;
    }
    return json(rows.map((s) => apiStatus(instance, s)), 200, headers);
  };
  const statusAction = async (id: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error && !/duplicate key/.test(error.message)) return fail(422, error.message);
    const status = await statusJson(id);
    return status ? json(apiStatus(instance, status)) : notFound();
  };

  let match: RegExpExecArray | null;
  if (get && path === "/api/v1/accounts/verify_credentials") {
    const account = apiAccount(instance, await accountJson(me.id));
    return json({ ...account, source: { note: me.note ?? "", fields: me.fields ?? [], privacy: "public", sensitive: false, language: "", follow_requests_count: 0 } });
  }
  if (req.method === "PATCH" && path === "/api/v1/accounts/update_credentials") {
    const denied = need("write:accounts");
    if (denied) return denied;
    const patch: Row = {};
    if (input.display_name !== undefined) patch.display_name = String(input.display_name);
    if (input.note !== undefined) patch.note = String(input.note);
    if (input.locked !== undefined) patch.locked = truthy(input.locked);
    if (input.bot !== undefined) patch.bot = truthy(input.bot);
    if (input.discoverable !== undefined) patch.discoverable = truthy(input.discoverable);
    const { error } = await db.from("mastodon_accounts").update(patch).eq("id", me.id);
    if (error) return fail(422, error.message);
    return json(apiAccount(instance, await accountJson(me.id)));
  }
  if (get && path === "/api/v1/accounts/relationships") {
    const ids = url.searchParams.getAll("id[]").concat(url.searchParams.getAll("id"));
    const out = [];
    for (const id of ids) {
      const { data } = await db.rpc("mastodon_relationship", { p_viewer: me.id, p_target: id });
      out.push(data);
    }
    return json(out);
  }
  if (get && path === "/api/v1/accounts/lookup") {
    const { data: id } = await db.rpc("mastodon_find_account", { p_key: url.searchParams.get("acct") ?? "" });
    const account = id ? await accountJson(id as string) : null;
    return account ? json(apiAccount(instance, account)) : notFound();
  }
  if ((match = /^\/api\/v1\/accounts\/([0-9a-f-]{36})$/.exec(path)) && get) {
    const account = await accountJson(match[1]);
    return account ? json(apiAccount(instance, account)) : notFound();
  }
  if ((match = /^\/api\/v1\/accounts\/([0-9a-f-]{36})\/statuses$/.exec(path)) && get) {
    return await timeline("account", match[1], !truthy(url.searchParams.get("exclude_replies")));
  }
  if ((match = /^\/api\/v1\/accounts\/([0-9a-f-]{36})\/(follow|unfollow|block|unblock|mute|unmute)$/.exec(path)) && req.method === "POST") {
    const denied = need(/block/.test(match[2]) ? "write:blocks" : /mute/.test(match[2]) ? "write:mutes" : "write:follows");
    if (denied) return denied;
    const target = match[1];
    const result =
      match[2] === "follow"
        ? await db.from("mastodon_follows").upsert({ account_id: me.id, target_account_id: target, show_reblogs: input.reblogs === undefined ? true : truthy(input.reblogs), notify: truthy(input.notify) }, { onConflict: "account_id,target_account_id" })
        : match[2] === "unfollow"
          ? await db.from("mastodon_follows").delete().eq("account_id", me.id).eq("target_account_id", target)
          : match[2] === "block"
            ? await db.from("mastodon_blocks").insert({ account_id: me.id, target_account_id: target })
            : match[2] === "unblock"
              ? await db.from("mastodon_blocks").delete().eq("account_id", me.id).eq("target_account_id", target)
              : match[2] === "mute"
                ? await db.from("mastodon_mutes").insert({ account_id: me.id, target_account_id: target, hide_notifications: input.notifications === undefined ? true : truthy(input.notifications) })
                : await db.from("mastodon_mutes").delete().eq("account_id", me.id).eq("target_account_id", target);
    if (result.error && !/duplicate key/.test(result.error.message)) return fail(422, result.error.message);
    const { data } = await db.rpc("mastodon_relationship", { p_viewer: me.id, p_target: target });
    return json(data);
  }
  if (get && path === "/api/v1/timelines/home") return await timeline("home");
  if (get && path === "/api/v1/timelines/public") return await timeline(truthy(url.searchParams.get("local")) ? "local" : "federated", instance.id);
  if (get && (match = /^\/api\/v1\/timelines\/tag\/([^/]+)$/.exec(path))) return await timeline("tag", decodeURIComponent(match[1]));
  if (get && (match = /^\/api\/v1\/timelines\/list\/([0-9a-f-]{36})$/.exec(path))) return await timeline("list", match[1]);
  if (get && path === "/api/v1/favourites") return await timeline("favourites");
  if (get && path === "/api/v1/bookmarks") return await timeline("bookmarks");
  if (get && path === "/api/v1/notifications") {
    const maxId = url.searchParams.get("max_id");
    let p_before: string | null = null;
    if (maxId) p_before = (await db.from("mastodon_notifications").select("created_at").eq("id", maxId).maybeSingle()).data?.created_at ?? null;
    const types = url.searchParams.getAll("types[]");
    const { data } = await db.rpc("mastodon_notification_list", { p_viewer: me.id, p_before, p_limit: limit, p_types: types.length ? types : null });
    return json(((data ?? []) as Row[]).map((n) => ({ id: n.id, type: n.type, created_at: n.created_at, account: apiAccount(instance, n.account), status: apiStatus(instance, n.status) })));
  }
  if (req.method === "POST" && path === "/api/v1/notifications/clear") {
    await db.from("mastodon_notifications").delete().eq("account_id", me.id);
    return json({});
  }
  if (req.method === "POST" && path === "/api/v1/statuses") {
    const denied = need("write:statuses");
    if (denied) return denied;
    const poll = input.poll && Array.isArray((input.poll as Row).options)
      ? { options: (input.poll as Row).options, multiple: truthy((input.poll as Row).multiple), expires_in: Number((input.poll as Row).expires_in) || 86400 }
      : null;
    const { data, error } = await db.rpc("mastodon_post_status", {
      p_account: me.id,
      p_text: input.status ?? null,
      p_spoiler_text: input.spoiler_text ?? null,
      p_sensitive: truthy(input.sensitive),
      p_visibility: input.visibility ?? "public",
      p_language: input.language ?? null,
      p_in_reply_to: input.in_reply_to_id ?? null,
      p_media: "[]",
      p_poll: poll,
    });
    if (error) return fail(422, error.message);
    const status = await statusJson((data as Row).id);
    return json(apiStatus(instance, status));
  }
  if ((match = /^\/api\/v1\/statuses\/([0-9a-f-]{36})$/.exec(path))) {
    if (get) {
      const status = await statusJson(match[1]);
      return status ? json(apiStatus(instance, status)) : notFound();
    }
    if (req.method === "DELETE") {
      const denied = need("write:statuses");
      if (denied) return denied;
      const status = await statusJson(match[1]);
      const { error } = await db.from("mastodon_statuses").delete().eq("id", match[1]).eq("account_id", me.id);
      if (error) return fail(422, error.message);
      return status ? json({ ...apiStatus(instance, status), text: status.text ?? "" }) : notFound();
    }
    if (req.method === "PUT") {
      const denied = need("write:statuses");
      if (denied) return denied;
      const { error } = await db.from("mastodon_statuses").update({ text: input.status, spoiler_text: input.spoiler_text ?? "", sensitive: truthy(input.sensitive) }).eq("id", match[1]).eq("account_id", me.id);
      if (error) return fail(422, error.message);
      return json(apiStatus(instance, await statusJson(match[1])));
    }
  }
  if (get && (match = /^\/api\/v1\/statuses\/([0-9a-f-]{36})\/context$/.exec(path))) {
    const { data } = await db.rpc("mastodon_thread", { p_status: match[1], p_viewer: me.id });
    const thread = (data ?? {}) as Row;
    return json({ ancestors: ((thread.ancestors ?? []) as Row[]).map((s) => apiStatus(instance, s)), descendants: ((thread.descendants ?? []) as Row[]).map((s) => apiStatus(instance, s)) });
  }
  if ((match = /^\/api\/v1\/statuses\/([0-9a-f-]{36})\/(favourite|unfavourite|reblog|unreblog|bookmark|unbookmark)$/.exec(path)) && req.method === "POST") {
    const id = match[1];
    const denied = need(/bookmark/.test(match[2]) ? "write:bookmarks" : /favourite/.test(match[2]) ? "write:favourites" : "write:statuses");
    if (denied) return denied;
    switch (match[2]) {
      case "favourite":
        return await statusAction(id, () => db.from("mastodon_favourites").insert({ account_id: me.id, status_id: id }));
      case "unfavourite":
        return await statusAction(id, () => db.from("mastodon_favourites").delete().eq("account_id", me.id).eq("status_id", id));
      case "bookmark":
        return await statusAction(id, () => db.from("mastodon_bookmarks").insert({ account_id: me.id, status_id: id }));
      case "unbookmark":
        return await statusAction(id, () => db.from("mastodon_bookmarks").delete().eq("account_id", me.id).eq("status_id", id));
      case "reblog": {
        const { data, error } = await db.rpc("mastodon_post_status", { p_account: me.id, p_reblog_of: id, p_visibility: input.visibility ?? "public" });
        if (error && !/duplicate key/.test(error.message)) return fail(422, error.message);
        const boost = data ? await statusJson((data as Row).id) : null;
        return boost ? json(apiStatus(instance, boost)) : json(apiStatus(instance, await statusJson(id)));
      }
      case "unreblog":
        return await statusAction(id, () => db.from("mastodon_statuses").delete().eq("account_id", me.id).eq("reblog_of_id", id));
    }
  }
  if ((match = /^\/api\/v1\/polls\/([0-9a-f-]{36})\/votes$/.exec(path)) && req.method === "POST") {
    const denied = need("write:statuses");
    if (denied) return denied;
    const choices = ((input.choices ?? []) as unknown[]).map(Number).filter((n) => Number.isInteger(n));
    for (const choice of choices) {
      const { error } = await db.from("mastodon_poll_votes").insert({ poll_id: match[1], account_id: me.id, choice });
      if (error) return fail(422, error.message);
    }
    const { data: poll } = await db.from("mastodon_polls").select("status_id").eq("id", match[1]).maybeSingle();
    const status = poll ? await statusJson(poll.status_id) : null;
    return status?.poll ? json({ ...status.poll, emojis: [] }) : notFound();
  }
  if (get && (path === "/api/v2/search" || path === "/api/v1/search")) {
    const q = url.searchParams.get("q") ?? "";
    if (truthy(url.searchParams.get("resolve")) && (parseAcct(q) || /^https?:\/\//.test(q))) {
      await handleClient(new Request("https://local/client/resolve", { method: "POST", headers: { authorization: `Bearer ${caller.token}`, "content-type": "application/json" }, body: JSON.stringify({ q }) }), "/client/resolve").catch(() => null);
    }
    const { data } = await db.rpc("mastodon_search", { p_query: q, p_viewer: me.id, p_limit: limit });
    const result = (data ?? {}) as Row;
    return json({
      accounts: ((result.accounts ?? []) as Row[]).map((a) => apiAccount(instance, a)),
      statuses: ((result.statuses ?? []) as Row[]).map((s) => apiStatus(instance, s)),
      hashtags: ((result.hashtags ?? []) as Row[]).map((t) => ({ name: t.name, url: `${base(instance)}/tags/${t.name}`, history: [] })),
    });
  }
  if (get && path === "/api/v1/lists") {
    const { data } = await db.from("mastodon_lists").select("id, title, replies_policy, exclusive").eq("account_id", me.id).order("title");
    return json(data ?? []);
  }
  if (get && path === "/api/v1/follow_requests") {
    const { data } = await db.from("mastodon_follows").select("account_id").eq("target_account_id", me.id).eq("state", "pending");
    const out = [];
    for (const row of data ?? []) out.push(apiAccount(instance, await accountJson(row.account_id)));
    return json(out.filter(Boolean));
  }
  if ((match = /^\/api\/v1\/follow_requests\/([0-9a-f-]{36})\/(authorize|reject)$/.exec(path)) && req.method === "POST") {
    const denied = need("write:follows");
    if (denied) return denied;
    const query = db.from("mastodon_follows");
    const { error } = match[2] === "authorize"
      ? await query.update({ state: "accepted" }).eq("account_id", match[1]).eq("target_account_id", me.id)
      : await query.delete().eq("account_id", match[1]).eq("target_account_id", me.id);
    if (error) return fail(422, error.message);
    const { data } = await db.rpc("mastodon_relationship", { p_viewer: me.id, p_target: match[1] });
    return json(data);
  }
  if (get && (path === "/api/v1/filters" || path === "/api/v2/filters" || path === "/api/v1/conversations" || path === "/api/v1/featured_tags" || path === "/api/v1/followed_tags" || path === "/api/v1/endorsements" || path === "/api/v1/blocks" || path === "/api/v1/mutes" || path === "/api/v1/domain_blocks")) {
    return json([]);
  }
  if (get && path === "/api/v1/preferences") return json({ "posting:default:visibility": "public", "posting:default:sensitive": false, "posting:default:language": null, "reading:expand:media": "default", "reading:expand:spoilers": false });
  if (path === "/api/v1/markers") return json({});
  return notFound();
}

// ── Entry ─────────────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const path = (url.pathname.replace(/^.*?\/mastodon(?=\/|$)/, "") || "/").replace(/\/+$/, "") || "/";
  try {
    if (path === "/deliver") {
      const { data: config } = await admin.from("mastodon_function_config").select("secret").maybeSingle();
      const secretOk = config?.secret && req.headers.get("x-mastodon-secret") === config.secret;
      if (!secretOk && !(await callerFor(req))) return fail(401, "Not allowed");
      return json(await runDeliveries());
    }
    if (path.startsWith("/client/")) return await handleClient(req, path);

    const instance = await instanceFor(requestHost(req));
    if (!instance) return fail(404, "No Mastodon server on this domain");
    if (req.method === "POST" && (path === "/ap/inbox" || /^\/ap\/users\/[A-Za-z0-9_]+\/inbox$/.test(path) || path === "/ap/actor/inbox")) {
      return await handleInbox(req, `${url.pathname.slice(url.pathname.indexOf(path))}${url.search}`.replace(/^.*?(?=\/ap\/)/, ""), instance);
    }
    if (path.startsWith("/api/")) return await handleApi(req, path, url, instance);
    const found = await handlePublic(req, path, url, instance);
    if (found) return found;
    if (wantsActivityJson(req.headers.get("accept"))) return notFound();
    return notFound();
  } catch (error) {
    console.error("[mastodon]", path, error);
    return fail(500, (error as Error).message);
  }
});

