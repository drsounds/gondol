import { supabase } from "../../../supabase/client";
import { AiProviderError } from "./provider";

/**
 * The AI edge functions' WebSocket protocol, for answers that take long: a model loading, a slow
 * server, an agent working through many steps. Over plain HTTP a proxy between the browser and the
 * function (Kong, nginx) closes a request that sends nothing for a minute; over a socket the
 * function sends `ping` every few seconds while it waits, and the browser can answer back (an
 * agent's tool calls) on the same connection.
 *
 * A browser can't put headers on a WebSocket, so the session's access token goes in the first
 * message, never the URL:
 *
 *   browser → { type: "start", accessToken, body }        body: what the HTTP POST would send
 *   function → { type: "ready" }                          signed in, working on it
 *              { type: "ping" }                           still working
 *              { type: "error", error, kind, status? }    gave up (then closes)
 *              { type: "done", ...result }                finished (then closes)
 *              anything else                              the function's own events (onEvent)
 *   browser → { type: "cancel" }                          stop (or just close the socket)
 *              the function's own replies (send)
 *
 * The function must be exempt from the gateway's JWT check (it checks the token itself).
 */

export type AiSocketEvent = { type: string } & Record<string, unknown>;

type ErrorKind = AiProviderError["kind"];

/** How long the socket may take to open and the function to say `ready`. */
const OPEN_TIMEOUT_MS = 20_000;
/** How long the function may say nothing (not even `ping`) before the connection counts as lost. */
const IDLE_TIMEOUT_MS = 90_000;

/** The socket couldn't be opened, so nothing was sent: the caller may try plain HTTP instead. */
export class AiSocketUnavailableError extends AiProviderError {
  constructor(message: string) {
    super(message, "unreachable");
    this.name = "AiSocketUnavailableError";
  }
}

/** wss://…/functions/v1/<name>, from the Supabase client's own functions address. */
export function aiFunctionSocketUrl(functionName: string): string {
  const base = (supabase.functions as unknown as { url: string | URL }).url.toString().replace(/\/+$/, "");
  return `${base.replace(/^http/i, "ws")}/${functionName}`;
}

/** Whether this browser (or runtime) can open WebSockets. */
export const canUseAiSockets = () => typeof WebSocket !== "undefined";

export interface AiSocketOptions {
  signal?: AbortSignal;
  /** Each of the function's own events; `send` answers on the same connection. */
  onEvent?: (event: AiSocketEvent, send: (message: Record<string, unknown>) => void) => void | Promise<void>;
}

/**
 * Opens a socket to an AI function, sends `body` and resolves with its `done` event. Rejects with
 * an AiProviderError: AiSocketUnavailableError when it never got going (nothing was sent), `aborted`
 * when `signal` stops it, else what the function said went wrong.
 */
export async function runAiSocket(functionName: string, body: Record<string, unknown>, { signal, onEvent }: AiSocketOptions = {}): Promise<AiSocketEvent> {
  if (signal?.aborted) throw new AiProviderError("Stopped", "aborted");
  if (!canUseAiSockets()) throw new AiSocketUnavailableError("WebSockets aren't available here");
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new AiProviderError("Sign in before using the AI service", "config", 401);

  let socket: WebSocket;
  try {
    socket = new WebSocket(aiFunctionSocketUrl(functionName));
  } catch (error) {
    throw new AiSocketUnavailableError(`Couldn't open a connection to the AI service (${error instanceof Error ? error.message : String(error)})`);
  }

  return new Promise<AiSocketEvent>((resolve, reject) => {
    let ready = false;
    let settled = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const send = (message: Record<string, unknown>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const finish = (outcome: { event: AiSocketEvent } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      signal?.removeEventListener("abort", abort);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000);
      if ("event" in outcome) resolve(outcome.event);
      else reject(outcome.error);
    };
    const watch = (ms: number) => {
      clearTimeout(idle);
      idle = setTimeout(
        () =>
          finish({
            error: ready
              ? new AiProviderError("The AI service stopped answering", "unreachable")
              : new AiSocketUnavailableError("The AI service didn't answer in time"),
          }),
        ms,
      );
    };
    const abort = () => {
      send({ type: "cancel" });
      finish({ error: new AiProviderError("Stopped", "aborted") });
    };
    signal?.addEventListener("abort", abort, { once: true });
    watch(OPEN_TIMEOUT_MS);

    socket.onopen = () => send({ type: "start", accessToken, body });
    socket.onerror = () => {
      // A close event follows with what is known.
    };
    socket.onclose = (event) => {
      if (settled) return;
      if (!ready) finish({ error: new AiSocketUnavailableError(`Couldn't open a connection to the AI service (${event.code})`) });
      else finish({ error: new AiProviderError(`The connection to the AI service closed (${event.code}${event.reason ? `: ${event.reason}` : ""})`, "unreachable") });
    };
    socket.onmessage = (message) => {
      if (settled) return;
      let event: AiSocketEvent;
      try {
        event = JSON.parse(String(message.data)) as AiSocketEvent;
      } catch {
        finish({ error: new AiProviderError("The AI service sent something that isn't JSON", "invalid") });
        return;
      }
      if (!event || typeof event.type !== "string") return;
      ready = true;
      watch(IDLE_TIMEOUT_MS);
      if (event.type === "ready" || event.type === "ping") return;
      if (event.type === "error") {
        const kind = (typeof event.kind === "string" ? event.kind : "http") as ErrorKind;
        finish({ error: new AiProviderError(typeof event.error === "string" ? event.error : "The AI service failed", kind, typeof event.status === "number" ? event.status : undefined) });
        return;
      }
      if (event.type === "done") {
        finish({ event });
        return;
      }
      try {
        const handled = onEvent?.(event, send);
        if (handled instanceof Promise) handled.catch((error: unknown) => finish({ error: error instanceof Error ? error : new Error(String(error)) }));
      } catch (error) {
        finish({ error: error instanceof Error ? error : new Error(String(error)) });
      }
    };
  });
}
