// What every task shares: one connection to the model host per context, and
// host failures turned into reasons a feature can act on. Features see only
// TaskError, never the host or its protocol.
import { HostClient, HostRequestError } from "../runtime/client";
import type { HostErrorCode } from "../runtime/protocol";

let client: HostClient | undefined;

export function hostClient(): HostClient {
  client ??= new HostClient();
  return client;
}

/** Why a task failed. `reason` is set when the feature can act on it. */
export class TaskError extends Error {
  constructor(
    message: string,
    readonly reason?: HostErrorCode,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

export function toTaskError(error: unknown): TaskError {
  if (error instanceof TaskError) return error;
  if (error instanceof HostRequestError) return new TaskError(error.message, error.code);
  return new TaskError(error instanceof Error ? error.message : String(error));
}
