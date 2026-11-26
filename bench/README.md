# Nook Bench

A test harness, not the Nook extension. It measures what [docs/discovery.md](../docs/discovery.md#experiments) left open, on a real GPU, from one page: experiments E1 to E7, plus a package check (E0). The real extension's architecture comes later and need not follow this code.

## Install in Helium

1. Unzip `nook-bench-<version>-chrome.zip` into a folder you keep (Helium loads it from there).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder (the one containing `manifest.json`).
4. Pin Nook Bench from the extensions menu and click its toolbar icon. The benchmark page opens in a new tab.

Then follow the steps at the top of the page: download models, run the experiments top to bottom, and press **Copy results**. The page keeps results across reloads; **Clear results** starts over.

Downloads: Qwen3.5 2B and 0.8B (preferably both quantizations your GPU supports) and Qwen3 1.7B for the E3 baseline. Weights come from huggingface.co and are stored in the extension's own storage; **Delete** removes them. Nothing else uses the network.

GPU memory can't be read from JavaScript, so with the toggle on, the page pauses after each model load and asks for the **Dedicated GPU memory** shown in Task Manager (Performance, GPU). Skip any reading you can't take.

## What each experiment does

| ID | Runs in | Measures |
| --- | --- | --- |
| E0 | both hosts | WebGPU adapter and features in each host; fetch, hash check and compile time of every packaged model library. No download. |
| E1 | both hosts | First and repeat load of the same model; whether each host keeps it after 5 minutes idle (and 60 for the offscreen host, optional); reload time when lost; what survives stopping the service worker by hand. |
| E2 | offscreen | Decode and prefill tokens per second; seconds per screen for three screens of article text, paragraph by paragraph, into French and Japanese. |
| E3 | offscreen | 30 translation and 20 tab grouping prompts with thinking off: reasoning text, empty replies, replies cut at the token limit, invalid JSON. 4 prompts with thinking on. Qwen3 1.7B as baseline. |
| E4 | offscreen | Load at 4K, 8K and 16K context (32K optional), GPU memory, and a filled-context check for a word hidden at the start. |
| E5 | offscreen | chrF against FLORES-200 references, English to and from ten languages, 2B and 0.8B. |
| E6 | offscreen | Marker survival for three inline marker formats (retry once at temperature 0); time per block and chrF for batches of 1, 4 and 8, with and without page context. |
| E7 | page | Tab and toolbar menus, tab groups, language detection, `publicSuffix`, closed-tab restore, optional `tabs` permission, a content script talking to the offscreen host, and the permission list. Partly manual. |

All generation uses temperature 0 unless the results say otherwise. The q4f16 models run only on GPUs with `shader-f16`; the page picks q4f32 otherwise.

## How it is built

- Both hosts run the same code ([lib/host.ts](lib/host.ts)): one WebLLM engine that serves requests over a runtime port named `host:sw` or `host:offscreen`. The offscreen document relays its port to a dedicated worker, so inference stays off the document's main thread.
- The model list is [models.json](models.json). Model libraries are not committed: `npm run fetch:libs` downloads them into `public/model-libs/` and checks each against its pinned SHA-256, and the build packages them. Only weights are fetched at run time.
- Fixtures ship in the package: [fixtures/flores.json](fixtures/flores.json) (24 FLORES-200 devtest sentences in 11 languages, CC BY-SA 4.0, made by `scripts/make-flores-fixture.ts`), [fixtures/screens.json](fixtures/screens.json) (article text written for this) and [fixtures/tabs.json](fixtures/tabs.json) (made-up tabs).

Three things learned while building it, worth keeping for the real extension:

- `chrome.offscreen.createDocument` can resolve before the document's script has added its `runtime.onConnect` listener, and a port opened in that gap never reaches it. The document now sends a ready message and the service worker waits for it.
- A port opened with `runtime.connect` reaches every extension context with a listener, including the service worker. If the service worker disconnects a port meant for the offscreen document, the port closes for everyone, so it must ignore it instead. That also means a client gets no disconnect when the offscreen document closes, so it checks `runtime.getContexts` before reusing a port.
- For the same reason, a client gets no disconnect when Chrome stops the service worker in the middle of a request (seen in Helium during E1). Each host sends an "alive" message every 5 seconds per open request, and the client fails its requests after 60 seconds of silence.

## Commands

```sh
npm run build      # fetch model libraries, then build to bench/.output/chrome-mv3
npm run zip        # same, plus bench/.output/nook-bench-<version>-chrome.zip
npm test           # unit tests (chrF against sacreBLEU, markers, grouping checks)
npm run test:e2e   # build, then load the extension in headless Chromium
npm run check      # Biome and TypeScript
```

The cloud test environment has no GPU (WebGPU there is SwiftShader, without `shader-f16`) and can't reach huggingface.co, so the automated tests cover the package check, the page, the E7 automatic checks and skipping of missing models, but no model ever loads there.
