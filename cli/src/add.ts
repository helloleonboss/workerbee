import { addLogEntry } from "./lib/log.js";
import { ExitCode, WorkerBeeError } from "./lib/errors.js";

export function handleAdd(content: string): void {
  if (!content || content.trim().length === 0) {
    throw new WorkerBeeError("内容不能为空", ExitCode.ConfigError);
  }

  const result = addLogEntry(content.trim());
  console.log(JSON.stringify(result, null, 2));
}