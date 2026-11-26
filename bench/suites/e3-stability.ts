// E3, stability with thinking off: translation and grouping prompts,
// counting reasoning text, empty replies, replies cut off at the token
// limit, and broken JSON. A few prompts with thinking on check that the
// switch itself works. Qwen3-1.7B is the comparison baseline.
import { otherLanguage, sentence, tabLists } from "../lib/fixtures";
import { checkGrouping, groupTabs, hasReasoning, translatePlain } from "../lib/prompts";
import type { GenerateResult } from "../lib/protocol";
import type { RunContext } from "./context";
import { clip, mean, preferredVariant, request, usable, withModel } from "./context";

const TRANSLATIONS = 30;
const GROUPINGS = 20;

type Counts = { count: number; empty: number; reasoning: number; hitLimit: number; errors: number };
const counts = (): Counts => ({ count: 0, empty: 0, reasoning: 0, hitLimit: 0, errors: 0 });

function tally(c: Counts, reply: GenerateResult): void {
  c.count++;
  if (!reply.text.trim()) c.empty++;
  if (hasReasoning(reply.text)) c.reasoning++;
  if (reply.finishReason === "length") c.hitLimit++;
}

export async function runStability(ctx: RunContext) {
  const families = ["Qwen3.5-2B", ...(ctx.options.e3Small ? ["Qwen3.5-0.8B"] : []), "Qwen3-1.7B"];
  const lists = tabLists(GROUPINGS);
  const results: Record<string, unknown> = {};
  for (const family of families) {
    const model = usable(ctx, preferredVariant(ctx, family), family);
    if (!model) continue;
    const client = ctx.offscreen;
    const run = await withModel(ctx, client, model, async () => {
      const translation = counts();
      const grouping = { ...counts(), valid: 0, fenced: 0, reasons: {} as Record<string, number> };
      const failures: { prompt: string; reply: string; problem: string }[] = [];
      const decode: number[] = [];
      const note = (prompt: string, reply: string, problem: string) => {
        if (failures.length < 8) failures.push({ prompt, reply: clip(reply), problem });
      };

      for (let i = 0; i < TRANSLATIONS; i++) {
        ctx.status(`${model.label}: translation ${i + 1} of ${TRANSLATIONS}`);
        const target = otherLanguage(i);
        try {
          const reply = await client.request(request(translatePlain(sentence(i).text.eng, "eng", target), 256));
          tally(translation, reply);
          decode.push(reply.decodeTokensPerS ?? Number.NaN);
          if (!reply.text.trim() || hasReasoning(reply.text) || reply.finishReason === "length") {
            note(
              `translate to ${target}`,
              reply.text,
              reply.finishReason === "length" ? "hit limit" : "empty or reasoning",
            );
          }
        } catch (error) {
          translation.errors++;
          note(`translate to ${target}`, "", String(error));
        }
      }

      for (const [i, tabs] of lists.entries()) {
        ctx.status(`${model.label}: grouping ${i + 1} of ${lists.length}`);
        try {
          const reply = await client.request(request(groupTabs(tabs), 512));
          tally(grouping, reply);
          const check = checkGrouping(reply.text, tabs.length);
          if (check.fenced) grouping.fenced++;
          if (check.ok) grouping.valid++;
          else {
            grouping.reasons[check.reason ?? "?"] = (grouping.reasons[check.reason ?? "?"] ?? 0) + 1;
            note(`group ${tabs.length} tabs`, reply.text, check.reason ?? "invalid");
          }
        } catch (error) {
          grouping.errors++;
          note(`group ${tabs.length} tabs`, "", String(error));
        }
      }

      // Thinking on: reasoning text is expected here; if it never appears, the switch may do nothing.
      const thinkingOn = { count: 0, withReasoning: 0, errors: 0, sample: "" };
      const thinkingPrompts = [
        translatePlain(sentence(0).text.eng, "eng", "fra"),
        translatePlain(sentence(1).text.eng, "eng", "jpn"),
        ...lists.slice(0, 2).map(groupTabs),
      ];
      for (const messages of thinkingPrompts) {
        ctx.status(`${model.label}: thinking on, ${thinkingOn.count + 1} of ${thinkingPrompts.length}`);
        thinkingOn.count++;
        try {
          const reply = await client.request(request(messages, 1024, { enableThinking: true }));
          if (hasReasoning(reply.text)) thinkingOn.withReasoning++;
          thinkingOn.sample ||= clip(reply.text, 200);
        } catch (error) {
          thinkingOn.errors++;
          note("thinking on", "", String(error));
        }
      }

      ctx.log(
        `${model.label}: translation ${translation.reasoning} with reasoning, ${translation.empty} empty; ` +
          `grouping ${grouping.valid}/${grouping.count} valid JSON.`,
      );
      return { translation, grouping, thinkingOn, decodeTokS: mean(decode), failures };
    });
    results[model.id] = { loadMs: run.loadMs, ...run.result };
  }
  return { temperature: 0, thinking: "off unless noted", models: results };
}
