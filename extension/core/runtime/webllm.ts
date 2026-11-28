// The real engine: WebLLM, running in the offscreen document's worker. This
// file is the only code allowed to import WebLLM (enforced by Biome), so
// the runtime can be swapped without touching features.
import type { AppConfig, ChatOptions } from "@mlc-ai/web-llm";
import { deleteModelAllInfoInCache, hasModelInCache, MLCEngine } from "@mlc-ai/web-llm";
import type { ModelBuild } from "../models";
import { CONTEXT_WINDOW, FAMILIES, libUrl } from "../models";
import type { Engine } from "./engine";
import { HostError } from "./engine";
import { createThinkFilter } from "./think";

function appConfig(origin: string): AppConfig {
  return {
    model_list: FAMILIES.flatMap((family) => family.builds).map((build) => ({
      model: build.weights,
      model_id: build.id,
      model_lib: libUrl(origin, build.lib),
      vram_required_MB: build.vramMB,
      required_features: build.needsF16 ? ["shader-f16"] : undefined,
      overrides: { ...(build.overrides as ChatOptions), context_window_size: CONTEXT_WINDOW },
    })),
  };
}

export function createEngine(): Engine {
  const config = appConfig(self.location.origin);
  let onProgress: ((text: string, fraction: number) => void) | undefined;
  const engine = new MLCEngine({
    appConfig: config,
    initProgressCallback: (report) => onProgress?.(report.text, report.progress),
  });

  return {
    async hasF16() {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new HostError("no-webgpu", "WebGPU isn't available in this browser");
      return adapter.features.has("shader-f16");
    },
    isCached: (build: ModelBuild) => hasModelInCache(build.id, config),
    async load(build, progress) {
      onProgress = progress;
      try {
        await engine.reload(build.id);
      } finally {
        onProgress = undefined;
      }
    },
    unload: () => engine.unload(),
    remove: (build) => deleteModelAllInfoInCache(build.id, config),
    async generate(request, onDelta, signal) {
      const stop = () => void engine.interruptGenerate();
      signal.addEventListener("abort", stop, { once: true });
      try {
        const chunks = await engine.chat.completions.create({
          messages: request.messages,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          response_format: request.jsonSchema ? { type: "json_object", schema: request.jsonSchema } : undefined,
          stream: true,
          // Every task wants a direct answer; WebLLM then adds an empty think block, removed below.
          extra_body: { enable_thinking: false },
        });
        const filter = createThinkFilter();
        let finishReason: string | null = null;
        for await (const chunk of chunks) {
          // WebLLM clears its interrupt flag when a reply starts, so an abort from before then
          // (even before this call) is caught here, at the first chunk.
          if (signal.aborted) {
            void engine.interruptGenerate();
            finishReason = "abort";
            break;
          }
          const choice = chunk.choices[0];
          const text = choice?.delta?.content ? filter(choice.delta.content) : "";
          if (text) onDelta(text);
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        }
        return { finishReason };
      } finally {
        signal.removeEventListener("abort", stop);
      }
    },
  };
}
