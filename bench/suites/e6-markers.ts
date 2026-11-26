// E6, inline markers and batching. Part A sends sentences with marked spans
// in three formats and checks every marker comes back, retrying once at
// temperature 0. Part B sends batches of 1, 4 and 8 sentences as a JSON
// array, with and without reference context, and times each block.
import { corpusChrf } from "../lib/chrf";
import type { Lang } from "../lib/fixtures";
import { markSentence, SENTENCES, sentence } from "../lib/fixtures";
import type { MarkerCheck, MarkerFormat } from "../lib/markers";
import { checkRuns, checkTagged, renderRuns, renderTagged, stringArraySchema } from "../lib/markers";
import { translateBatch, translateRuns, translateTagged } from "../lib/prompts";
import type { RunContext } from "./context";
import { clip, preferredVariant, request, usable, withModel } from "./context";

const MARKER_SENTENCES = 12;
const MARKER_TARGETS: Lang[] = ["fra", "deu", "jpn"];
const FORMATS: MarkerFormat[] = ["xml", "bracket", "runs"];
const BATCH_SENTENCES = 16;
const BATCH_TARGETS: Lang[] = ["fra", "jpn"];
const BATCH_SIZES = [1, 4, 8];
const PAGE_TITLE = "News and travel articles";

async function markers(ctx: RunContext, to: Lang, format: MarkerFormat, index: number) {
  const block = markSentence(sentence(index).text.eng, index);
  const runs = renderRuns(block);
  const attempt = async (temperature: number): Promise<{ check: MarkerCheck; ms: number; reply: string }> => {
    const messages =
      format === "runs"
        ? translateRuns(runs, "eng", to)
        : translateTagged(renderTagged(block, format), "eng", to, format);
    const jsonSchema = format === "runs" ? stringArraySchema(runs.length) : undefined;
    const reply = await ctx.offscreen.request(request(messages, 384, { temperature, jsonSchema }));
    const check = format === "runs" ? checkRuns(reply.text, runs.length) : checkTagged(reply.text, block, format);
    return { check, ms: reply.totalMs, reply: reply.text };
  };
  const first = await attempt(0.3);
  if (first.check.ok) return { first, retry: undefined };
  return { first, retry: await attempt(0) };
}

export async function runMarkers(ctx: RunContext) {
  const model = usable(ctx, preferredVariant(ctx, "Qwen3.5-2B"), "Qwen3.5-2B");
  if (!model) return { skipped: "Qwen3.5-2B not available" };
  const run = await withModel(ctx, ctx.offscreen, model, async () => {
    const formats: Record<string, unknown> = {};
    for (const format of FORMATS) {
      let firstTryOk = 0;
      let retryOk = 0;
      let totalMs = 0;
      const reasons: Record<string, number> = {};
      const hypotheses: string[] = [];
      const references: string[] = [];
      const failures: { to: string; input: string; reply: string; reason: string }[] = [];
      for (const to of MARKER_TARGETS) {
        for (let i = 0; i < MARKER_SENTENCES; i++) {
          ctx.status(`Markers ${format} to ${to}: ${i + 1} of ${MARKER_SENTENCES}`);
          const { first, retry } = await markers(ctx, to, format, i);
          totalMs += first.ms + (retry?.ms ?? 0);
          const final = retry ?? first;
          if (first.check.ok) firstTryOk++;
          else if (retry?.check.ok) retryOk++;
          if (!final.check.ok) {
            reasons[final.check.reason] = (reasons[final.check.reason] ?? 0) + 1;
            if (failures.length < 4) {
              const block = markSentence(sentence(i).text.eng, i);
              failures.push({
                to,
                input: format === "runs" ? JSON.stringify(renderRuns(block)) : renderTagged(block, format),
                reply: clip(final.reply, 240),
                reason: final.check.reason,
              });
            }
          }
          hypotheses.push(final.check.plain);
          references.push(sentence(i).text[to]);
        }
      }
      const count = MARKER_TARGETS.length * MARKER_SENTENCES;
      ctx.log(`Markers ${format}: ${firstTryOk}/${count} first try, ${retryOk} more after retry.`);
      formats[format] = {
        count,
        firstTryOk,
        retryOk,
        failed: count - firstTryOk - retryOk,
        reasons,
        chrf: corpusChrf(hypotheses, references),
        msPerBlock: totalMs / count,
        failures,
      };
    }

    const batching = [];
    for (const to of BATCH_TARGETS) {
      for (const size of BATCH_SIZES) {
        for (const withContext of [false, true]) {
          ctx.status(`Batches of ${size} to ${to}${withContext ? " with context" : ""}`);
          const hypotheses: string[] = [];
          const references: string[] = [];
          let mappingFailures = 0;
          const start = performance.now();
          for (let i = 0; i < BATCH_SENTENCES; i += size) {
            const batch = SENTENCES.slice(i, i + size);
            const texts = batch.map((s) => s.text.eng);
            const context = withContext
              ? { pageTitle: PAGE_TITLE, previous: i > 0 ? sentence(i - 1).text.eng : "" }
              : undefined;
            const reply = await ctx.offscreen.request(
              request(translateBatch(texts, "eng", to, context), 160 * texts.length, {
                jsonSchema: stringArraySchema(texts.length),
              }),
            );
            const check = checkRuns(reply.text, texts.length);
            if (!check.ok) {
              mappingFailures++;
              continue;
            }
            hypotheses.push(...(JSON.parse(reply.text) as string[]).map((t) => t.trim()));
            references.push(...batch.map((s) => s.text[to]));
          }
          const msPerBlock = (performance.now() - start) / BATCH_SENTENCES;
          const chrf = hypotheses.length ? corpusChrf(hypotheses, references) : null;
          ctx.log(
            `Batch ${size} to ${to}${withContext ? " +context" : ""}: ${msPerBlock.toFixed(0)} ms/block, chrF ${chrf?.toFixed(1)}`,
          );
          batching.push({ to, size, withContext, msPerBlock, chrf, mappingFailures });
        }
      }
    }
    return { formats, batching };
  });
  return {
    model: model.id,
    loadMs: run.loadMs,
    markerTargets: MARKER_TARGETS,
    firstTryTemperature: 0.3,
    retryTemperature: 0,
    ...run.result,
  };
}
