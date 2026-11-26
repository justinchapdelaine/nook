// E4, context size: loads 2B at several context sizes, records whether the
// load succeeds and the GPU memory, then fills most of the window with text
// and asks for a word hidden at the start.
import { sentence } from "../lib/fixtures";
import type { RunContext } from "./context";
import { preferredVariant, request, usable } from "./context";

const NEEDLE = "marmalade";
// English is about 4 characters per token; fill to about 60% to leave room for the template.
const CHARS_PER_TOKEN = 4;
const FILL = 0.6;

function fillPrompt(contextWindowSize: number): string {
  const target = contextWindowSize * FILL * CHARS_PER_TOKEN;
  let filler = "";
  for (let i = 0; filler.length < target; i++) filler += `${sentence(i).text.eng} `;
  return `Remember this: the secret word is "${NEEDLE}".\n\n${filler}\n\nWhat is the secret word? Reply with the word only.`;
}

export async function runContext(ctx: RunContext) {
  const model = usable(ctx, preferredVariant(ctx, "Qwen3.5-2B"), "Qwen3.5-2B");
  if (!model) return { skipped: "Qwen3.5-2B not available" };
  const sizes = [4096, 8192, 16384, ...(ctx.options.e4Large ? [32768] : [])];
  const client = ctx.offscreen;
  const baselineGB = await ctx.askVram("before loading any model (baseline)");
  const runs = [];
  for (const contextWindowSize of sizes) {
    const run: Record<string, unknown> = { contextWindowSize };
    try {
      ctx.log(`Loading ${model.label} at ${contextWindowSize} tokens…`);
      run.loadMs = (await client.request({ type: "load", modelId: model.id, contextWindowSize }, ctx.status)).ms;
      run.vramGB = await ctx.askVram(`${model.label} loaded at ${contextWindowSize} context`);
      ctx.status(`Filling ${contextWindowSize} context`);
      const reply = await client.request(request([{ role: "user", content: fillPrompt(contextWindowSize) }], 16));
      run.promptTokens = reply.promptTokens;
      run.prefillTokS = reply.prefillTokensPerS;
      run.ttftMs = reply.ttftMs;
      run.foundNeedle = reply.text.toLowerCase().includes(NEEDLE);
      ctx.log(
        `${contextWindowSize}: ${reply.promptTokens} prompt tokens, needle ${run.foundNeedle ? "found" : "missed"}.`,
      );
    } catch (error) {
      run.error = String(error);
      ctx.log(`${contextWindowSize}: ${run.error}`);
    } finally {
      await client.request({ type: "unload" }).catch(() => {});
    }
    runs.push(run);
  }
  return { model: model.id, baselineGB, runs };
}
