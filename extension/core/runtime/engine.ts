// The contract between the host and an inference engine. webllm.ts is the
// real one; the end-to-end tests build with a scripted fake in its place
// (tests/e2e/fake-engine.ts), so feature tests run fast and need no model.
import type { ModelBuild } from "../models";
import type { ChatMessage, HostErrorCode } from "./protocol";

export interface EngineRequest {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
}

export interface Engine {
  /** Whether the GPU has shader-f16. Throws HostError "no-webgpu" when there is no usable GPU. */
  hasF16(): Promise<boolean>;
  isCached(build: ModelBuild): Promise<boolean>;
  /** Loads a build, downloading its weights first if they aren't cached. Replaces any loaded build. */
  load(build: ModelBuild, onProgress: (text: string, fraction: number) => void): Promise<void>;
  unload(): Promise<void>;
  /** Deletes a build's weights and config from the cache. */
  remove(build: ModelBuild): Promise<void>;
  /**
   * Streams a reply from the loaded build through `onDelta`, as answer text
   * only (no reasoning block). Aborting `signal`, before or during the call, stops the reply early.
   */
  generate(
    request: EngineRequest,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<{ finishReason: string | null }>;
}

/** A failure the client can act on, by its code. */
export class HostError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HostError";
  }
}
