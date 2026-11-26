// E5, quality: chrF against FLORES-200 references, English to and from ten
// languages, for 2B and 0.8B.
import { corpusChrf } from "../lib/chrf";
import type { Lang } from "../lib/fixtures";
import { OTHER_LANGUAGES, SENTENCES } from "../lib/fixtures";
import { translatePlain } from "../lib/prompts";
import type { RunContext } from "./context";
import { clip, mean, preferredVariant, request, usable, withModel } from "./context";

export async function runQuality(ctx: RunContext) {
  const perPair = Number(ctx.options.e5Count ?? 10);
  const allOutputs = Boolean(ctx.options.e5All);
  const sentences = SENTENCES.slice(0, perPair);
  const pairs: [Lang, Lang][] = OTHER_LANGUAGES.flatMap((l): [Lang, Lang][] => [
    ["eng", l],
    [l, "eng"],
  ]);
  const results: Record<string, unknown> = {};
  for (const family of ["Qwen3.5-2B", "Qwen3.5-0.8B"]) {
    const model = usable(ctx, preferredVariant(ctx, family), family);
    if (!model) continue;
    const client = ctx.offscreen;
    const run = await withModel(ctx, client, model, async () => {
      const scores: Record<string, { chrf: number; n: number; msPerSentence: number; outputs: string[] }> = {};
      for (const [from, to] of pairs) {
        const outputs: string[] = [];
        const start = performance.now();
        for (const [i, sentence] of sentences.entries()) {
          ctx.status(`${model.label}: ${from} to ${to}, ${i + 1} of ${sentences.length}`);
          try {
            outputs.push(
              (await client.request(request(translatePlain(sentence.text[from], from, to), 384))).text.trim(),
            );
          } catch (error) {
            outputs.push("");
            ctx.log(`${from}-${to} sentence ${sentence.line}: ${error}`);
          }
        }
        const chrf = corpusChrf(
          outputs,
          sentences.map((s) => s.text[to]),
        );
        ctx.log(`${model.label} ${from}-${to}: chrF ${chrf.toFixed(1)}`);
        scores[`${from}-${to}`] = {
          chrf,
          n: outputs.length,
          msPerSentence: (performance.now() - start) / outputs.length,
          outputs: (allOutputs ? outputs : outputs.slice(0, 2)).map((o) => clip(o, 240)),
        };
      }
      const values = Object.values(scores).map((s) => s.chrf);
      const toEnglish = Object.entries(scores).filter(([k]) => k.endsWith("-eng"));
      const fromEnglish = Object.entries(scores).filter(([k]) => k.startsWith("eng-"));
      return {
        meanChrf: mean(values),
        meanFromEnglish: mean(fromEnglish.map(([, s]) => s.chrf)),
        meanToEnglish: mean(toEnglish.map(([, s]) => s.chrf)),
        pairs: scores,
      };
    });
    results[model.id] = { loadMs: run.loadMs, ...run.result };
  }
  return {
    metric: "chrF2 (sacreBLEU defaults), corpus level per pair",
    sentencesPerPair: sentences.length,
    floresLines: sentences.map((s) => s.line),
    temperature: 0,
    models: results,
  };
}
