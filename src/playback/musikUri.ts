/**
 * The `musik:` URI scheme, ported from Bungalow (`MusikUri`, RFC-0002): a portable, service-agnostic
 * name for a piece of music. It carries identity, not a vendor target, so the same URI plays on
 * whatever services this installation has (playback/coordinator.ts resolves it at play time).
 *
 * Identifier forms (preferred):
 *
 *     musik:isrc:<ISRC>   a recording        musik:iswc:<ISWC>  a work
 *     musik:upc:<UPC>     a release          musik:isni:<ISNI>  an artist
 *     musik:ipi:<IPI>     a creator          musik:genre:<slug> / musik:mood:<slug>  facets
 *
 * Name form (free text percent-encoded):
 *
 *     musik:artist:<artist>[:release:<release>[[:track:<0-99>]:name:<name>[:version:<version>]]]
 *
 * Query form (a recording, when no release is known):
 *
 *     musik:track?name=<name>&artist_name=<artist>&release_name=<release>&number=<0-99>&version=<v>
 *
 * The legacy content URI `spacify:recording:isrc:<ISRC>` is read as `musik:isrc:<ISRC>`.
 */

export const MUSIK_SCHEME = "musik:";
/** Legacy recording content URI, equivalent to `musik:isrc:` (RFC-0002 §9). */
export const LEGACY_ISRC_PREFIX = "spacify:recording:isrc:";

export type MusikKind = "isrc" | "iswc" | "upc" | "isni" | "ipi" | "genre" | "mood" | "artist" | "release" | "recording";

export interface MusikUri {
  kind: MusikKind;
  /** The identifier, for the id forms. */
  id?: string;
  artist?: string;
  release?: string;
  /** The recording's name, for the name and query forms. */
  name?: string;
  version?: string;
  /** 1–99, or 0 when not given. */
  trackNumber: number;
}

const ID_KINDS = new Set<MusikKind>(["isrc", "iswc", "upc", "isni", "ipi"]);

/** Strips separators and white space from a standard identifier and upper-cases it. */
export function normalizeMusikId(id: string): string {
  return id.replace(/[\s-]/g, "").toUpperCase();
}

/** A facet label as a lower-case, hyphenated slug (RFC-0002 §4.2). */
export function musikSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clampTrack(n: number): number {
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : 0;
}

function trackNumber(value: string): number {
  const n = Number.parseInt(value.trim(), 10);
  return Number.isNaN(n) ? 0 : clampTrack(n);
}

/** Percent-encodes free text, `%20` for a space (RFC-0002 §4.1). */
function enc(text: string | undefined): string {
  return encodeURIComponent(text ?? "").replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Decodes a path segment, keeping a literal `+`. */
function pctDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Decodes an x-www-form-urlencoded value (`+` is a space). */
function formDecode(value: string): string {
  return pctDecode(value.replace(/\+/g, " "));
}

/** Whether `uri` is a `musik:` URI or the legacy recording content URI. */
export function isMusikUri(uri: string | null | undefined): uri is string {
  if (!uri) return false;
  const s = uri.trim();
  return s.toLowerCase().startsWith(MUSIK_SCHEME) || s.startsWith(LEGACY_ISRC_PREFIX);
}

/** Parses a `musik:` URI (or the legacy form) into a typed value, or null when it isn't one. */
export function parseMusikUri(uri: string | null | undefined): MusikUri | null {
  if (!uri) return null;
  const s = uri.trim();
  if (s.startsWith(LEGACY_ISRC_PREFIX)) {
    const id = normalizeMusikId(s.slice(LEGACY_ISRC_PREFIX.length));
    return id ? { kind: "isrc", id, trackNumber: 0 } : null;
  }
  if (!s.toLowerCase().startsWith(MUSIK_SCHEME)) return null;
  const rest = s.slice(MUSIK_SCHEME.length);
  if (!rest) return null;
  if (rest.toLowerCase().startsWith("track?")) return parseQuery(rest.slice("track?".length));
  if (rest.toLowerCase().startsWith("artist:")) return parseName(rest);
  return parseIdForm(rest);
}

function parseIdForm(rest: string): MusikUri | null {
  const colon = rest.indexOf(":");
  if (colon <= 0 || colon === rest.length - 1) return null;
  const key = rest.slice(0, colon).toLowerCase() as MusikKind;
  const raw = rest.slice(colon + 1);
  if (ID_KINDS.has(key)) {
    const id = normalizeMusikId(raw);
    return id ? { kind: key, id, trackNumber: 0 } : null;
  }
  if (key === "genre" || key === "mood") return { kind: key, id: pctDecode(raw), trackNumber: 0 };
  return null;
}

function parseName(rest: string): MusikUri | null {
  const segs = rest.split(":");
  if (segs.length < 2 || !segs[1]) return null;
  const artist = pctDecode(segs[1]);
  let release: string | undefined;
  let name: string | undefined;
  let version: string | undefined;
  let number = 0;
  for (let i = 2; i + 1 < segs.length; i += 2) {
    const value = segs[i + 1];
    switch (segs[i].toLowerCase()) {
      case "release":
        release = pctDecode(value);
        break;
      case "track":
        number = trackNumber(value);
        break;
      case "name":
        name = pctDecode(value);
        break;
      case "version":
        version = pctDecode(value);
        break;
      default:
        // Unknown segments are skipped (forward compatible).
        break;
    }
  }
  if (name !== undefined) return musikRecording({ artist, release, trackNumber: number, name, version });
  if (release !== undefined) return { kind: "release", artist, release, trackNumber: 0 };
  return { kind: "artist", artist, trackNumber: 0 };
}

function parseQuery(query: string): MusikUri | null {
  let artist: string | undefined;
  let release: string | undefined;
  let name: string | undefined;
  let version: string | undefined;
  let number = 0;
  for (const param of query.split("&")) {
    const eq = param.indexOf("=");
    if (eq < 0) continue;
    const value = formDecode(param.slice(eq + 1));
    switch (param.slice(0, eq).toLowerCase()) {
      case "name":
        name = value;
        break;
      case "artist_name":
        artist = value;
        break;
      case "release_name":
        release = value;
        break;
      case "number":
        number = trackNumber(value);
        break;
      case "version":
        version = value;
        break;
      default:
        break;
    }
  }
  // The name is required (RFC-0002 §7).
  if (!name) return null;
  return musikRecording({ artist, release, trackNumber: number, name, version });
}

/** A recording by name coordinates; without a release it renders in the query form. */
export function musikRecording(parts: { name: string; artist?: string; release?: string; trackNumber?: number; version?: string }): MusikUri {
  return {
    kind: "recording",
    name: parts.name,
    artist: parts.artist || undefined,
    release: parts.release || undefined,
    version: parts.version || undefined,
    trackNumber: clampTrack(parts.trackNumber ?? 0),
  };
}

/** Renders a typed value back to its URI (round-trips parseMusikUri). */
export function formatMusikUri(m: MusikUri): string {
  switch (m.kind) {
    case "isrc":
    case "iswc":
    case "upc":
    case "isni":
    case "ipi":
      return `${MUSIK_SCHEME}${m.kind}:${normalizeMusikId(m.id ?? "")}`;
    case "genre":
    case "mood":
      return `${MUSIK_SCHEME}${m.kind}:${enc(musikSlug(m.id ?? ""))}`;
    case "artist":
      return `${MUSIK_SCHEME}artist:${enc(m.artist)}`;
    case "release":
      return `${MUSIK_SCHEME}artist:${enc(m.artist)}:release:${enc(m.release)}`;
    case "recording": {
      // The grammar nests a name under a release; without one it's the query form.
      if (!m.release || !m.artist) return musikQueryUri(m);
      let uri = `${MUSIK_SCHEME}artist:${enc(m.artist)}:release:${enc(m.release)}`;
      if (m.trackNumber > 0) uri += `:track:${m.trackNumber}`;
      uri += `:name:${enc(m.name)}`;
      if (m.version) uri += `:version:${enc(m.version)}`;
      return uri;
    }
  }
}

/** The `musik:track?…` form of a recording (RFC-0002 §7). */
export function musikQueryUri(m: MusikUri): string {
  let uri = `${MUSIK_SCHEME}track?name=${enc(m.name)}`;
  if (m.artist) uri += `&artist_name=${enc(m.artist)}`;
  if (m.release) uri += `&release_name=${enc(m.release)}`;
  if (m.trackNumber > 0) uri += `&number=${m.trackNumber}`;
  if (m.version) uri += `&version=${enc(m.version)}`;
  return uri;
}

/** The ISRC a recording URI names, or null. */
export function isrcOf(uri: string): string | null {
  const m = parseMusikUri(uri);
  return m?.kind === "isrc" ? (m.id ?? null) : null;
}

/** Whether the URI names one playable recording (an ISRC, or a recording by name). */
export function isPlayableMusikUri(uri: string): boolean {
  const kind = parseMusikUri(uri)?.kind;
  return kind === "isrc" || kind === "recording";
}

/** A human label: "Name — Artist", "Release — Artist", "Artist", "ISRC …", "Genre: …". */
export function musikLabel(uri: string): string | null {
  const m = parseMusikUri(uri);
  if (!m) return null;
  switch (m.kind) {
    case "recording":
      return [m.version ? `${m.name} (${m.version})` : m.name, m.artist].filter(Boolean).join(" — ");
    case "release":
      return [m.release, m.artist].filter(Boolean).join(" — ");
    case "artist":
      return m.artist ?? null;
    case "genre":
    case "mood":
      return m.id ?? null;
    default:
      return `${m.kind.toUpperCase()} ${m.id}`;
  }
}
