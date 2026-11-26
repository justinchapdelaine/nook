// The model list lives in bench/models.json; this turns it into WebLLM's
// AppConfig. Model libraries are served from the extension package.
import type { AppConfig, ChatOptions } from "@mlc-ai/web-llm";
import config from "../models.json";

export type BenchModel = (typeof config.models)[number];
export const MODELS: BenchModel[] = config.models;

export function findModel(id: string): BenchModel {
  const model = MODELS.find((m) => m.id === id);
  if (!model) throw new Error(`Unknown model ${id}`);
  return model;
}

export const libUrl = (origin: string, lib: string) => `${origin}/model-libs/${lib}`;

/** `origin` is the extension origin, `self.location.origin` in any extension context. */
export function appConfig(origin: string): AppConfig {
  return {
    model_list: MODELS.map((m) => ({
      model: m.weights,
      model_id: m.id,
      model_lib: libUrl(origin, m.lib),
      vram_required_MB: m.vramMB,
      required_features: m.needsF16 ? ["shader-f16"] : undefined,
      overrides: m.overrides as ChatOptions,
    })),
  };
}
