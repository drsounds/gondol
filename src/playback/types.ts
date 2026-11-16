import { defineServiceAspect, type Service } from "../services/service";
import { isrcOf, parseMusikUri } from "./musikUri";

/**
 * The playback aspects, ported from Bungalow (`MediaService`, `MusicService`, `AuthAspect`) and the
 * vendor-neutral play intent (`PlayRequest`, `ServiceMatch`). A service opts into each by listing
 * its id in `aspects` and implementing the interface.
 */

export type PlaybackState = "idle" | "loading" | "playing" | "paused" | "stopped" | "error";

/** What a media service tells its listeners (Bungalow's PlaybackListener). */
export interface PlaybackListener {
  onStateChanged?(state: PlaybackState): void;
  onPositionChanged?(positionMs: number, durationMs: number): void;
  onTrackChanged?(track: TrackInfo): void;
  onError?(error: Error): void;
  /** The current item reached its natural end. */
  onCompleted?(): void;
}

/** What is playing, as the service knows it. */
export interface TrackInfo {
  title: string;
  artist?: string;
  album?: string;
  imageUrl?: string;
}

/**
 * Where a service shows its player: it mounts into `container` once (an element the shell keeps
 * for the service's life and moves between the menu's dock and Now playing by positioning it, so
 * an iframe inside never reloads) and returns its cleanup.
 */
export interface PlayerSurface {
  mount(container: HTMLElement): () => void;
  /** Width / height of what it shows (16 / 9 for video); the dock and stage keep it. */
  aspectRatio?: number;
}

/** Streaming and playback (`media`): play, pause, seek, load a URI, events, an optional player. */
export interface MediaService extends Service {
  addPlaybackListener(listener: PlaybackListener): () => void;
  play(): void;
  pause(): void;
  stop(): void;
  seek(positionMs: number): void;
  /** Loads a URI this service plays as it is (its schemes and web hosts, or a candidate's `uri`). */
  loadUri(uri: string): void;
  /** Whether it plays `uri` as it is, without resolving (its schemes and hosts). */
  canPlayUri?(uri: string): boolean;
  /** 0–1. */
  setVolume?(volume: number): void;
  getPlaybackState(): PlaybackState;
  getPositionMs(): number;
  getDurationMs(): number;
  /** Its player, for the service dock and Now playing; none for audio without a picture. */
  getPlayerSurface?(): PlayerSurface | null;
}

/** One concrete thing a music service can play for a request (a "Play with…" candidate). */
export interface Candidate {
  /** Plays exactly this (`loadUri`); without it the service loads by ISRC or by title and artist. */
  uri?: string;
  title: string;
  artist?: string;
  /** Matched on the ISRC rather than on title and artist. */
  byIsrc: boolean;
  imageUrl?: string;
  durationMs?: number;
}

/** Resolving music (`music`): finds what it can play for a request, and loads it. */
export interface MusicService extends MediaService {
  /** Candidates for the request, for the chooser; [] when it can't play it. Network lookups are fine. */
  findCandidates(request: PlayRequest): Promise<Candidate[]>;
  loadByIsrc?(isrc: string): void;
  loadByTitleArtist?(title: string, artist?: string): void;
}

/** An account a service is signed in with. */
export interface ServiceAccount {
  /** The external_service_accounts row, when there is one. */
  id?: string;
  name: string;
  externalId?: string;
  imageUrl?: string;
}

/** What `login` gets from the shell: where to go to show a sign-in sheet of the app's own. */
export interface LoginContext {
  navigate: (path: string) => void;
}

/** Signing in (`auth`): implemented by services that need an account. */
export interface AuthAspect extends Service {
  isAuthenticated(): boolean;
  getAccount(): ServiceAccount | null;
  /** Shows whatever sign-in the service needs; resolves when signed in (rejects on failure). */
  login(context: LoginContext): Promise<void> | void;
  logout(): Promise<void> | void;
}

/** Searching a catalogue (`catalogue`): discovery without playing anything. */
export interface CatalogueService extends Service {
  search(query: string): Promise<Candidate[]>;
}

export const mediaAspect = defineServiceAspect<MediaService>("media");
export const musicAspect = defineServiceAspect<MusicService>("music");
export const authAspect = defineServiceAspect<AuthAspect>("auth");
export const catalogueAspect = defineServiceAspect<CatalogueService>("catalogue");

/**
 * A vendor-neutral request to play one item (Bungalow's PlayRequest): what is known about it, to
 * resolve it across services, and the URI it came from.
 */
export interface PlayRequest {
  /** The URI it came from (musik:, a web link, an entity URI), also the queue's now-playing key. */
  uri: string;
  isrc?: string;
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  imageUrl?: string;
}

/** The stable identity a saved "Play with…" choice is kept under: the ISRC, else the URI. */
export function requestKey(request: PlayRequest): string {
  if (request.isrc) return `isrc:${request.isrc}`;
  if (request.uri) return request.uri;
  return `ta:${request.title}|${request.artist ?? ""}`;
}

/** The request for a playable musik: URI (an ISRC or a recording by name), else null. */
export function musikPlayRequest(uri: string): PlayRequest | null {
  const m = parseMusikUri(uri);
  if (!m) return null;
  if (m.kind === "isrc") return { uri, isrc: isrcOf(uri) ?? m.id, title: "" };
  if (m.kind === "recording") return { uri, title: m.name ?? "", artist: m.artist, album: m.release };
  // Works, releases, artists and facets aren't one playable item.
  return null;
}

/** One service's candidate in the "Play with…" chooser (Bungalow's ServiceMatch). */
export interface ServiceMatch {
  serviceId: string;
  serviceName: string;
  iconName?: string;
  candidate: Candidate;
}
