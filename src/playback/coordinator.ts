import { hasAspect, serviceManager as defaultServiceManager, type Service, type ServiceManager } from "../services/service";
import { isMusikUri } from "./musikUri";
import {
  mediaAspect,
  musicAspect,
  musikPlayRequest,
  requestKey,
  type Candidate,
  type MediaService,
  type MusicService,
  type PlayRequest,
  type PlaybackState,
  type ServiceMatch,
  type TrackInfo,
} from "./types";

/**
 * The playback coordinator, ported from Bungalow (`PlaybackCoordinator`, `PlayQueue`,
 * `ResolutionStore`): the listening layer, apart from *which service plays the bytes*.
 *
 * The queue holds vendor-neutral requests; each is resolved to a service when it plays:
 *
 * 1. a URI some media service plays as it is (its `schemes` and web `hosts`: a YouTube link) plays
 *    there,
 * 2. otherwise (a `musik:` URI, or an entity the host turns into a request) a saved "Play with…"
 *    choice for the request plays straight away,
 * 3. otherwise every music service is asked for candidates (`findCandidates`), and the user picks
 *    one in the chooser, optionally "always" (saved in the resolution store). When the queue moves
 *    on by itself, the first candidate plays without asking.
 *
 * Whichever service played last is the active one: its events drive the snapshot, and its player
 * surface is what the service dock and Now playing show.
 */

export type RepeatMode = "off" | "all" | "one";

export interface QueueItem {
  /** Unique in the queue. */
  key: string;
  request: PlayRequest;
}

/** A pending "Play with…" choice; the chooser answers it. */
export interface ChoiceRequest {
  request: PlayRequest;
  matches: ServiceMatch[];
  /** The match saved for it, if any (the chooser was forced open). */
  current?: SavedResolution | null;
  answer: (choice: { match: ServiceMatch; always: boolean } | null) => void;
}

/** A saved "Play with…" choice (Bungalow's MusicServiceTrack). */
export interface SavedResolution {
  serviceId: string;
  uri?: string;
  title?: string;
  artist?: string;
  byIsrc: boolean;
}

/** Where saved choices live (the player app keeps them in `playback_resolutions`). */
export interface ResolutionStore {
  find(key: string): Promise<SavedResolution | null>;
  save(key: string, resolution: SavedResolution): Promise<void>;
  remove?(key: string): Promise<void>;
}

/** What is playing from: the playlist, release, … the queue was started from. */
export interface PlaybackContext {
  label: string;
  uri?: string;
  path?: string;
}

export interface PlaybackSnapshot {
  queue: QueueItem[];
  /** The playing item's place in `queue`, or -1. */
  index: number;
  current: QueueItem | null;
  state: PlaybackState;
  positionMs: number;
  durationMs: number;
  /** What the active service says is playing (its title can be better than the request's). */
  track: TrackInfo | null;
  activeServiceId: string | null;
  /** The URI the active service is playing (a candidate's, or the item's own). */
  playingUri: string | null;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  context: PlaybackContext | null;
  /** Looking for something to play the current item with. */
  resolving: boolean;
  error: string | null;
  choice: ChoiceRequest | null;
}

/** Turns a URI the coordinator doesn't know (an entity's) into a request; null when it can't play. */
export type RequestResolver = (uri: string) => Promise<PlayRequest | null> | PlayRequest | null;

const VOLUME_KEY = "gondol:playback:volume";

function readVolume(): number {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(VOLUME_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.8;
  } catch {
    return 0.8;
  }
}

let keySeq = 0;
const nextKey = () => `q${++keySeq}`;

/** An in-memory resolution store (tests; the player app replaces it with the database's). */
export function memoryResolutionStore(): ResolutionStore {
  const saved = new Map<string, SavedResolution>();
  return {
    find: async (key) => saved.get(key) ?? null,
    save: async (key, resolution) => {
      saved.set(key, resolution);
    },
    remove: async (key) => {
      saved.delete(key);
    },
  };
}

export class PlaybackCoordinator {
  private snapshot: PlaybackSnapshot;
  private listeners = new Set<() => void>();
  private store: ResolutionStore = memoryResolutionStore();
  private resolvers: RequestResolver[] = [];
  private active: MediaService | null = null;
  private unlisten: (() => void) | null = null;
  /** Bumped on every play, so a slow lookup for an older one never starts playing. */
  private generation = 0;
  /** Shuffled order of queue indexes, while shuffle is on. */
  private order: number[] = [];

  constructor(private services: ServiceManager = defaultServiceManager) {
    this.snapshot = {
      queue: [],
      index: -1,
      current: null,
      state: "idle",
      positionMs: 0,
      durationMs: 0,
      track: null,
      activeServiceId: null,
      playingUri: null,
      volume: readVolume(),
      muted: false,
      shuffle: false,
      repeat: "off",
      context: null,
      resolving: false,
      error: null,
      choice: null,
    };
    // A service that goes away (its app switched off) stops being the active one.
    services.subscribe(() => {
      if (this.active && !services.has(this.active.id)) this.setActive(null);
    });
  }

  // ---- store -------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PlaybackSnapshot => this.snapshot;

  private set(patch: Partial<PlaybackSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    next.current = next.index >= 0 ? (next.queue[next.index] ?? null) : null;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }

  setResolutionStore(store: ResolutionStore): void {
    this.store = store;
  }

  /** Adds a way to turn URIs into requests (the host's entities); returns its removal. */
  addRequestResolver(resolver: RequestResolver): () => void {
    this.resolvers.push(resolver);
    return () => {
      this.resolvers = this.resolvers.filter((r) => r !== resolver);
    };
  }

  // ---- what can play ---------------------------------------------------------------------

  private mediaServices(): MediaService[] {
    return this.services.getServices(mediaAspect);
  }

  private musicServices(): MusicService[] {
    return this.services.getServices(musicAspect);
  }

  /** The media service that plays `uri` as it is, if any. */
  directServiceFor(uri: string): MediaService | null {
    return this.mediaServices().find((service) => service.canPlayUri?.(uri)) ?? null;
  }

  /**
   * Whether `uri` plays here as far as can be told without asking: a musik: recording (with a music
   * service on), or a link a service plays as it is. Entities the host resolves are only known by
   * trying (requestFor).
   */
  canPlay(uri: string): boolean {
    if (isMusikUri(uri)) return !!musikPlayRequest(uri) && this.musicServices().length > 0;
    return !!this.directServiceFor(uri);
  }

  /** The request for `uri`: musik: by its identity, else the host's resolvers, else the URI itself. */
  async requestFor(uri: string, title?: string): Promise<PlayRequest | null> {
    const musik = musikPlayRequest(uri);
    if (musik) return title && !musik.title ? { ...musik, title } : musik;
    if (this.directServiceFor(uri)) return { uri, title: title ?? "" };
    for (const resolve of this.resolvers) {
      try {
        const request = await resolve(uri);
        if (request) return title && !request.title ? { ...request, title } : request;
      } catch {
        // The next resolver may know it.
      }
    }
    return null;
  }

  /** Asks every music service for candidates (Bungalow's gatherMatches), in service order. */
  async gatherMatches(request: PlayRequest): Promise<ServiceMatch[]> {
    const services = this.musicServices();
    const found = await Promise.all(
      services.map(async (service) => {
        try {
          const candidates = await service.findCandidates(request);
          return candidates.map<ServiceMatch>((candidate) => ({ serviceId: service.id, serviceName: service.name, iconName: service.iconName, candidate }));
        } catch (error) {
          console.warn(`gondol: ${service.name} couldn't look up`, request, error);
          return [];
        }
      }),
    );
    return found.flat();
  }

  // ---- the queue --------------------------------------------------------------------------

  /** Replaces the queue with `requests` and plays `startIndex` (a user's play: may ask "Play with…"). */
  async playQueue(requests: PlayRequest[], startIndex = 0, context: PlaybackContext | null = null): Promise<void> {
    const queue = requests.map((request) => ({ key: nextKey(), request }));
    this.order = [];
    this.set({ queue, index: -1, context, error: null });
    if (this.snapshot.shuffle) this.reshuffle(startIndex);
    await this.playAt(startIndex, { interactive: true });
  }

  /** Plays one URI on its own (a queue of one). */
  async playUri(uri: string, title?: string, context: PlaybackContext | null = null): Promise<boolean> {
    const request = await this.requestFor(uri, title);
    if (!request) {
      this.set({ error: "unplayable" });
      return false;
    }
    await this.playQueue([request], 0, context);
    return true;
  }

  /** Adds requests after the current item ("Play next") or at the end. */
  enqueue(requests: PlayRequest[], next = false): void {
    const items = requests.map((request) => ({ key: nextKey(), request }));
    const queue = [...this.snapshot.queue];
    const at = next && this.snapshot.index >= 0 ? this.snapshot.index + 1 : queue.length;
    queue.splice(at, 0, ...items);
    this.order = [];
    this.set({ queue });
    if (this.snapshot.shuffle) this.reshuffle(this.snapshot.index);
  }

  /** Removes a queue item (not the playing one). */
  removeFromQueue(key: string): void {
    const at = this.snapshot.queue.findIndex((item) => item.key === key);
    if (at < 0 || at === this.snapshot.index) return;
    const queue = this.snapshot.queue.filter((item) => item.key !== key);
    const index = at < this.snapshot.index ? this.snapshot.index - 1 : this.snapshot.index;
    this.order = [];
    this.set({ queue, index });
    if (this.snapshot.shuffle) this.reshuffle(index);
  }

  /** Plays the queue's item at `index`. `force` opens the chooser even when a choice is saved. */
  async playAt(index: number, options: { interactive?: boolean; force?: boolean } = {}): Promise<void> {
    const item = this.snapshot.queue[index];
    if (!item) return;
    const generation = ++this.generation;
    this.set({ index, positionMs: 0, durationMs: item.request.durationMs ?? 0, track: null, error: null, resolving: true, choice: null });
    const playing = await this.resolveAndPlay(item.request, { ...options, generation });
    if (generation !== this.generation) return;
    this.set({ resolving: false });
    if (!playing && !options.interactive) {
      // Moving on by itself: skip what can't play, unless that's everything.
      if (this.snapshot.error === "unplayable") this.advance(true);
    }
  }

  /** Re-opens the chooser for the playing item ("Play with…"). */
  playWith(index = this.snapshot.index): Promise<void> {
    return this.playAt(index, { interactive: true, force: true });
  }

  private async resolveAndPlay(request: PlayRequest, options: { interactive?: boolean; force?: boolean; generation: number }): Promise<boolean> {
    const stale = () => options.generation !== this.generation;
    // 1. A URI a service plays as it is.
    const direct = this.directServiceFor(request.uri);
    if (direct && !options.force) {
      this.start(direct, { uri: request.uri, title: request.title, byIsrc: false });
      return true;
    }
    const key = requestKey(request);
    // 2. A saved "Play with…" choice.
    const saved = await this.store.find(key).catch(() => null);
    if (stale()) return false;
    if (saved && !options.force) {
      const service = this.musicServices().find((s) => s.id === saved.serviceId);
      if (service) {
        this.start(service, { uri: saved.uri, title: saved.title ?? request.title, artist: saved.artist, byIsrc: saved.byIsrc }, request);
        return true;
      }
    }
    // 3. Every music service's candidates.
    const matches = await this.gatherMatches(request);
    if (stale()) return false;
    if (matches.length === 0) {
      if (direct) {
        this.start(direct, { uri: request.uri, title: request.title, byIsrc: false });
        return true;
      }
      this.set({ error: "unplayable", state: "idle" });
      return false;
    }
    if (!options.interactive) {
      this.start(this.serviceFor(matches[0])!, matches[0].candidate, request);
      return true;
    }
    const choice = await new Promise<{ match: ServiceMatch; always: boolean } | null>((resolve) => {
      this.set({ choice: { request, matches, current: saved, answer: resolve } });
    });
    if (stale()) return false;
    this.set({ choice: null });
    if (!choice) {
      this.set({ state: this.active ? this.snapshot.state : "idle" });
      return false;
    }
    const service = this.serviceFor(choice.match);
    if (!service) return false;
    if (choice.always) {
      const { candidate } = choice.match;
      await this.store
        .save(key, { serviceId: service.id, uri: candidate.uri, title: candidate.title, artist: candidate.artist, byIsrc: candidate.byIsrc })
        .catch((error) => console.warn("gondol: couldn't save the choice", error));
    }
    this.start(service, choice.match.candidate, request);
    return true;
  }

  private serviceFor(match: ServiceMatch): MusicService | undefined {
    return this.musicServices().find((service) => service.id === match.serviceId);
  }

  /** Makes `service` the active one and loads the candidate on it. */
  private start(service: MediaService, candidate: Candidate, request?: PlayRequest) {
    this.setActive(service);
    const music = hasAspect(service, musicAspect) ? (service as MusicService) : null;
    let playingUri: string | null = candidate.uri ?? null;
    if (candidate.uri) service.loadUri(candidate.uri);
    else if (candidate.byIsrc && request?.isrc && music?.loadByIsrc) music.loadByIsrc(request.isrc);
    else if (music?.loadByTitleArtist) music.loadByTitleArtist(candidate.title || request?.title || "", candidate.artist ?? request?.artist);
    else if (request) {
      service.loadUri(request.uri);
      playingUri = request.uri;
    }
    service.setVolume?.(this.snapshot.muted ? 0 : this.snapshot.volume);
    service.play();
    this.set({
      playingUri,
      track: { title: candidate.title || request?.title || "", artist: candidate.artist ?? request?.artist, imageUrl: candidate.imageUrl ?? request?.imageUrl },
      durationMs: candidate.durationMs ?? request?.durationMs ?? 0,
    });
  }

  private setActive(service: MediaService | null) {
    if (service === this.active) return;
    this.unlisten?.();
    this.unlisten = null;
    // Only one service plays at a time.
    if (this.active && this.services.has(this.active.id)) {
      try {
        this.active.pause();
      } catch {
        // It may already be gone.
      }
    }
    this.active = service;
    if (service) {
      this.unlisten = service.addPlaybackListener({
        onStateChanged: (state) => {
          if (this.active === service) this.set({ state, ...(state === "playing" ? { error: null } : {}) });
        },
        onPositionChanged: (positionMs, durationMs) => {
          if (this.active === service) this.set({ positionMs, durationMs: durationMs || this.snapshot.durationMs });
        },
        onTrackChanged: (track) => {
          if (this.active !== service) return;
          const current = this.snapshot.track;
          this.set({ track: { ...current, ...track, title: track.title || current?.title || "" } });
        },
        onError: (error) => {
          if (this.active === service) this.set({ state: "error", error: error.message || "error" });
        },
        onCompleted: () => {
          if (this.active === service) this.advance(true);
        },
      });
    }
    this.set({ activeServiceId: service?.id ?? null, state: service ? this.snapshot.state : "idle" });
  }

  /** The service playing now. */
  activeService(): MediaService | null {
    return this.active;
  }

  // ---- transport --------------------------------------------------------------------------

  play(): void {
    if (this.active) this.active.play();
    else if (this.snapshot.queue.length > 0) void this.playAt(Math.max(0, this.snapshot.index), { interactive: true });
  }

  pause(): void {
    this.active?.pause();
  }

  toggle(): void {
    if (this.snapshot.state === "playing" || this.snapshot.state === "loading") this.pause();
    else this.play();
  }

  stop(): void {
    this.active?.stop();
    this.setActive(null);
    this.generation++;
    this.set({ queue: [], index: -1, state: "idle", positionMs: 0, durationMs: 0, track: null, playingUri: null, context: null, choice: null, resolving: false });
  }

  seek(positionMs: number): void {
    const to = Math.max(0, Math.min(positionMs, this.snapshot.durationMs || positionMs));
    this.active?.seek(to);
    this.set({ positionMs: to });
  }

  seekBy(deltaMs: number): void {
    this.seek(this.snapshot.positionMs + deltaMs);
  }

  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      // Private mode: it lasts for the page.
    }
    this.active?.setVolume?.(v);
    this.set({ volume: v, muted: v === 0 ? this.snapshot.muted : false });
  }

  toggleMute(): void {
    const muted = !this.snapshot.muted;
    this.active?.setVolume?.(muted ? 0 : this.snapshot.volume);
    this.set({ muted });
  }

  toggleShuffle(): void {
    const shuffle = !this.snapshot.shuffle;
    this.order = [];
    this.set({ shuffle });
    if (shuffle) this.reshuffle(this.snapshot.index);
  }

  cycleRepeat(): void {
    const next: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
    this.set({ repeat: next[this.snapshot.repeat] });
  }

  /** Next item (Bungalow's onCompleted → queue.next). `auto`: the item ended by itself. */
  next(): void {
    this.advance(false);
  }

  /** Back to the start of the item, or (in its first three seconds) the item before. */
  previous(): void {
    if (this.snapshot.positionMs > 3000 || this.snapshot.queue.length === 0) {
      this.seek(0);
      return;
    }
    const at = this.neighbour(-1);
    if (at === null) this.seek(0);
    else void this.playAt(at, { interactive: true });
  }

  private advance(auto: boolean) {
    const { repeat, queue, index } = this.snapshot;
    if (queue.length === 0) return;
    if (auto && repeat === "one" && index >= 0) {
      void this.playAt(index);
      return;
    }
    const at = this.neighbour(1);
    if (at === null) {
      // The end of the queue.
      this.set({ state: "stopped", positionMs: 0 });
      return;
    }
    void this.playAt(at, { interactive: !auto });
  }

  /** The index `step` places from the current one, in play order; null past either end. */
  private neighbour(step: 1 | -1): number | null {
    const { queue, index, repeat, shuffle } = this.snapshot;
    if (queue.length === 0) return null;
    const order = shuffle ? this.playOrder() : queue.map((_, i) => i);
    const here = Math.max(0, order.indexOf(index));
    let at = here + step;
    if (at < 0 || at >= order.length) {
      if (repeat === "off") return null;
      at = (at + order.length) % order.length;
    }
    return order[at];
  }

  private playOrder(): number[] {
    if (this.order.length !== this.snapshot.queue.length) this.reshuffle(this.snapshot.index);
    return this.order;
  }

  /** A new shuffled order that starts with `first`. */
  private reshuffle(first: number) {
    const rest = this.snapshot.queue.map((_, i) => i).filter((i) => i !== first);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.order = first >= 0 && first < this.snapshot.queue.length ? [first, ...rest] : rest;
  }

  /** Forgets the saved choice for a request ("Play with…" › "Ask every time"). */
  async forgetChoice(request: PlayRequest): Promise<void> {
    await this.store.remove?.(requestKey(request));
  }
}

/** Gondol's playback coordinator: one per page. */
export const playback = new PlaybackCoordinator();

export type { Service };
