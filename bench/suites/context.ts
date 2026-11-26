// What every experiment gets from the page: hosts, logging, prompts for
// manual readings, and the models available to it.
import type { HostClient } from "../lib/client";
import type { BenchModel } from "../lib/models";
import { MODELS } from "../lib/models";
import type { GenerateRequest, GenerateResult } from "../lib/protocol";

export type RunContext = {
  offscreen: HostClient;
  sw: HostClient;
  /** Whether the GPU supports shader-f16, so q4f16 models can run. */
  shaderF16: boolean;
  /** Model ids whose weights are already downloaded. */
  cached: Set<string>;
  log: (message: string) => void;
  /** Shows progress text for the current step without adding to the log. */
  status: (message: string) => void;
  /** Asks for the GPU memory in use, in GB. Null if skipped or turned off. */
  askVram: (moment: string) => Promise<number | null>;
  /** Shows manual instructions; resolves true when done, false if skipped. */
  askStep: (instructions: string) => Promise<boolean>;
  sleep: (ms: number, label: string) => Promise<void>;
  options: Record<string, string | boolean>;
};

/** The variant of a model family this GPU should use: q4f16 when supported, else q4f32. */
export function preferredVariant(ctx: RunContext, family: string): BenchModel | undefined {
  const variants = MODELS.filter((m) => m.family === family && (ctx.shaderF16 || !m.needsF16));
  return variants.find((m) => m.needsF16) ?? variants[0];
}

/** Returns the model if downloaded; otherwise logs why it is skipped. */
export function usable(ctx: RunContext, model: BenchModel | undefined, family: string): BenchModel | undefined {
  if (!model) {
    ctx.log(`Skipping ${family}: no variant runs on this GPU.`);
    return undefined;
  }
  if (!ctx.cached.has(model.id)) {
    ctx.log(`Skipping ${model.label}: not downloaded.`);
    return undefined;
  }
  return model;
}

export function request(
  messages: GenerateRequest["messages"],
  maxTokens: number,
  extra: Partial<GenerateRequest> = {},
): { type: "generate"; request: GenerateRequest } {
  return { type: "generate", request: { messages, maxTokens, temperature: 0, enableThinking: false, ...extra } };
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

export function mean(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

export const clip = (text: string, length = 300) => (text.length > length ? `${text.slice(0, length)}…` : text);

export const speed = (r: GenerateResult) => ({
  promptTokens: r.promptTokens,
  completionTokens: r.completionTokens,
  prefillTokS: r.prefillTokensPerS,
  decodeTokS: r.decodeTokensPerS,
  ttftMs: r.ttftMs,
  totalMs: r.totalMs,
});

/** Loads a model in a host, reports load time and GPU memory, runs `body`, then unloads. */
export async function withModel<T>(
  ctx: RunContext,
  client: HostClient,
  model: BenchModel,
  body: () => Promise<T>,
  contextWindowSize?: number,
): Promise<{ loadMs: number; vramGB: number | null; result: T }> {
  ctx.log(`Loading ${model.label} in the ${client.host} host…`);
  const { ms } = await client.request({ type: "load", modelId: model.id, contextWindowSize }, ctx.status);
  ctx.log(`Loaded in ${(ms / 1000).toFixed(1)} s.`);
  const vramGB = await ctx.askVram(
    `${model.label} loaded${contextWindowSize ? ` at ${contextWindowSize} context` : ""}`,
  );
  try {
    return { loadMs: ms, vramGB, result: await body() };
  } finally {
    await client.request({ type: "unload" });
  }
}
