// An inference host: one WebLLM engine serving HostRequests, one at a time.
// The same code runs in the service worker and in the offscreen document's
// dedicated worker, so the two hostings are compared like for like.
// State lives in module variables on purpose: losing it when the service
// worker stops is part of what experiment E1 measures.
import { deleteModelAllInfoInCache, hasModelInCache, MLCEngine } from "@mlc-ai/web-llm";
import { gpuInfo } from "./gpu";
import { appConfig, findModel, libUrl, MODELS } from "./models";
import { stripEmptyThinkBlock } from "./prompts";
import type {
  GenerateRequest,
  GenerateResult,
  HostName,
  HostRequest,
  HostStatus,
  LibCheck,
  RequestEnvelope,
  ResponseEnvelope,
} from "./protocol";

const startedAt = Date.now();
const config = appConfig(self.location.origin);

export function createHost(host: HostName) {
  let engine: MLCEngine | undefined;
  let loaded: HostStatus["loaded"] = null;
  let onProgress: ((text: string) => void) | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const getEngine = () => {
    engine ??= new MLCEngine({ appConfig: config, initProgressCallback: (report) => onProgress?.(report.text) });
    return engine;
  };

  async function run(request: HostRequest, progress: (text: string) => void): Promise<unknown> {
    switch (request.type) {
      case "status":
        return { host, startedAt, loaded } satisfies HostStatus;
      case "gpu":
        return gpuInfo();
      case "checkLibs":
        return checkLibs();
      case "cacheStatus": {
        const entries = await Promise.all(MODELS.map(async (m) => [m.id, await hasModelInCache(m.id, config)]));
        return Object.fromEntries(entries);
      }
      case "load": {
        const start = performance.now();
        if (loaded) await getEngine().unload();
        loaded = null;
        const contextWindowSize = request.contextWindowSize ?? findModel(request.modelId).overrides.context_window_size;
        onProgress = progress;
        try {
          await getEngine().reload(request.modelId, { context_window_size: contextWindowSize });
        } finally {
          onProgress = undefined;
        }
        loaded = { modelId: request.modelId, contextWindowSize };
        return { ms: performance.now() - start };
      }
      case "unload": {
        const start = performance.now();
        if (engine) await engine.unload();
        loaded = null;
        return { ms: performance.now() - start };
      }
      case "deleteModel":
        await deleteModelAllInfoInCache(request.modelId, config);
        return null;
      case "generate":
        if (!engine || !loaded) throw new Error("No model loaded");
        return generate(engine, request.request, progress);
    }
  }

  /** Serves one request envelope; requests run one at a time, in order. */
  function serve(envelope: RequestEnvelope, send: (response: ResponseEnvelope) => void): void {
    const { id, request } = envelope;
    const task = queue.then(() => run(request, (text) => send({ id, kind: "progress", text })));
    queue = task.catch(() => {});
    task.then(
      (result) => send({ id, kind: "result", result }),
      (error: unknown) => send({ id, kind: "error", error: error instanceof Error ? error.message : String(error) }),
    );
  }

  return { serve };
}

async function generate(
  engine: MLCEngine,
  request: GenerateRequest,
  progress: (text: string) => void,
): Promise<GenerateResult> {
  const start = performance.now();
  const chunks = await engine.chat.completions.create({
    messages: request.messages,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    stream: true,
    stream_options: { include_usage: true },
    extra_body: { enable_thinking: request.enableThinking },
    response_format: request.jsonSchema ? { type: "json_object", schema: request.jsonSchema } : undefined,
  });
  let text = "";
  let ttftMs: number | null = null;
  let finishReason: string | null = null;
  let usage: { prompt_tokens: number; completion_tokens: number; extra?: Record<string, number> } | undefined;
  let lastProgress = start;
  for await (const chunk of chunks) {
    const choice = chunk.choices[0];
    if (choice?.delta?.content) {
      ttftMs ??= performance.now() - start;
      text += choice.delta.content;
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage as unknown as typeof usage;
    // Regular messages also keep a service worker host awake during long replies.
    if (performance.now() - lastProgress > 1000) {
      lastProgress = performance.now();
      progress(`${text.length} characters`);
    }
  }
  return {
    // With thinking off, WebLLM puts an empty think block in front of the reply and
    // returns it as part of the text. Remove it so only the answer is checked and scored.
    text: request.enableThinking ? text : stripEmptyThinkBlock(text),
    finishReason,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    prefillTokensPerS: usage?.extra?.prefill_tokens_per_s ?? null,
    decodeTokensPerS: usage?.extra?.decode_tokens_per_s ?? null,
    ttftMs,
    totalMs: performance.now() - start,
  };
}

/** Fetches and compiles each packaged model library, checking its hash. */
async function checkLibs(): Promise<LibCheck[]> {
  const results: LibCheck[] = [];
  for (const model of MODELS) {
    const start = performance.now();
    try {
      const response = await fetch(libUrl(self.location.origin, model.lib));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const fetchMs = performance.now() - start;
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
      const compileStart = performance.now();
      await WebAssembly.compile(bytes);
      results.push({
        lib: model.lib,
        bytes: bytes.byteLength,
        fetchMs,
        compileMs: performance.now() - compileStart,
        sha256Ok: hex === model.sha256,
      });
    } catch (error) {
      results.push({ lib: model.lib, bytes: 0, fetchMs: 0, compileMs: 0, sha256Ok: false, error: String(error) });
    }
  }
  return results;
}
