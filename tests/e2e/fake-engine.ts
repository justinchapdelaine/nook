// A scripted stand-in for the WebLLM engine, built into the extension only by
// `npm run build:e2e` (see extension/wxt.config.ts). It "downloads" in a
// moment, keeps its download state in Cache Storage like WebLLM does, and
// "translates" by upper-casing the user's text, streamed in small pieces.
// Text containing these words changes how it replies:
//   "loop"  repeats "la " until stopped, to test the repetition guard
//   "slow"  streams slowly, to test cancelling a reply part-way
//   "markdown"  wraps the reply in Markdown emphasis, as small models do
// The 0.8B model "downloads" over 3 s instead of 0.3 s, to test a download that outlives its page.
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
