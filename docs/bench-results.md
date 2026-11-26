# Nook Bench results

The first full run of [Nook Bench](../bench/README.md) on the owner's machine, 2026-11-26. It answers most of the open questions in [discovery.md](discovery.md#open-questions). The raw results block is not kept in the repo; the numbers below are copied from it.

**Machine:** Windows, 14 cores, 32 GB RAM, NVIDIA Blackwell GPU (WebGPU adapter with `shader-f16`, 2 GB max buffer). The browser reports itself as Chrome 158.0.8127.88. All models were the `q4f16` builds, run with temperature 0 and thinking off unless noted.

GPU memory was read by hand from Task Manager, which shows the total in use. The figures below subtract what other programs were using: about 1.6 GB, or the 1.4 GB recorded at the start of E4 for that experiment. They are rough. The same 0.8B model read as about 1.3 GB in E1 and about 0.3 GB in E2, so a single reading can be off by a gigabyte. WebLLM's own estimates are 2.2 GB for 2B and 1.6 GB for 0.8B.

## Decisions this supports

- **Host the engine in an offscreen document, in a dedicated worker.** The service worker lost the model every time it was left alone, and once it was stopped in the middle of a reply. Now recorded in [architecture.md](architecture.md).
- **Qwen3.5-2B is the default model.** It beats 0.8B on quality in every language pair, and is faster per screen because 0.8B writes more. Keep 0.8B only as the light option for machines with little VRAM.
- **Tab grouping should use constrained JSON output.** Even without it, 2B produced valid groups 18 times out of 20.
- **The marker format is still open.** See [Markers and batching](#markers-and-batching-e6).

## Model download (one-time)

| Model | Download |
| --- | --- |
| Qwen3.5-2B | 50 s |
| Qwen3.5-0.8B | 20 s |
| Qwen3-1.7B | 44 s |

All five packaged `model_lib` files passed their SHA-256 check and compiled in about 3 ms each (E0).

## Hosting (E1)

Measured with 0.8B, loaded from cache.

| | Offscreen document | Service worker |
| --- | --- | --- |
| Load from cache | 0.9 to 1.2 s | 0.9 to 1.0 s |
| After 5 minutes idle | Model still loaded | Worker restarted, model gone; reload took 1.3 s |
| After stopping the service worker by hand | Model still loaded, first reply in 0.37 s | Restarted |

In the first run the service worker stopped in the middle of a short reply, and the page never heard about it. Opening the offscreen document took 9 ms. The first reply in a fresh offscreen document was slow (1.4 s to the first token, 2.3 s total) while the GPU shaders compiled; later replies took about 0.2 s.

## Speed (E2)

Offscreen host. A screen is one of three fixture articles of five paragraphs, translated into French and into Japanese.

| Model | Decode | Prefill | Seconds per screen | GPU memory (rough) |
| --- | --- | --- | --- | --- |
| Qwen3.5-2B | 93 tokens/s | 1,315 tokens/s | 4.3 s | 0.9 GB |
| Qwen3.5-0.8B | 100 tokens/s | 1,758 tokens/s | 6.3 s | 0.3 GB |

0.8B decodes barely faster than 2B on this GPU, and it often writes longer, looser output (one Japanese screen ran to 1,214 tokens against about 300 for 2B), so it ends up slower per screen.

## Stability (E3)

30 translations and 20 tab groupings per model, with grouping deliberately run without constrained output.

| Model | Translations stuck repeating | Valid tab groups |
| --- | --- | --- |
| Qwen3.5-2B | 1 of 30 | 18 of 20 (2 put a tab in two groups) |
| Qwen3.5-0.8B | 4 of 30 | 13 of 20 |
| Qwen3-1.7B | 3 of 30 | 5 of 20 (mostly broken JSON) |

- Turning thinking off works: no reasoning text appeared in any reply once the empty `<think></think>` prefix is removed.
- The failures are loops: the model repeats one word until it hits the token limit, mostly in Swahili and Tagalog. The real extension needs a repetition guard and a token limit sized to the input.
- With thinking on, all three models returned an empty `<think>` block for these short prompts. The harness counted that as reasoning; that is fixed for the next run.

## Context (E4)

Qwen3.5-2B, with a fact hidden in the middle of the prompt.

| Context window | Prompt | Found the fact | Time to first token | GPU memory (rough) |
| --- | --- | --- | --- | --- |
| 4K | 2,065 tokens | Yes | 1.8 s | 1.2 GB |
| 8K | 4,094 tokens | Yes | 3.5 s | 1.3 GB |
| 16K | 8,085 tokens | Yes | 7.5 s | 1.4 GB |

A bigger window costs little memory (about 0.1 GB per step) and prefill stays near 1,100 tokens/s, so the window can be set by what the task needs. Long prompts are what cost time.

## Quality (E5)

chrF on 10 FLORES-200 sentences per pair (higher is better).

| Pair | 2B | 0.8B | | Pair | 2B | 0.8B |
| --- | --- | --- | --- | --- | --- | --- |
| eng-fra | 61.4 | 53.1 | | fra-eng | 61.5 | 53.3 |
| eng-deu | 48.4 | 46.7 | | deu-eng | 53.7 | 45.6 |
| eng-spa | 50.1 | 46.1 | | spa-eng | 52.2 | 46.6 |
| eng-vie | 51.6 | 41.3 | | vie-eng | 52.4 | 42.1 |
| eng-ukr | 43.3 | 34.0 | | ukr-eng | 51.2 | 46.1 |
| eng-pol | 40.5 | 32.8 | | pol-eng | 51.5 | 45.3 |
| eng-tgl | 37.0 | 20.8 | | tgl-eng | 45.1 | 27.3 |
| eng-jpn | 31.2 | 17.5 | | jpn-eng | 47.8 | 45.0 |
| eng-zho | 31.0 | 25.6 | | zho-eng | 49.0 | 47.5 |
| eng-swh | 14.6 | 7.7 | | swh-eng | 31.3 | 18.5 |
| **Mean** | **40.9** | **32.6** | | **Mean** | **49.6** | **41.7** |

Translating into English is better than translating out of it. Japanese and Chinese score low partly because chrF counts characters, but Swahili output from both models is not usable. A translation-tuned model (see [Candidate models](discovery.md#candidate-models)) is worth testing for the weaker languages later.

## Markers and batching (E6)

Qwen3.5-2B, 36 sentences with inline formatting, into French, German and Japanese. A failed sentence is retried once.

| Format | Sentences that kept their formatting | chrF | Time per sentence |
| --- | --- | --- | --- |
| XML-style tags (`<b1>…</b1>`) | 21 of 36 | 51.9 | 0.9 s |
| Numbered brackets (`[1]…[/1]`) | 14 of 36 | 49.7 | 1.3 s |
| Separate runs as a JSON array | 36 of 36 | 36.9 | 0.9 s |

The JSON-array format never loses formatting but translates noticeably worse, because each run is translated without the rest of its sentence. XML-style tags keep the quality but drop markers in about 4 sentences out of 10, usually by leaving them out. A likely direction is tags first, with plain text (formatting dropped) or runs as the fallback; that needs its own test.

Batching plain blocks as a JSON array, into French:

| Batch size | Time per block | chrF |
| --- | --- | --- |
| 1 | 0.55 s | 64.8 |
| 4 | 0.47 s | 66.1 |
| 8 | 0.47 s | 65.2 |

Batches of 4 save about 15% with no quality loss and no blocks mapped back to the wrong element. Adding the page title and previous block as context made no clear difference. Japanese results were noisier (chrF 26 to 38), and with context one batch in each size came back with blocks that did not map to their elements.

## Helium APIs and permissions (E7)

- All four context menu items registered and fired, including two items on the tab right-click menu, which showed up as expected.
- Requesting the optional `tabs` permission from a toolbar menu click worked. The prompt read "Read your browsing history".
- The extension page lists "Read your browsing history on all your signed-in devices" and "View and manage your tab groups" as its permissions.
- A content script reached the offscreen document directly; a status request took 1.8 ms.
- `chrome.tabs.detectLanguage` never answers in Helium: the call was still pending after 20 seconds. In headless Chromium 158 the same call returns `fr` for the French test tab within a second, so this is Helium's doing. Nook should work out a page's language itself, from the page's `lang` attribute and `chrome.i18n.detectLanguage` on a sample of its text.
- `chrome.i18n.detectLanguage` works in Helium and identified all eleven test languages correctly, each as reliable (Tagalog is reported as `fil`).
- Tab groups work: three tabs grouped, named "Nook test" and coloured blue, and the group showed in the tab strip.
- `publicSuffix` works: `news.bbc.co.uk` gives `bbc.co.uk`, `foo.github.io` stays whole, `localhost` gives nothing.
- Closing a tab and restoring it through `sessions` worked, and the closed tab's URL was visible.
- The UI language reads as `en-GB`.
- The console showed only the expected warning that `powerPreference` is ignored on Windows.
