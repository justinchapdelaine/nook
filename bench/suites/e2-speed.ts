// E2, speed: decode and prefill tokens per second, and seconds to translate
// one screen of article text paragraph by paragraph, in the offscreen host.

import type { Lang } from "../lib/fixtures";
import { SCREENS } from "../lib/fixtures";
import type { BenchModel } from "../lib/models";
import { MODELS } from "../lib/models";
import { translatePlain } from "../lib/prompts";
import type { RunContext } from "./context";
import { clip, median, preferredVariant, request, usable, withModel } from "./context";

const DECODE = request([{ role: "user", content: "Write about 250 words on the history of the bicycle." }], 320);
const LONG_TEXT = SCREENS.flatMap((s) => s.paragraphs).join("\n\n");
const PREFILL = request([{ role: "user", content: `${LONG_TEXT}\n\nSummarise the text above in one sentence.` }], 32);
const SCREEN_TARGETS: Lang[] = ["fra", "jpn"];

function modelsToTest(ctx: RunContext): BenchModel[] {
  const list = [preferredVariant(ctx, "Qwen3.5-2B"), preferredVariant(ctx, "Qwen3.5-0.8B")];
  // With shader-f16, also time 2B in q4f32, the fallback for GPUs without it.
  if (ctx.shaderF16)
    list.splice(
      1,
      0,
      MODELS.find((m) => m.id === "Qwen3.5-2B-q4f32_1-MLC"),
    );
  return list.flatMap((m) => {
    const ok = usable(ctx, m, "a model");
    return ok ? [ok] : [];
  });
}

export async function runSpeed(ctx: RunContext) {
  const results: Record<string, unknown> = {};
  for (const model of modelsToTest(ctx)) {
    const client = ctx.offscreen;
    const run = await withModel(ctx, client, model, async () => {
      await client.request(request([{ role: "user", content: "Hello" }], 8)); // warm-up
      const decode = [];
      for (let i = 0; i < 3; i++) {
        ctx.status(`Decode run ${i + 1} of 3`);
        decode.push(await client.request(DECODE));
      }
      const prefill = [];
      for (let i = 0; i < 2; i++) {
        ctx.status(`Prefill run ${i + 1} of 2`);
        prefill.push(await client.request(PREFILL));
      }
      const screens = [];
      for (const target of SCREEN_TARGETS) {
        for (const [index, screen] of SCREENS.entries()) {
          ctx.status(`Screen ${index + 1} to ${target}`);
          const start = performance.now();
          let outputTokens = 0;
          let firstParagraph = "";
          for (const text of [screen.title, ...screen.paragraphs]) {
            const reply = await client.request(request(translatePlain(text, "eng", target), 512));
            outputTokens += reply.completionTokens;
            if (!firstParagraph && text !== screen.title) firstParagraph = reply.text;
          }
          const seconds = (performance.now() - start) / 1000;
          ctx.log(`${model.label}: screen ${index + 1} to ${target} in ${seconds.toFixed(1)} s.`);
          screens.push({ screen: index + 1, target, seconds, outputTokens, sample: clip(firstParagraph, 200) });
        }
      }
      const decodeTokS = median(decode.map((r) => r.decodeTokensPerS ?? Number.NaN));
      const prefillTokS = median(prefill.map((r) => r.prefillTokensPerS ?? Number.NaN));
      ctx.log(`${model.label}: decode ${decodeTokS?.toFixed(1)} tok/s, prefill ${prefillTokS?.toFixed(0)} tok/s.`);
      return {
        decodeTokS,
        decodeTokens: decode.map((r) => r.completionTokens),
        prefillTokS,
        prefillPromptTokens: prefill[0]?.promptTokens,
        ttftLongPromptMs: median(prefill.map((r) => r.ttftMs ?? Number.NaN)),
        secondsPerScreen: median(screens.map((s) => s.seconds)),
        screens,
      };
    });
    results[model.id] = { loadMs: run.loadMs, vramGB: run.vramGB, ...run.result };
  }
  return { host: "offscreen", temperature: 0, models: results };
}
