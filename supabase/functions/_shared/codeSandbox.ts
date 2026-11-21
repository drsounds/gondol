export type CodeSandboxProvider = "openhands" | "copilot";

/** Rows created before provider selection was added continue to use OpenHands. */
export function codeSandboxProvider(value: unknown): CodeSandboxProvider {
  return value === "copilot" ? "copilot" : "openhands";
}

export interface CommandResult {
  command_id: string;
  exit_code: number | null;
  running: boolean;
  stdout: string;
  stderr: string;
}

export interface SandboxBackend {
  readonly url: string;
  readonly previewTemplate: string | null;
  readonly ports: number[];
  readonly id: string | null;
  run(command: string, options?: { cwd?: string; timeoutSeconds?: number; waitMs?: number }): Promise<CommandResult>;
  output(commandId: string, waitMs?: number): Promise<CommandResult>;
  must(command: string, cwd?: string, waitMs?: number): Promise<string>;
  download(path: string): Promise<Uint8Array | null>;
  upload(path: string, content: Uint8Array | string): Promise<void>;
  agentPrompt?(input: { prompt: string; cwd: string; githubToken: string; model?: string }): Promise<{ session_id: string; content: string }>;
}
