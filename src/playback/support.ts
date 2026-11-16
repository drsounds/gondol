import type { Service } from "../services/service";
import type { MediaService, PlaybackListener, PlaybackState, PlayerSurface, TrackInfo } from "./types";

/** A media service's listener list and events (Bungalow's PlaybackSupport). */
export class PlaybackSupport {
  private listeners = new Set<PlaybackListener>();

  add(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  stateChanged(state: PlaybackState) {
    for (const l of [...this.listeners]) l.onStateChanged?.(state);
  }
  positionChanged(positionMs: number, durationMs: number) {
    for (const l of [...this.listeners]) l.onPositionChanged?.(positionMs, durationMs);
  }
  trackChanged(track: TrackInfo) {
    for (const l of [...this.listeners]) l.onTrackChanged?.(track);
  }
  error(error: Error) {
    for (const l of [...this.listeners]) l.onError?.(error);
  }
  completed() {
    for (const l of [...this.listeners]) l.onCompleted?.();
  }
}

/** What every service definition gives its service (services/concept.ts ServiceDefinition). */
export interface ServiceIdentity {
  id: string;
  name: string;
  aspects: string[];
  appId?: string;
  iconName?: string;
  hosts?: string[];
  schemes?: string[];
}

/** Whether `uri` is a web link to one of `hosts` (subdomains count) or starts with one of `schemes`. */
export function uriMatches(uri: string, hosts: readonly string[] = [], schemes: readonly string[] = []): boolean {
  const trimmed = uri.trim();
  if (schemes.some((scheme) => trimmed.toLowerCase().startsWith(scheme.toLowerCase()))) return true;
  if (!hosts.length) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return hosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
  } catch {
    return false;
  }
}

/**
 * A base for media services: identity, the listener list, state and position bookkeeping, and
 * `canPlayUri` from the manifest's hosts and schemes. Subclasses implement the transport.
 */
export abstract class BaseMediaService implements MediaService, Service {
  readonly id: string;
  readonly name: string;
  readonly aspects: readonly string[];
  readonly appId?: string;
  readonly iconName?: string;
  protected readonly hosts: readonly string[];
  protected readonly schemes: readonly string[];
  protected readonly playback = new PlaybackSupport();
  protected state: PlaybackState = "idle";
  protected positionMs = 0;
  protected durationMs = 0;

  constructor(identity: ServiceIdentity) {
    this.id = identity.id;
    this.name = identity.name;
    this.aspects = identity.aspects;
    this.appId = identity.appId;
    this.iconName = identity.iconName;
    this.hosts = identity.hosts ?? [];
    this.schemes = identity.schemes ?? [];
  }

  addPlaybackListener(listener: PlaybackListener): () => void {
    return this.playback.add(listener);
  }

  canPlayUri(uri: string): boolean {
    return uriMatches(uri, this.hosts, this.schemes);
  }

  getPlaybackState(): PlaybackState {
    return this.state;
  }
  getPositionMs(): number {
    return this.positionMs;
  }
  getDurationMs(): number {
    return this.durationMs;
  }

  protected setState(state: PlaybackState) {
    if (state === this.state) return;
    this.state = state;
    this.playback.stateChanged(state);
  }

  protected setPosition(positionMs: number, durationMs: number) {
    this.positionMs = positionMs;
    this.durationMs = durationMs;
    this.playback.positionChanged(positionMs, durationMs);
  }

  getPlayerSurface?(): PlayerSurface | null;
  abstract play(): void;
  abstract pause(): void;
  abstract stop(): void;
  abstract seek(positionMs: number): void;
  abstract loadUri(uri: string): void;
}
