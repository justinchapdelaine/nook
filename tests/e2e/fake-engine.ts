// A scripted stand-in for the WebLLM engine, built into the extension only by
// `npm run build:e2e` (see extension/wxt.config.ts). It "downloads" in a
// moment, keeps its download state in Cache Storage like WebLLM does, and
// "translates" by upper-casing the user's text, streamed in small pieces.
// Text containing these words changes how it replies:
//   "loop"  repeats "la " until stopped, to test the repetition guard
//   "slow"  streams slowly, to test cancelling a reply part-way
//   "markdown"  wraps the reply in Markdown emphasis, as small models do
// The 0.8B model "downloads" over 3 s instead of 0.3 s, to test a download that outlives its page.
//
// A request with a JSON schema is tab grouping: each numbered line goes in a
// group named after the first word of its (first) title, such as "Recipe".
// Tab titles containing these words change the reply:
//   "badjson"  the reply is never valid JSON
//   "flaky"    the first try (temperature 0) puts a tab in two groups; the retry is valid
//   "slow"     the reply comes after 2 s
import type { Engine } from "../../extension/core/runtime/engine";

const CACHE = "nook-fake-models";
const cacheKey = (id: string) => `https://fake.invalid/${id}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createEngine(): Engine {
  return {
    hasF16: async () => false,
    isCached: async (build) => (await (await caches.open(CACHE)).match(cacheKey(build.id))) !== undefined,
    async load(build, onProgress) {
      const cache = await caches.open(CACHE);
      if (!(await cache.match(cacheKey(build.id)))) {
        const step = build.id.startsWith("Qwen3.5-0.8B") ? 1000 : 100;
        for (const fraction of [0, 0.5, 1]) {
          onProgress(`Fetching ${build.id}`, fraction);
          await sleep(step);
        }
        await cache.put(cacheKey(build.id), new Response("weights"));
      }
      onProgress(`Loaded ${build.id}`, 1);
    },
    unload: async () => {},
    async remove(build) {
      await (await caches.open(CACHE)).delete(cacheKey(build.id));
    },
    async generate(request, onDelta, signal) {
      const text = request.messages.at(-1)?.content ?? "";
      if (request.jsonSchema) {
        if (/\bslow\b/i.test(text)) await sleep(2000);
        if (signal.aborted) return { finishReason: "abort" };
        onDelta(fakeGrouping(text, request.temperature));
        return { finishReason: "stop" };
      }
      const looping = /\bloop\b/i.test(text);
      const delay = /\bslow\b/i.test(text) ? 300 : 10;
      const reply = /\bmarkdown\b/i.test(text) ? `*${text.toUpperCase()}*` : text.toUpperCase();
      for (let i = 0; looping || i < reply.length; i += 3) {
        if (signal.aborted) return { finishReason: "abort" };
        if (i / 3 >= request.maxTokens) return { finishReason: "length" };
        onDelta(looping ? "la " : reply.slice(i, i + 3));
        await sleep(delay);
      }
      return { finishReason: "stop" };
    },
  };
}

/** Groups the prompt's numbered lines by the first word of their first title. */
function fakeGrouping(prompt: string, temperature: number): string {
  if (/badjson/i.test(prompt)) return "{ not json";
  const groups = new Map<string, number[]>();
  for (const [, n, rest] of prompt.matchAll(/^(\d+)\. (.*)$/gm)) {
    // "site, 3 tabs: Title; Title" for a site's tabs that stay together, else "Title (site)".
    const title = rest?.replace(/^[^,]+, \d+ tabs: /, "") ?? "";
    const word = title.match(/[\p{L}\p{N}]+/u)?.[0] ?? "Other";
    const name = word[0]?.toUpperCase() + word.slice(1).toLowerCase();
    groups.set(name, [...(groups.get(name) ?? []), Number(n)]);
  }
  const list = [...groups].map(([name, tabs]) => ({ name, tabs }));
  if (/flaky/i.test(prompt) && temperature === 0 && list.length > 0) list.push({ name: "Again", tabs: [1] });
  return JSON.stringify({ groups: list });
}
