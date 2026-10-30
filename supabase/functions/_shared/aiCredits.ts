// AI credits (docs/guide/ai.md "Credits"), shared by the AI edge functions: before a model is asked
// the caller's credits are checked (`ai_credits()`, as the user), and once it has answered its tokens
// are charged (`ai_credit_charge()`, which only the service role may call, so nobody can drain a
// shared pool by hand).
//
// Which credits: the site's whose domain the request comes from (the browser's Origin; any other
// host counts as the host's root site), the workspace the client names (`workspaceId` in the body or
// the x-spacify-workspace header) when the account is a member, and the app asking (`app`, default
// "ai"). Without the database functions (a host that hasn't added them) AI stays unlimited.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const env = (name: string): string | undefined =>
  (globalThis as typeof globalThis & { Deno: { env: { get: (name: string) => string | undefined } } }).Deno.env.get(name);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface CreditContext {
  userId: string;
  siteDomain: string | null;
  workspaceId: string | null;
  app: string;
  provider: string;
  model: string | null;
}

export interface CreditUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Thrown when the caller is out of credits; the functions answer it with kind "credits", 402. */
export class CreditsError extends Error {
  readonly kind = "credits";
  readonly status = 402;
  constructor(
    message: string,
    readonly nextRefillAt: string | null,
  ) {
    super(message);
  }
}

/** The credits couldn't be checked or counted (kind "config", 500). */
export class CreditsConfigError extends Error {
  readonly kind = "config";
  readonly status = 500;
}

/** Who asks for what, from the request (its Origin and headers) and its body. */
export function creditContext(
  request: Request | null,
  body: Record<string, unknown>,
  values: { userId: string; provider: string; model?: unknown; app?: string; workspaceId?: string | null },
): CreditContext {
  let siteDomain: string | null = null;
  const origin = request?.headers.get("Origin");
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.protocol === "https:" || url.protocol === "http:") siteDomain = url.host;
    } catch {
      // An opaque origin (a file, the desktop app's scheme): the root site.
    }
  }
  const header = request?.headers.get("x-spacify-workspace") ?? "";
  const workspace = values.workspaceId !== undefined ? values.workspaceId : typeof body.workspaceId === "string" ? body.workspaceId : header;
  const app = values.app ?? (typeof body.app === "string" ? body.app : "");
  const model = values.model !== undefined ? values.model : body.model;
  return {
    userId: values.userId,
    siteDomain,
    workspaceId: workspace && UUID.test(workspace) ? workspace : null,
    app: APP_ID.test(app) ? app : "ai",
    provider: values.provider,
    model: typeof model === "string" && model.trim() ? model.trim().slice(0, 200) : null,
  };
}

let admin: SupabaseClient | null | undefined;
function adminClient(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return admin;
}

/** The database hasn't got the credit functions: nothing is limited. */
const missing = (error: { code?: string; message?: string }) => error.code === "PGRST202" || error.code === "42883" || /ai_credits?(_charge)?\b.*(not find|does not exist)/i.test(error.message ?? "");

function formatRefill(at: string | null): string {
  if (!at) return "";
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : ` New credits come ${date.toISOString().replace("T", " ").slice(0, 16)} UTC.`;
}

/**
 * Throws CreditsError when the caller has no credits left for this request. `user` acts as the
 * caller (RLS and auth.uid()). Resolves with whether any tier limits it, for `chargeCredits`.
 */
export async function assertCredits(user: SupabaseClient, context: CreditContext): Promise<{ limited: boolean }> {
  const { data, error } = await user.rpc("ai_credits", {
    p_site_domain: context.siteDomain,
    p_workspace_id: context.workspaceId,
    p_app: context.app,
    p_provider: context.provider,
    p_model: context.model,
  });
  if (error) {
    if (missing(error)) return { limited: false };
    throw new CreditsConfigError(`Couldn't check your AI credits (${error.message})`);
  }
  const state = (data ?? {}) as { limited?: boolean; allowed?: boolean; nextRefillAt?: string | null };
  if (!state.limited) return { limited: false };
  if (state.allowed === false) {
    throw new CreditsError(`You're out of AI credits for this.${formatRefill(state.nextRefillAt ?? null)}`, state.nextRefillAt ?? null);
  }
  // Limited answers must be counted, which takes the service role.
  if (!adminClient()) throw new CreditsConfigError("AI credits can't be counted: SUPABASE_SERVICE_ROLE_KEY isn't set for this function");
  return { limited: true };
}

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

/**
 * Records what an answer used. Never throws: a failed charge is logged, the answer stands. The
 * worker is kept alive until it's written, also when the response has gone already.
 */
export function chargeCredits(context: CreditContext, usage: CreditUsage): Promise<void> {
  const write = charge(context, usage).catch((error) => console.error("ai credits: couldn't charge", error));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime?.waitUntil?.(write);
  return write;
}

async function charge(context: CreditContext, usage: CreditUsage): Promise<void> {
  const client = adminClient();
  const input = Math.max(0, Math.round(usage.inputTokens || 0));
  const output = Math.max(0, Math.round(usage.outputTokens || 0));
  if (!client || (!input && !output)) return;
  const { error } = await client.rpc("ai_credit_charge", {
    p_user: context.userId,
    p_site_domain: context.siteDomain,
    p_workspace_id: context.workspaceId,
    p_app: context.app,
    p_provider: context.provider,
    p_model: context.model,
    p_input_tokens: Math.min(input, 2_000_000_000),
    p_output_tokens: Math.min(output, 2_000_000_000),
  });
  if (error && !missing(error)) console.error("ai credits: couldn't charge", error.message);
}

/** A rough token count for text when the API doesn't report one (about four characters a token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Passes an OpenAI-compatible server-sent event stream through, reading the `usage` the API reports
 * (with `stream_options.include_usage`) or estimating it from the answer's text, and calls `done`
 * with it when the stream ends (also when it's cut off).
 */
export function meterOpenAiStream(body: ReadableStream<Uint8Array>, inputEstimate: number, done: (usage: CreditUsage) => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let reported: CreditUsage | null = null;
  let answered = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done(reported ?? { inputTokens: inputEstimate, outputTokens: Math.ceil(answered / 4) });
  };
  const read = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const chunk = JSON.parse(data) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        choices?: { delta?: { content?: string | null; tool_calls?: { function?: { arguments?: string } }[] } }[];
      };
      if (chunk.usage && (chunk.usage.prompt_tokens || chunk.usage.completion_tokens)) {
        reported = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
      }
      for (const choice of chunk.choices ?? []) {
        answered += choice.delta?.content?.length ?? 0;
        for (const call of choice.delta?.tool_calls ?? []) answered += call.function?.arguments?.length ?? 0;
      }
    } catch {
      // Not JSON: not ours to read.
    }
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) read(line);
      },
      flush() {
        buffer += decoder.decode();
        if (buffer) read(buffer);
        finish();
      },
      cancel() {
        finish();
      },
    } as Transformer<Uint8Array, Uint8Array>),
  );
}

/** Counts an Ollama answer from its JSON lines: the last one reports the tokens (`prompt_eval_count`, `eval_count`). */
export function ollamaMeter(inputEstimate: number): { line: (text: string) => void; usage: () => CreditUsage } {
  let reported: CreditUsage | null = null;
  let answered = 0;
  return {
    line(text: string) {
      try {
        const chunk = JSON.parse(text) as { message?: { content?: string; tool_calls?: unknown[] }; prompt_eval_count?: number; eval_count?: number; done?: boolean };
        answered += chunk.message?.content?.length ?? 0;
        if (chunk.message?.tool_calls) answered += JSON.stringify(chunk.message.tool_calls).length;
        if (chunk.done && (chunk.prompt_eval_count || chunk.eval_count)) {
          reported = { inputTokens: chunk.prompt_eval_count ?? 0, outputTokens: chunk.eval_count ?? 0 };
        }
      } catch {
        // Not JSON.
      }
    },
    usage: () => reported ?? { inputTokens: inputEstimate, outputTokens: Math.ceil(answered / 4) },
  };
}
