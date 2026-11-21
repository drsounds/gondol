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
}
