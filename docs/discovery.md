# Discovery findings

2026-11-26. This page answers the open questions in [discovery-brief.md](discovery-brief.md): what in the brief is outdated, what research can settle now, what only measurement can settle, and which stack to use. It is a findings record, not the implementation plan; that comes after review.

How each finding was checked:

- **Research**: read from a primary source (package contents, source code, issue trackers, model cards). Listed under [Sources](#sources).
- **Probe**: run in this repo's cloud environment, in headless Chromium 158.0.8127.36 (the same major version as Helium's current base) with a throwaway test extension. The cloud has no real GPU; WebGPU there is SwiftShader, a software adapter without `shader-f16`. So a probe proves that an API exists and behaves, never how fast it is.
- **Measure**: needs real hardware. Each one maps to an experiment in [Experiments](#experiments).

## Summary

1. **Nook can add items to the tab right-click menu.** The brief says this is impossible. Chromium 150 added a `"tab"` context to `chrome.contextMenus`, and Helium is on 157 to 158. Probe: registering items for it works.
2. **The default MV3 content security policy blocks WebAssembly.** WebLLM needs `'wasm-unsafe-eval'` in `content_security_policy.extension_pages`. This is allowed by the Web Store and is not remote code. Probe: without it, compiling the Qwen3.5 model library fails in an extension page; with it, it compiles.
3. **Bundling `model_lib` works as intended.** WebLLM fetches any `model_lib` URL that isn't `http(s)` with a plain `fetch` and skips its cache, so a `chrome-extension://` URL is fine. Each Qwen3.5 library is about 7 MB. Research and probe.
4. **The 4K context is a load-time setting, not part of the compiled library.** It can be raised when loading the model. Because only one in four Qwen3.5 layers keeps a key-value cache, raising it should cost much less memory than for a standard model. The exact cost needs measuring.
5. **Host the model in an offscreen document that runs WebLLM in a dedicated worker.** The service worker stays a thin router for `chrome.*` APIs. Research favours this strongly; experiment E1 confirms it on Justin's machine.
6. **0.8B is very likely too weak for translation.** On Qwen's own translation benchmark (WMT24++, 55 languages), Qwen3.5-0.8B scores 27.2, Qwen3.5-2B 45.8, and Qwen3-4B 58.9. 2B looks like the floor. Testing starts with 2B and 0.8B (owner decision); Qwen3.5-4B (about 3.9 GB of GPU memory, now in the WebLLM catalogue) can be added later as a config change if 2B falls short.
7. **Stack: TypeScript, WXT on Vite, Biome, Vitest and Playwright.** A spike with WXT 0.21.5, Vite 8.4, TypeScript 7.0 and WebLLM 0.2.89 builds in under a second and loads WebLLM in a worker inside an offscreen document in Chromium 158.

## What in the brief is outdated or wrong

| Brief says | Now | How checked |
| --- | --- | --- |
| "Chrome extensions cannot add items to the tab strip or tab right-click menu." | Wrong since Chromium 150: `contextMenus` has a `"tab"` context. The click handler gets the right-clicked tab (only that one, even when several are selected). `documentUrlPatterns` is not supported for it. An early report says Chrome 150 Canary crashed when an extension registered more than one `"tab"` item; check that in Helium (E7). | Research, probe |
| Qwen3.5 support in WebLLM is "recent". | The support request was closed in April 2026, and several releases have followed (current: 0.2.89, 2026-11-17). Relevant fixes since: JSON schema output for Qwen3.5 (fixed in 0.2.87) and a GPU hang regression from 0.2.83 (fixed). No open Qwen3.5 bugs found. | Research |
| Qwen3.5-0.8B and 2B are the catalogue options. | The catalogue now has Qwen3.5 0.8B, 2B, 4B and 9B. VRAM estimates for 0.8B (1,629 MB) and 2B (2,245 MB) match the brief. Also new and relevant: Gemma 4 E2B (3,387 MB), MiniCPM5-2B (1,586 MB), LFM2.5-1.2B (1,001 MB), Ministral 3 3B and SmolLM3-3B. | Research |
| The 4K context is a property of "those builds". | 4096 is an override in the model's catalogue record. The compiled library is the same for different context sizes (the 1K and 4K Llama 3.1 entries point at one file). It can be changed at load with `context_window_size`. One catch: WebLLM's service-worker engine skips the reload if only the context size changes (open issue #893). | Research |
| Chrome's built-in Translator API is "very likely unavailable" in Helium. | Worse than unavailable: `Translator` exists, `availability()` reports `downloadable` forever, and `create()` never resolves, because Helium blocks the component downloads. Helium closed the issue as not planned. Never feature-detect it without a timeout; simplest is not to touch it. | Research |
| (Not in the brief) | Helium has merged a translation provider framework for its own built-in page translation, off by default and with platform providers in progress (macOS first). It is browser code, not an extension API, so Nook can't plug into it. Worth watching: Helium may one day translate pages itself on some platforms. | Research |
| Offscreen document as the model's home (open question). | There is no offscreen reason for GPU or machine learning. The honest reason is `WORKERS`, which matches running WebLLM in a dedicated worker. Chrome allows one offscreen document per extension. `chrome.offscreen.hasDocument()` exists since Chromium 150. | Research, probe |
| `model_lib` `.wasm` must ship in the package. | Still true. Also: don't spread WebLLM's `prebuiltAppConfig` into Nook's config. It points every model at `raw.githubusercontent.com`; Nook's model config should list only packaged libraries. WebLLM now supports optional SRI hashes for the config, library and tokenizer. | Research |

Still correct: WebGPU works in extension service workers (probe: an adapter is returned in the service worker, the offscreen document and a worker inside it), `q4f16` needs `shader-f16` with `q4f32` as the fallback, custom models need a compiled library, and the Web Store remote code rules.

## Open questions

### Hosting: service worker or offscreen document?

**Recommendation: offscreen document, with WebLLM's `MLCEngine` in a dedicated worker inside it.** Research settles the direction; E1 confirms the numbers.

- The service worker is stopped after about 30 seconds without events. WebLLM's service-worker engine sends a keep-alive only while a client page is connected, and content scripts come and go with tabs. When the worker stops, the model (2+ GB of GPU memory) is dropped and has to load again.
- An offscreen document's lifetime is independent of the service worker. Per Chrome's offscreen documentation, only documents opened for audio playback close on their own; E1 checks this by leaving the document idle.
- Content scripts can open a port straight to the offscreen document (`runtime.connect` reaches every extension page), so streamed tokens don't need a hop through the service worker.
- The service worker keeps all `chrome.*` work (menus, tabs, groups, storage), since offscreen documents only get `runtime` messaging.
- Running the engine in a worker keeps inference off the document's main thread and fits the `WORKERS` reason.
- Keeping 2+ GB of GPU memory allocated forever is unfriendly. The document should close after an idle period (for example 10 minutes, as a setting) and reopen on demand. E1 measures how long that reopen takes.

### Translation speed

**Measure (E2).** There is no published number for Qwen3.5 in WebLLM on Justin's hardware. For a sense of scale, the WebLLM paper reports 71 tokens per second for Phi-3.5-mini (3.8B) on an M3 Max. A screen of article text is roughly 300 to 600 output tokens, so a 2B model on a capable GPU plausibly needs several seconds to over ten seconds per screen. That is an estimate to be replaced by E2. WebLLM runs one request at a time per model, so the scheduler's "visible blocks first" ordering matters more than any batching gain.

### Qwen3.5 stability and turning off thinking

**Mostly answered; confirm in E3.** `extra_body: { enable_thinking: false }` is still the switch in 0.2.89. WebLLM implements it generically by inserting an empty `<think>` block before the reply, which matches the Qwen chat template. E3 checks that no reasoning text appears and compares output against Qwen3-1.7B to separate model problems from Nook problems.

### Context window

**Answered: yes, at load time. Cost: measure (E4).** Set `context_window_size` in the chat options when loading. Qwen3.5 keeps a key-value cache in only a quarter of its layers (the rest use linear attention with a fixed-size state), so the cost per extra token should be small. E4 loads 2B at 4K, 8K and 16K and records load success and VRAM. Translation chunks don't need a long context, so this matters mostly for tab grouping with many tabs.

### Translation quality: is 0.8B enough?

**Very likely not; measure 2B and 0.8B (E5).** Qwen's model cards give WMT24++ scores of 27.2 for 0.8B and 45.8 for 2B, against 58.9 for Qwen3-4B. Treat 0.8B as an option for tab naming only, not translation. E5 scores 2B and 0.8B across common and less common languages. Larger or alternative models come later, only if 2B falls short.

### Inline tags

**Measure (E6).** Three formats to compare, each validated before use:

1. Numbered XML-like tags, such as `<b1>bold</b1>`. Familiar to models from HTML.
2. Short bracket markers, such as `[1]bold[/1]`.
3. JSON output constrained by WebLLM's schema support: an array of exactly N strings, one per inline run. The structure can't break, but word order between runs is fixed, which suits some languages better than others.

Validation: the same set of markers comes back, correctly nested. Fallback: retry once at temperature 0; if it fails again, translate the block as plain text and put it in the block's first text node. Restore still works, because the original nodes are kept.

### Batching and reference context

**Measure (E6).** Compare batches of 1, 4 and 8 short blocks, with and without the page title and previous block as reference, sending batches as a JSON array of fixed length so every block maps back to its element. Record time per block and the quality score.

### Helium APIs

**Partly answered by the probe, confirm in Helium (E7).** In Chromium 158: WebGPU adapters exist in the service worker, offscreen document and its workers; `contextMenus` accepts `"tab"` and `"action"` items (the toolbar menu allows 6 top-level items); `tabs.group` plus `tabGroups.update` work; `i18n.detectLanguage` runs locally and correctly identified French, German, Japanese, Polish and Swahili sentences; `chrome.i18n.getUILanguage()` works. Helium removes Google services, so E7 rechecks all of these in Helium itself, with particular attention to language detection, since newer Chromium may route it through a downloaded model.

### Bundled `.wasm`

**Answered.** WebLLM fetches non-`http` library URLs directly (from source), the 7 MB Qwen3.5 library compiles from the package once `'wasm-unsafe-eval'` is set (probe), and the Cache API can't store `chrome-extension://` URLs anyway (probe), so there is nothing to cache. Package cost is about 7 MB per model and quantization; shipping 2B in both `q4f16` and `q4f32` adds about 15 MB. The WebLLM bundle itself is about 6 MB.

### Minimum permissions

**Proposed set, confirm warnings in E7.**

| Feature | Permissions | Install warning |
| --- | --- | --- |
| Translation | `contextMenus`, `activeTab`, `scripting`; keyboard shortcuts need no permission | None. Menu clicks and shortcuts grant temporary access to the current tab, so no host permissions are needed. |
| Per-site auto-translate (later) | Optional host permissions, requested per site | Shown only when the user turns it on for a site. |
| Tab grouping and duplicates | `tabs`, `tabGroups` | `tabs` shows "Read your browsing history". It could be optional and requested the first time the user groups tabs; E7 checks that the request works from a toolbar or menu click. |
| Undo of closed tabs | `sessions` (to restore with history) | Check in E7. Recently closed lists are capped at 25 entries, so a larger bulk close needs a fallback of reopening by URL. |
| Grouping by site | `publicSuffix` (new in Chromium 153) gives registrable domains without bundling a list | Check in E7. Probe: `news.bbc.co.uk` gives `bbc.co.uk`, `foo.github.io` stays whole. |
| Model runtime | `offscreen`, `storage`, `unlimitedStorage` | None. `unlimitedStorage` protects 2 GB of weights from eviction. |

Model downloads from Hugging Face need no host permission, as long as Hugging Face keeps sending CORS headers.

### Build tooling

See [Stack](#stack).

### Candidate models

**From the catalogue, for later if 2B falls short:** Qwen3.5-4B (quality option) and Gemma 4 E2B (Gemma models are strongly multilingual). Qwen3-1.7B stays in E3 as the comparison baseline for stability.

**Translation-tuned, outside the catalogue:**

- **TranslateGemma 4B** (Google, January 2026, 55 languages). Built on Gemma 3, which MLC already supports, so it could be compiled into a packaged library. Roughly 2.5 to 3 GB of weights at 4-bit (estimate). The best candidate for a custom model if E5 shows general models fall short.
- **HY-MT1.5-1.8B** (Tencent, 33 languages, made for devices). MLC has no support for its architecture, so it would need new model code. Not worth it now.

## Stack

| Area | Recommendation | Why |
| --- | --- | --- |
| Language | TypeScript 7 (the native compiler, 7.0.2) | The module boundaries are message contracts between the service worker, offscreen document, worker and content scripts; types make them explicit. WebLLM and Chrome APIs ship types. Type checks with the native compiler are fast. |
| Build | WXT 0.21 on Vite 8 | Handles the multi-entry MV3 build: manifest generation, content scripts bundled as single files, offscreen and options pages, dev reload and zipping. WXT is still 0.x, so minor versions can break; pin the version and upgrade on purpose. |
| Fallback build | Plain Vite with a small manifest step, or the CRXJS Vite plugin (3.0) | If WXT's conventions get in the way. Content script bundling is the part that is painful to do by hand. |
| Format and lint | Biome 2 | One fast tool for formatting and linting TypeScript, JSON and CSS, with one config file. ESLint plus Prettier works too but is two tools and slower. |
| Unit tests | Vitest 5, in browser mode for DOM translator logic | Real DOM behaviour (text nodes, Shadow DOM, restore) matters more than a fake DOM. |
| Extension tests | Playwright with the bundled Chromium | Loads the built extension headless, as the probe in this discovery did. |
| Runtime | Node 22 or later, as WXT requires | |

Spike result: a WXT project with a background service worker, an offscreen page, a module worker importing WebLLM and a runtime-registered content script built in 0.6 seconds. Total output was 6.1 MB, nearly all WebLLM. Loaded in Chromium 158, the worker imported WebLLM and saw WebGPU, and TypeScript 7 type-checked the project using WXT's generated config.

WXT detail to decide during setup: turn off its auto-imports, so every module's dependencies are visible in its imports.

## Experiments

Everything that needs a real GPU runs from one **benchmark extension**: a packaged build with a benchmark page that runs a fixed suite and prints one copyable results block (JSON) with the browser version, GPU adapter details and `shader-f16` support. Justin installs it in Helium on his own machine and pastes the block back. Fixtures ship inside the extension so runs are comparable.

For quality, the fixtures include sentences from the FLORES-200 benchmark (CC BY-SA 4.0, credited in the extension) with reference translations, and the page computes a chrF score against the references. chrF is a simple character-overlap metric that runs in plain JavaScript, so no second model is needed and nobody has to judge languages they don't read. Raw outputs are included for spot checks.

GPU memory can't be read from JavaScript. Where VRAM matters, the page pauses and asks Justin to read dedicated GPU memory in Task Manager, then records the number he types.

| ID | Question | What it does | Answer it gives |
| --- | --- | --- | --- |
| E1 | Hosting | Loads Qwen3.5-2B from cache in the offscreen document's worker and in the service worker. Records cold load, load from cache, behaviour after 5 and 60 minutes idle, and recovery after the service worker is stopped from `chrome://extensions`. | Confirms the offscreen choice and gives the reopen time for the idle-unload setting. |
| E2 | Speed | Prefill and decode tokens per second for 0.8B and 2B (`q4f16`, plus `q4f32` for 2B), and seconds per screen on three fixture pages. | Whether full-page translation feels usable, and on which model. |
| E3 | Qwen3.5 stability | 50 translation and grouping prompts with thinking off; counts any reasoning text, empty replies or broken JSON. Repeats with Qwen3-1.7B. | Whether Qwen3.5 is reliable enough to build on. |
| E4 | Context | Loads 2B at 4K, 8K and 16K; records success and VRAM. | The context size to put in config. |
| E5 | Quality | chrF on FLORES sentences for 2B and 0.8B, English to and from French, German, Spanish, Japanese, Chinese, Polish, Ukrainian, Vietnamese, Swahili and Tagalog. | The default model, and whether a translation-tuned model is needed. |
| E6 | Markers and batching | Inline-markup fixtures in the three marker formats; batch sizes 1, 4 and 8, with and without reference context. Records marker survival rate, time per block and chrF. | The marker format, fallback rate and batch size. |
| E7 | Helium APIs and permissions | A manual checklist page: right-click a tab with two Nook items, group tabs, detect page and text language, request `tabs` as an optional permission from a toolbar click, restore closed tabs, and the install warning text for the proposed permission set. | Confirms the Chromium probe holds in Helium. |

E7 needs no GPU and could also run in the Windows VM once Helium is installed there.

## What this implies for the plan

- The proof of concept is the benchmark extension. Building it covers the brief's phase 1 and doubles as the first use of the stack.
- The tab right-click menu can carry *Group tabs* and *Close duplicates*, alongside the toolbar menu.
- The manifest needs `'wasm-unsafe-eval'`, and Nook's model config lists only packaged libraries.
- Once the stack is agreed, CLAUDE.md's Stack section and architecture.md's hosting decision get updated in the same change that sets the repo up.

## Sources

- WebLLM 0.2.89 package contents (model catalogue, `model_lib` loading, `enable_thinking`, integrity checks): [npm](https://www.npmjs.com/package/@mlc-ai/web-llm), [GitHub](https://github.com/mlc-ai/web-llm)
- WebLLM issues: [Qwen3.5 support #778](https://github.com/mlc-ai/web-llm/issues/778), [Qwen3.5 JSON schema #868](https://github.com/mlc-ai/web-llm/issues/868) and [fix #876](https://github.com/mlc-ai/web-llm/pull/876), [service-worker reload skips context changes #893](https://github.com/mlc-ai/web-llm/issues/893), [larger context libraries #752](https://github.com/mlc-ai/web-llm/issues/752)
- Compiled model libraries: [binary-mlc-llm-libs](https://github.com/mlc-ai/binary-mlc-llm-libs/tree/main/web-llm-models)
- [WebLLM paper](https://arxiv.org/abs/2412.15803) (throughput figures)
- Chrome extension API surface, with "since" versions: [@types/chrome](https://www.npmjs.com/package/@types/chrome) (developer.chrome.com was not reachable from the research environment)
- [PSA: "tab" context in chrome.contextMenus (M150)](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/RReE8dtY4Ok)
- Helium: [chromium_version.txt](https://github.com/imputnet/helium/blob/main/chromium_version.txt), [translation provider PR #2877](https://github.com/imputnet/helium/pull/2877), [Translator API issue #2834](https://github.com/imputnet/helium/issues/2834)
- Qwen3.5 model cards with WMT24++ scores: [0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B), [2B](https://huggingface.co/Qwen/Qwen3.5-2B)
- [TranslateGemma announcement](https://blog.google/innovation-and-ai/technology/developers-tools/translategemma/), [HY-MT1.5-1.8B](https://huggingface.co/tencent/HY-MT1.5-1.8B), MLC model support ([mlc-llm models](https://github.com/mlc-ai/mlc-llm/tree/main/python/mlc_llm/model))
- [WXT upgrade guide](https://wxt.dev/guide/resources/upgrading), [Biome](https://biomejs.dev/), [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/)
- [FLORES-200](https://github.com/facebookresearch/flores)
