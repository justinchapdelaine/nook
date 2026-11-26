// Message contract between the benchmark page (or a content script) and an
// inference host. Both hosts, the service worker and the offscreen
// document's worker, serve the same requests over a runtime port named
// `host:<name>`.

export type HostName = "offscreen" | "sw";
export const portName = (host: HostName) => `host:${host}`;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type GenerateRequest = {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  /** false inserts an empty think block so Qwen3 models answer directly. */
  enableThinking: boolean;
  /** JSON schema string for constrained output. */
  jsonSchema?: string;
};

export type HostRequest =
  | { type: "status" }
  | { type: "gpu" }
  | { type: "checkLibs" }
  | { type: "cacheStatus" }
  | { type: "load"; modelId: string; contextWindowSize?: number }
  | { type: "unload" }
  | { type: "deleteModel"; modelId: string }
  | { type: "generate"; request: GenerateRequest };

export type HostStatus = {
  host: HostName;
  /** When this host's script started; a change means the host was restarted. */
  startedAt: number;
  loaded: { modelId: string; contextWindowSize: number } | null;
};

export type GpuInfo =
  | { available: false; error: string }
  | {
      available: true;
      vendor: string;
      architecture: string;
      device: string;
      description: string;
      isFallbackAdapter: boolean;
      features: string[];
      limits: Record<string, number>;
    };

export type LibCheck = {
  lib: string;
  bytes: number;
  fetchMs: number;
  compileMs: number;
  sha256Ok: boolean;
  error?: string;
};

export type GenerateResult = {
  text: string;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  prefillTokensPerS: number | null;
  decodeTokensPerS: number | null;
  ttftMs: number | null;
  totalMs: number;
};

export type HostResults = {
  status: HostStatus;
  gpu: GpuInfo;
  checkLibs: LibCheck[];
  cacheStatus: Record<string, boolean>;
  load: { ms: number };
  unload: { ms: number };
  deleteModel: null;
  generate: GenerateResult;
};

export type RequestEnvelope = { id: number; request: HostRequest };
/** How often the host sends "alive" for each open request. */
export const HEARTBEAT_MS = 5_000;

export type ResponseEnvelope =
  | { id: number; kind: "result"; result: unknown }
  | { id: number; kind: "error"; error: string }
  | { id: number; kind: "progress"; text: string }
  /** Sent every few seconds while a request is queued or running, so the client can tell a quiet host from a dead one. */
  | { id: number; kind: "alive" };

/** Messages to the service worker that are not host requests. */
export type ControlMessage = { type: "offscreen:ensure" } | { type: "offscreen:close" } | { type: "offscreen:ready" };
export type OffscreenEnsureResult = { created: boolean; ms: number };
