export const ExitCode = {
  Success: 0,
  FileNotFound: 1,
  ConfigError: 3,
} as const;

export type ExitCodeType = (typeof ExitCode)[keyof typeof ExitCode];

export class WorkerBeeError extends Error {
  constructor(
    message: string,
    public readonly exitCode: ExitCodeType = ExitCode.Success
  ) {
    super(message);
    this.name = "WorkerBeeError";
  }
}