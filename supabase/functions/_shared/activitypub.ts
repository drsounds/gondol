// ActivityPub and Mastodon helpers shared by the mastodon edge function and the browser (gondol's
// built-in mastodon app imports the text helpers): HTTP signatures (draft-cavage, RSA-SHA256, as
// Mastodon signs), keys, and the text of statuses (a local status's text to HTML; remote HTML made
// safe, and to plain text). Only Web Crypto and plain string work: runs in Deno, Bun and browsers.

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────

const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toPem(der: ArrayBuffer, label: string): string {
  const body = toBase64(der).replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function pemBody(pem: string): { label: string; der: Uint8Array<ArrayBuffer> } {
  const match = /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/.exec(pem);
  if (!match) throw new Error("Not a PEM key");
  return { label: match[1], der: fromBase64(match[2].replace(/\s+/g, "")) };
}

/** DER length bytes. */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** Wraps a PKCS#1 RSAPublicKey in a SubjectPublicKeyInfo (some servers publish "RSA PUBLIC KEY"). */
function pkcs1ToSpki(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const bitString = [0x03, ...derLength(pkcs1.length + 1), 0x00, ...pkcs1];
  const body = [...algorithm, ...bitString];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

export interface KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

/** A new 2048-bit RSA key pair, as PEM (SPKI public, PKCS#8 private), as Mastodon uses. */
export async function generateKeyPair(): Promise<KeyPairPem> {
  const pair = (await crypto.subtle.generateKey(
    { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const [spki, pkcs8] = await Promise.all([
    crypto.subtle.exportKey("spki", pair.publicKey),
    crypto.subtle.exportKey("pkcs8", pair.privateKey),
  ]);
  return { publicKeyPem: toPem(spki, "PUBLIC KEY"), privateKeyPem: toPem(pkcs8, "PRIVATE KEY") };
}

export async function importPublicKey(pem: string): Promise<CryptoKey> {
  const { label, der } = pemBody(pem);
  const spki = label === "RSA PUBLIC KEY" ? pkcs1ToSpki(der) : der;
  return await crypto.subtle.importKey("spki", spki, RSA, false, ["verify"]);
}

export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const { label, der } = pemBody(pem);
  if (label !== "PRIVATE KEY") throw new Error("Expected a PKCS#8 private key");
  return await crypto.subtle.importKey("pkcs8", der, RSA, false, ["sign"]);
}

// ── HTTP signatures ───────────────────────────────────────────────────────────────────────────

export async function sha256Digest(body: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return `SHA-256=${toBase64(await crypto.subtle.digest("SHA-256", bytes))}`;
}

/** The string a signature covers: one `name: value` line per signed header. */
export function signingString(headerNames: string[], method: string, path: string, header: (name: string) => string | null): string {
  return headerNames
    .map((name) => {
      const key = name.toLowerCase();
      if (key === "(request-target)") return `(request-target): ${method.toLowerCase()} ${path}`;
      const value = header(key);
      if (value === null) throw new Error(`Signed header ${key} is missing`);
      return `${key}: ${value.trim()}`;
    })
    .join("\n");
}

/**
 * Headers for a signed request (Date, Host, Digest when there's a body, Signature), keyed by
 * `keyId` (the actor's `publicKey.id`).
 */
export async function signRequest(options: {
  method: string;
  url: string;
  body?: string;
  keyId: string;
  privateKeyPem: string;
  date?: Date;
}): Promise<Record<string, string>> {
  const url = new URL(options.url);
  const headers: Record<string, string> = {
    host: url.host,
    date: (options.date ?? new Date()).toUTCString(),
  };
  const names = ["(request-target)", "host", "date"];
  if (options.body !== undefined) {
    headers.digest = await sha256Digest(options.body);
    names.push("digest");
  }
  const text = signingString(names, options.method, `${url.pathname}${url.search}`, (name) => headers[name] ?? null);
  const key = await importPrivateKey(options.privateKeyPem);
  const signature = toBase64(await crypto.subtle.sign(RSA, key, new TextEncoder().encode(text)));
  headers.signature = `keyId="${options.keyId}",algorithm="rsa-sha256",headers="${names.join(" ")}",signature="${signature}"`;
  return headers;
}

export interface ParsedSignature {
  keyId: string;
  algorithm: string | null;
  headers: string[];
  signature: string;
}

export function parseSignatureHeader(value: string | null): ParsedSignature | null {
  if (!value) return null;
  const parts: Record<string, string> = {};
  for (const match of value.matchAll(/([a-zA-Z]+)="([^"]*)"/g)) parts[match[1]] = match[2];
  if (!parts.keyId || !parts.signature) return null;
  return {
    keyId: parts.keyId,
    algorithm: parts.algorithm ?? null,
    headers: (parts.headers ?? "date").split(/\s+/).filter(Boolean),
    signature: parts.signature,
  };
}

/**
 * Checks a request's signature with the sender's public key: the signed headers must include
 * (request-target) and host (or date), the date must be within twelve hours, and a body's digest
 * must match it.
 */
export async function verifySignature(options: {
  method: string;
  path: string;
  header: (name: string) => string | null;
  body?: string;
  signature: ParsedSignature;
  publicKeyPem: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { signature } = options;
  const names = signature.headers.map((name) => name.toLowerCase());
  if (!names.includes("(request-target)")) return { ok: false, reason: "(request-target) isn't signed" };
  if (options.method.toUpperCase() === "POST" && !names.includes("digest")) return { ok: false, reason: "The digest isn't signed" };
  const date = options.header("date");
  if (names.includes("date") && date) {
    const age = Math.abs((options.now ?? new Date()).getTime() - new Date(date).getTime());
    if (!Number.isFinite(age) || age > 12 * 3600_000) return { ok: false, reason: "The signature's date is too far off" };
  }
  if (options.body !== undefined && names.includes("digest")) {
    const sent = options.header("digest") ?? "";
    const digests = sent.split(",").map((part) => part.trim());
    const expected = await sha256Digest(options.body);
    if (!digests.some((d) => d.replace(/^sha-256=/i, "SHA-256=") === expected)) return { ok: false, reason: "The digest doesn't match the body" };
  }
  let text: string;
  try {
    text = signingString(names, options.method, options.path, options.header);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  try {
    const key = await importPublicKey(options.publicKeyPem);
    const ok = await crypto.subtle.verify(RSA, key, fromBase64(signature.signature), new TextEncoder().encode(text));
    return ok ? { ok: true } : { ok: false, reason: "The signature doesn't match" };
  } catch (error) {
    return { ok: false, reason: `Can't check the signature: ${(error as Error).message}` };
  }
}

// ── Status text ───────────────────────────────────────────────────────────────────────────────

export type TextToken =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | { kind: "link"; href: string; text: string }
  | { kind: "mention"; username: string; domain: string | null; text: string }
  | { kind: "hashtag"; name: string; text: string };

const TOKEN_PATTERN =
  /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])|(?:^|(?<=[^\p{L}\p{N}_@/]))@([A-Za-z0-9_]+)(?:@([A-Za-z0-9.-]+\.[A-Za-z]{2,}))?|(?:^|(?<=[^\p{L}\p{N}_&/#]))#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)|(\n)/gu;

/** A local status's text (or a bio) in pieces: plain text, line breaks, links, @mentions and #hashtags. */
export function tokenizeStatusText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let last = 0;
  const push = (value: string) => {
    if (value) tokens.push({ kind: "text", text: value });
  };
  for (const match of text.replace(/\r\n?/g, "\n").matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    push(text.slice(last, index));
    last = index + match[0].length;
    if (match[1]) tokens.push({ kind: "link", href: match[1], text: match[1] });
    else if (match[2]) tokens.push({ kind: "mention", username: match[2], domain: match[3]?.toLowerCase() ?? null, text: match[0] });
    else if (match[4]) tokens.push({ kind: "hashtag", name: match[4], text: match[0] });
    else if (match[5]) tokens.push({ kind: "break" });
  }
  push(text.slice(last));
  return tokens;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * A local status's text as the HTML Mastodon sends: paragraphs at blank lines, <br> for single line
 * breaks, links, and @mentions and #hashtags linked where `mentionUrl`/`tagUrl` know them.
 */
export function statusTextToHtml(
  text: string,
  options: { mentionUrl?: (username: string, domain: string | null) => string | null; tagUrl?: (name: string) => string | null } = {},
): string {
  const paragraphs = text.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  return paragraphs
    .map((paragraph) => {
      const html = tokenizeStatusText(paragraph)
        .map((token) => {
          switch (token.kind) {
            case "text":
              return escapeHtml(token.text);
            case "break":
              return "<br>";
            case "link": {
              const display = token.href.replace(/^https?:\/\/(www\.)?/, "");
              return `<a href="${escapeHtml(token.href)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(display.length > 40 ? `${display.slice(0, 40)}…` : display)}</a>`;
            }
            case "mention": {
              const url = options.mentionUrl?.(token.username, token.domain);
              const lead = token.text.slice(0, token.text.indexOf("@"));
              return url
                ? `${escapeHtml(lead)}<span class="h-card"><a href="${escapeHtml(url)}" class="u-url mention">@<span>${escapeHtml(token.username)}</span></a></span>`
                : escapeHtml(token.text);
            }
            case "hashtag": {
              const url = options.tagUrl?.(token.name);
              const lead = token.text.slice(0, token.text.indexOf("#"));
              return url
                ? `${escapeHtml(lead)}<a href="${escapeHtml(url)}" class="mention hashtag" rel="tag">#<span>${escapeHtml(token.name)}</span></a>`
                : escapeHtml(token.text);
            }
          }
        })
        .join("");
      return `<p>${html}</p>`;
    })
    .join("");
}

const ALLOWED_TAGS = new Set(["p", "br", "a", "span", "strong", "b", "em", "i", "u", "del", "s", "code", "pre", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math", "head", "title"]);
const ALLOWED_CLASSES = /^(h-card|u-url|mention|hashtag|ellipsis|invisible|quote-inline)$/;

function safeHref(value: string): string | null {
  const href = value.trim();
  return /^(https?:|mailto:|xmpp:|gopher:|gemini:|magnet:|ipfs:|dat:)/i.test(href) ? href : null;
}

function attributes(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of source.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    map.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return map;
}

/**
 * Remote HTML made safe the way Mastodon does: only text formatting, paragraphs, lists, quotes,
 * code and links (http(s) and a few other schemes, opened with rel="nofollow noopener noreferrer"),
 * and only Mastodon's microformat classes. Everything else is dropped; scripts and styles with
 * their content.
 */
export function sanitizeHtml(html: string): string {
  let out = "";
  let dropping: string | null = null;
  let dropDepth = 0;
  const open: string[] = [];
  const pattern = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)\s*(\/?)>|<|[^<]+/g;
  for (const match of html.matchAll(pattern)) {
    const token = match[0];
    if (token.startsWith("<!--")) continue;
    const name = match[1]?.toLowerCase();
    if (!name) {
      if (dropping) continue;
      out += token === "<" ? "&lt;" : token.replace(/>/g, "&gt;");
      continue;
    }
    const closing = token.startsWith("</");
    if (dropping) {
      if (name === dropping) dropDepth += closing ? -1 : 1;
      if (dropDepth <= 0) dropping = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !match[3]) {
        dropping = name;
        dropDepth = 1;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    if (name === "br") {
      out += "<br>";
      continue;
    }
    const attrs = attributes(match[2] ?? "");
    let rendered = `<${name}`;
    const classes = (attrs.get("class") ?? "").split(/\s+/).filter((c) => ALLOWED_CLASSES.test(c));
    if (name === "a") {
      const href = safeHref(attrs.get("href") ?? "");
      if (href) rendered += ` href="${escapeHtml(href)}" rel="nofollow noopener noreferrer" target="_blank"`;
    }
    if (classes.length && (name === "a" || name === "span")) rendered += ` class="${classes.join(" ")}"`;
    out += `${rendered}>`;
    if (!match[3]) open.push(name);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** HTML as plain text: line breaks for <br> and paragraphs, tags gone, entities decoded. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|blockquote|h[1-6])>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Addresses ─────────────────────────────────────────────────────────────────────────────────

/** `user@domain` from `@user@domain`, `user@domain` or `acct:user@domain`; null when it isn't one. */
export function parseAcct(value: string): { username: string; domain: string } | null {
  const match = /^(?:acct:)?@?([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d+)?)$/.exec(value.trim());
  return match ? { username: match[1], domain: match[2].toLowerCase() } : null;
}

export const ACTIVITY_STREAMS = "https://www.w3.org/ns/activitystreams";
export const PUBLIC_COLLECTION = `${ACTIVITY_STREAMS}#Public`;
export const AP_CONTENT_TYPE = 'application/activity+json; charset=utf-8';

/** Whether a request asks for ActivityPub JSON rather than a web page. */
export function wantsActivityJson(accept: string | null): boolean {
  return /application\/(activity\+json|ld\+json)/i.test(accept ?? "");
}
