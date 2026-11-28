// Contract between clients (the settings page, the translator in a web page)
// and the inference host in the offscreen document's worker. Clients connect
// a runtime port named HOST_PORT; only the offscreen document listens for it,
// so when the document closes every client's port disconnects.

export const HOST_PORT = "nook:host";

/** How often the host sends "alive" for each open request. */
export const HEARTBEAT_MS = 5_000;
/** A client gives up on a request after hearing nothing for this long. */
export const SILENCE_LIMIT_MS = 60_000;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * What the user is waiting on goes first. A "user" request cancels a running
 * "background" request, which is put back in the queue and starts again.
 */
export type Priority = "user" | "background";

export interface GenerateRequest {
  /** A model family from models/models.json; the host loads it first if needed. */
  family: string;
  priority: Priority;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
}

export interface ModelStatus {
  family: string;
  /** The build this GPU would load. */
  build: string;
  downloaded: boolean;
  /** A download of this family is queued or running, perhaps for a settings page that has since closed. */
  downloading: boolean;
}

export type HostRequest =
  /** Download state of every model family, for this GPU. */
  | { type: "models" }
  /**
   * Downloads (if needed) and loads a family. Only the settings page sends this, after the user agreed.
   * A download keeps going when its page closes; asking again for the same family follows it.
   */
  | { type: "download"; family: string }
  /** Removes every build of a family from the cache, unloading it first if loaded. */
  | { type: "delete"; family: string }
  | { type: "generate"; request: GenerateRequest };

export interface HostResults {
  models: ModelStatus[];
  download: null;
  delete: null;
  /** The reply itself arrives as deltas. */
  generate: { finishReason: string | null };
}

/** Error codes a client can act on; any other failure has only a message. */
export type HostErrorCode =
  /** The model must be downloaded first, from the settings page. */
  | "not-downloaded"
  /** This browser or GPU has no WebGPU. */
  | "no-webgpu"
  /** The client cancelled the request. */
  | "cancelled";

export type ClientMessage = { id: number; request: HostRequest } | { id: number; cancel: true };

export type HostMessage =
  | { id: number; kind: "result"; result: unknown }
  | { id: number; kind: "error"; error: string; code?: HostErrorCode }
  /** Download or load progress, as text and a fraction from 0 to 1. */
  | { id: number; kind: "progress"; text: string; fraction: number }
  /** Generated text so far is extended by `text`. */
  | { id: number; kind: "delta"; text: string }
  /** The request was put back in the queue to make way for user work; text so far is discarded. */
  | { id: number; kind: "restart" }
  /** Sent every HEARTBEAT_MS while a request is queued or running. */
  | { id: number; kind: "alive" };

/** Messages to the service worker about the offscreen document. */
export type OffscreenMessage =
  /** Opens the offscreen document if needed; replies once it listens for ports. */
  | { type: "offscreen:ensure" }
  /** From the offscreen document: it is ready for ports. */
  | { type: "offscreen:ready" }
  /** From the offscreen document: it has been idle long enough to close. Answered only if closing failed. */
  | { type: "offscreen:idle" }
  /** From the settings page: the idle time changed, so an open document uses it at once. */
  | { type: "offscreen:idle-minutes"; minutes: number };

export type EnsureResult = { ok: true } | { ok: false; error: string };
