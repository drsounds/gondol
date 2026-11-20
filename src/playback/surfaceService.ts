import type { ServiceDefinition } from "../services/concept";
import { serviceManager, type Service } from "../services/service";
import { serviceAccounts } from "./accounts";
import { BaseMediaService } from "./support";
import type { AuthAspect, Candidate, LoginContext, MusicService, PlayRequest, PlayerSurface, PlaybackState, ServiceAccount, TrackInfo } from "./types";

/**
 * A service that runs entirely in its `surface` page, in an iframe, the way apps ran inside early
 * Spotify: gondol talks to it over postMessage with the service protocol below, and the page plays,
 * resolves and signs in however it likes (its own player, its own sign-in UI shown in the iframe).
 *
 * Messages are objects with `gondol: "service"`. Gondol sends (a `call` id expects a `reply`):
 *
 *   { type: "load", uri } · { type: "play" } · { type: "pause" } · { type: "stop" }
 *   { type: "seek", positionMs } · { type: "volume", volume }            (0–1)
 *   { type: "findCandidates", call, request }  → reply: Candidate[]
 *   { type: "login", call } → reply: ServiceAccount (the page shows its sign-in in the iframe)
 *   { type: "logout", call } → reply: null
 *
 * The page sends:
 *
 *   { type: "ready" }                             it has loaded; gondol replays the session
 *   { type: "state", state }                      idle|loading|playing|paused|stopped|error
 *   { type: "position", positionMs, durationMs }
 *   { type: "track", track: { title, artist?, album?, imageUrl? } }
 *   { type: "completed" } · { type: "error", message }
 *   { type: "session", account: ServiceAccount | null }   signed in or out by itself
 *   { type: "reply", call, result?, error? }
 *
 * Only messages from the iframe's own window and its page's origin are read.
 */

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SurfaceService extends BaseMediaService implements MusicService, AuthAspect {
  private readonly surfaceUrl: string;
  private readonly origin: string;
  private frame: HTMLIFrameElement | null = null;
  private ready = false;
  private outbox: Record<string, unknown>[] = [];
  private calls = new Map<number, Pending>();
  private seq = 0;

  constructor(definition: ServiceDefinition & { appId: string }) {
    super(definition);
    this.surfaceUrl = definition.surface!;
    this.origin = new URL(this.surfaceUrl).origin;
  }

  // ---- the iframe ----------------------------------------------------------------------------

  getPlayerSurface(): PlayerSurface {
    return {
      aspectRatio: 16 / 9,
      mount: (container) => {
        const frame = document.createElement("iframe");
        frame.src = this.surfaceUrl;
        frame.title = this.name;
        frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
        // Its own origin (it may keep its own sign-in), never the app's.
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-forms allow-presentation");
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        frame.className = "service-surface__frame";
        container.appendChild(frame);
        this.frame = frame;
        window.addEventListener("message", this.onMessage);
        return () => {
          window.removeEventListener("message", this.onMessage);
          frame.remove();
          if (this.frame === frame) this.frame = null;
          this.ready = false;
        };
      },
    };
  }

  private send(message: Record<string, unknown>) {
    const full = { gondol: "service", ...message };
    if (!this.ready || !this.frame?.contentWindow) {
      this.outbox.push(full);
      return;
    }
    this.frame.contentWindow.postMessage(full, this.origin);
  }

  private call<T>(type: string, payload: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    const call = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(call);
        reject(new Error(`${this.name} didn't answer "${type}"`));
      }, timeoutMs);
      this.calls.set(call, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.send({ type, call, ...payload });
    });
  }

  private onMessage = (event: MessageEvent) => {
    if (!this.frame || event.source !== this.frame.contentWindow || event.origin !== this.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.gondol !== "service") return;
    switch (data.type) {
      case "ready": {
        this.ready = true;
        const queued = this.outbox;
        this.outbox = [];
        for (const message of queued) this.frame.contentWindow?.postMessage(message, this.origin);
        break;
      }
      case "state":
        this.setState(String(data.state) as PlaybackState);
        break;
      case "position":
        this.setPosition(Number(data.positionMs) || 0, Number(data.durationMs) || 0);
        break;
      case "track":
        this.playback.trackChanged(data.track as TrackInfo);
        break;
      case "completed":
        this.playback.completed();
        break;
      case "error":
        this.playback.error(new Error(String(data.message ?? "error")));
        break;
      case "session": {
        const account = data.account as ServiceAccount | null;
        void (account ? serviceAccounts().signedIn(this.id, account) : serviceAccounts().signedOut(this.id)).then(() => serviceManager.notify());
        break;
      }
      case "reply": {
        const pending = this.calls.get(Number(data.call));
        if (!pending) return;
        this.calls.delete(Number(data.call));
        clearTimeout(pending.timer);
        if (data.error) pending.reject(new Error(String(data.error)));
        else pending.resolve(data.result);
        break;
      }
    }
  };

  // ---- media ---------------------------------------------------------------------------------

  loadUri(uri: string) {
    this.setState("loading");
    this.send({ type: "load", uri });
  }
  play() {
    this.send({ type: "play" });
  }
  pause() {
    this.send({ type: "pause" });
  }
  stop() {
    this.send({ type: "stop" });
  }
  seek(positionMs: number) {
    this.send({ type: "seek", positionMs });
  }
  setVolume(volume: number) {
    this.send({ type: "volume", volume });
  }

  // ---- music ---------------------------------------------------------------------------------

  async findCandidates(request: PlayRequest): Promise<Candidate[]> {
    if (!this.aspects.includes("music")) return [];
    const result = await this.call<Candidate[]>("findCandidates", { request }).catch(() => []);
    return Array.isArray(result) ? result : [];
  }

  // ---- auth ----------------------------------------------------------------------------------

  isAuthenticated() {
    return !!serviceAccounts().current(this.id);
  }
  getAccount() {
    return serviceAccounts().current(this.id);
  }
  async login(_context: LoginContext) {
    // The page shows its own sign-in, inside the iframe (Now playing opens to show it).
    const account = await this.call<ServiceAccount>("login", {}, 5 * 60 * 1000);
    await serviceAccounts().signedIn(this.id, account);
    serviceManager.notify();
  }
  async logout() {
    await this.call("logout").catch(() => null);
    await serviceAccounts().signedOut(this.id);
    serviceManager.notify();
  }
}

/** The factory defineApp uses for a manifest service with a `surface` and no code. */
export function createSurfaceService(definition: ServiceDefinition & { appId: string }): Service {
  return new SurfaceService(definition);
}
