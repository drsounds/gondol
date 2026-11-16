import { supabase } from "../../../supabase/client";
import type { ServiceDefinition } from "../../../services/concept";
import { serviceManager } from "../../../services/service";
import { serviceAccounts } from "../../../playback/accounts";
import { BaseMediaService } from "../../../playback/support";
import type { AuthAspect, Candidate, LoginContext, MusicService, PlayRequest, PlayerSurface } from "../../../playback/types";

/**
 * YouTube as a music service, ported from Bungalow's YouTubeMusicService and YouTubePlayerComponent:
 * it plays YouTube links (and `youtube:<video id>`) as they are, and resolves everything else by
 * searching YouTube for the title and artist (the `yt-music-service` edge function, since the
 * browser can't search YouTube itself). It can't resolve an ISRC on its own, so it searches for the
 * ISRC's text, which finds the label's "Topic" upload more often than not.
 *
 * Playback runs in YouTube's own embedded player (the IFrame Player API, from youtube-nocookie.com),
 * mounted in the service's surface: the service dock at the bottom of the menu, or Now playing.
 * When a video can't be embedded (errors 101/150) it falls through to the next search result, as
 * Bungalow does.
 */

interface YtPlayer {
  loadVideoById(id: string | { videoId: string; startSeconds?: number }): void;
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoData?(): { title?: string; author?: string };
  destroy(): void;
}

interface YtNamespace {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YtPlayer;
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoading: Promise<YtNamespace> | null = null;

/** Loads YouTube's IFrame Player API once. */
function loadYouTubeApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiLoading ??= new Promise<YtNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiLoading = null;
      reject(new Error("YouTube's player couldn't load"));
    };
    document.head.appendChild(script);
  });
  return apiLoading;
}

/** The video id in a YouTube link or `youtube:<id>`, else null. */
export function youTubeVideoId(uri: string): string | null {
  const value = uri.trim();
  const scheme = /^youtube:(?:video:)?([A-Za-z0-9_-]{11})$/i.exec(value);
  if (scheme) return scheme[1];
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return /^\/([A-Za-z0-9_-]{11})/.exec(url.pathname)?.[1] ?? null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = url.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      return /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname)?.[1] ?? null;
    }
  } catch {
    // Not a URL.
  }
  return null;
}

export interface YouTubeResult {
  videoId: string;
  title: string;
  channel?: string;
  thumbnail?: string;
  durationMs?: number;
}

/** Searches YouTube through the app's edge function. */
export async function searchYouTube(query: string, max = 8): Promise<YouTubeResult[]> {
  const { data, error } = await supabase.functions.invoke("yt-music-service", { body: { action: "search", query, max } });
  if (error) throw error;
  return ((data as { results?: YouTubeResult[] } | null)?.results ?? []).filter((r) => r && r.videoId);
}

const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

export class YouTubeService extends BaseMediaService implements MusicService, AuthAspect {
  private player: YtPlayer | null = null;
  private creating: Promise<YtPlayer> | null = null;
  private container: HTMLElement | null = null;
  private pendingVideo: string | null = null;
  private wantPlaying = false;
  private volume = 0.8;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** The rest of the last search, to fall through to when a video won't embed. */
  private fallbacks: string[] = [];
  private readonly surface: PlayerSurface;

  constructor(definition: ServiceDefinition & { appId: string }) {
    super(definition);
    this.surface = {
      aspectRatio: 16 / 9,
      mount: (container) => {
        const host = document.createElement("div");
        host.className = "service-surface__frame";
        container.appendChild(host);
        this.container = host;
        if (this.pendingVideo) void this.ensurePlayer();
        return () => {
          this.stopTicker();
          this.player?.destroy();
          this.player = null;
          this.creating = null;
          host.remove();
          if (this.container === host) this.container = null;
        };
      },
    };
  }

  getPlayerSurface() {
    return this.surface;
  }

  canPlayUri(uri: string): boolean {
    return youTubeVideoId(uri) !== null;
  }

  private ensurePlayer(): Promise<YtPlayer> {
    if (this.player) return Promise.resolve(this.player);
    if (!this.container) return Promise.reject(new Error("YouTube's player isn't on the page yet"));
    const container = this.container;
    this.creating ??= loadYouTubeApi().then(
      (YT) =>
        new Promise<YtPlayer>((resolve) => {
          const target = document.createElement("div");
          container.appendChild(target);
          const player = new YT.Player(target, {
            host: "https://www.youtube-nocookie.com",
            width: "100%",
            height: "100%",
            videoId: this.pendingVideo ?? undefined,
            playerVars: { autoplay: this.wantPlaying ? 1 : 0, controls: 1, rel: 0, playsinline: 1, modestbranding: 1, origin: window.location.origin },
            events: {
              onReady: () => {
                this.player = player;
                player.setVolume(Math.round(this.volume * 100));
                if (this.pendingVideo && this.wantPlaying) player.playVideo();
                resolve(player);
              },
              onStateChange: (event: { data: number }) => this.onPlayerState(event.data),
              onError: (event: { data: number }) => this.onPlayerError(event.data),
            },
          });
        }),
    );
    return this.creating;
  }

  // ---- loading -----------------------------------------------------------------------------

  private loadVideo(videoId: string) {
    this.pendingVideo = videoId;
    this.wantPlaying = true;
    this.setState("loading");
    this.setPosition(0, 0);
    if (this.player) this.player.loadVideoById(videoId);
    else void this.ensurePlayer().catch((error) => this.playback.error(error as Error));
  }

  loadUri(uri: string) {
    const id = youTubeVideoId(uri);
    this.fallbacks = [];
    if (id) this.loadVideo(id);
    else this.playback.error(new Error(`YouTube can't play ${uri}`));
  }

  loadByIsrc(isrc: string) {
    this.loadByTitleArtist(isrc);
  }

  loadByTitleArtist(title: string, artist?: string) {
    const query = [title, artist].filter(Boolean).join(" ");
    this.setState("loading");
    void searchYouTube(query)
      .then((results) => {
        if (!results.length) throw new Error(`Nothing on YouTube for “${query}”`);
        this.fallbacks = results.slice(1).map((r) => r.videoId);
        this.loadVideo(results[0].videoId);
        this.playback.trackChanged({ title: results[0].title, artist: results[0].channel, imageUrl: results[0].thumbnail });
      })
      .catch((error) => {
        this.setState("error");
        this.playback.error(error as Error);
      });
  }

  /** The top search results, each a video of its own (Bungalow's findCandidates). */
  async findCandidates(request: PlayRequest): Promise<Candidate[]> {
    const query = request.title ? [request.title, request.artist].filter(Boolean).join(" ") : (request.isrc ?? "");
    if (!query.trim()) return [];
    const results = await searchYouTube(query);
    return results.map((r) => ({
      uri: watchUrl(r.videoId),
      title: r.title,
      artist: r.channel,
      imageUrl: r.thumbnail,
      durationMs: r.durationMs,
      byIsrc: false,
    }));
  }

  // ---- transport ---------------------------------------------------------------------------

  play() {
    this.wantPlaying = true;
    this.player?.playVideo();
  }
  pause() {
    this.wantPlaying = false;
    this.player?.pauseVideo();
  }
  stop() {
    this.wantPlaying = false;
    this.player?.stopVideo();
    this.setPosition(0, this.durationMs);
    this.setState("stopped");
  }
  seek(positionMs: number) {
    this.player?.seekTo(positionMs / 1000, true);
    this.setPosition(positionMs, this.durationMs);
  }
  setVolume(volume: number) {
    this.volume = volume;
    this.player?.setVolume(Math.round(volume * 100));
  }

  // ---- the player's events -----------------------------------------------------------------

  private onPlayerState(ytState: number) {
    switch (ytState) {
      case 1:
        this.setState("playing");
        this.startTicker();
        this.reportTitle();
        break;
      case 2:
        this.setState("paused");
        this.stopTicker();
        break;
      case 3:
        this.setState("loading");
        break;
      case 0:
        this.stopTicker();
        this.setState("stopped");
        this.playback.completed();
        break;
      default:
        // -1 unstarted, 5 cued: as it was.
        break;
    }
  }

  private onPlayerError(code: number) {
    // 101/150: the owner doesn't allow embedding; 100: gone. Fall through to the next result.
    if ((code === 100 || code === 101 || code === 150) && this.fallbacks.length) {
      const next = this.fallbacks.shift()!;
      this.loadVideo(next);
      return;
    }
    this.setState("error");
    this.playback.error(new Error(code === 101 || code === 150 ? "This video can't be played outside YouTube" : `YouTube error ${code}`));
  }

  private reportTitle() {
    const data = this.player?.getVideoData?.();
    if (data?.title) this.playback.trackChanged({ title: data.title, artist: data.author });
  }

  private startTicker() {
    this.stopTicker();
    this.ticker = setInterval(() => {
      if (!this.player) return;
      this.setPosition(this.player.getCurrentTime() * 1000, this.player.getDuration() * 1000);
    }, 500);
  }

  private stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  // ---- signing in --------------------------------------------------------------------------

  isAuthenticated() {
    return !!serviceAccounts().current(this.id);
  }
  getAccount() {
    return serviceAccounts().current(this.id);
  }
  /** Opens the sign-in sheet (an account name and, optionally, a YouTube Data API key). */
  login(context: LoginContext) {
    context.navigate(`/music-services/${this.id}/sign-in`);
  }
  async logout() {
    await serviceAccounts().signedOut(this.id);
    serviceManager.notify();
  }
}
