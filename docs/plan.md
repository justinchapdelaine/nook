# Implementation plan

2026-11-27. How Nook gets from the benchmark to a shippable extension. It builds on [discovery.md](discovery.md) and the measured numbers in [bench-results.md](bench-results.md). Rules and locked decisions stay in [CLAUDE.md](../CLAUDE.md); the design as built goes in [architecture.md](architecture.md), which each phase updates as it lands. This page is the plan, and it is edited when the plan changes.

## Where things stand

- Qwen3.5-2B runs through WebLLM in Helium at about 93 tokens per second, or 4.3 s per screen of article text. It is the default model.
- The engine lives in a dedicated worker inside an offscreen document. It survives idle time and service worker restarts, and reloads from cache in about 1 s.
- Every Helium API Nook needs works, except `chrome.tabs.detectLanguage`, which never answers. Nook detects page language itself.
- Open: how inline formatting survives translation and quality in the weaker languages. 0.8B ships as the light option (decided in phase 2). See [Open decisions](#open-decisions).

## Repo organization

One npm package, as now: one lockfile, one Biome config, one TypeScript config. The extension gets its own WXT root beside the bench. npm workspaces would add structure that two build roots don't need; they can come later if a third consumer appears.

```text
extension/                 WXT root for Nook
  entrypoints/
    background.ts          service worker: menus, commands, tabs, storage, routing
    offscreen/             hosts the engine worker
    translate.content.ts   page translator, injected on demand (not declared for all pages)
    options/               options page
  core/                    shared by all features; no feature imports another feature
    messages.ts            typed message and port contracts between contexts
    runtime/               the only code that imports WebLLM
    scheduler.ts           one GPU queue with priorities
    tasks/                 translate() and groupTabs(): prompts, output checks
    models.ts              reads models/models.json into the runtime's config
    settings.ts            typed settings in chrome.storage
  features/
    translate/             DOM translator: blocks, markers, restore, bubble, progress
    tabs/                  duplicates, rule grouping, AI grouping, undo
models/
  models.json              the product's model list (shared with the bench)
bench/                     Nook Bench, unchanged apart from where it reads models
scripts/                   fetch-model-libs.ts serves both builds
tests/                     Playwright tests for both builds
```

- **Dependency direction.** Entry points wire features to the browser. Features call `core/tasks` and never see a model. Only `core/runtime` imports WebLLM. Biome's restricted-imports rule, set per folder, enforces the last two, so a stray import fails the check rather than review.
- **Unit tests sit next to the code** (`*.test.ts`). DOM translator tests run in Vitest browser mode; pure logic (URL normalization, rules, output checks) runs in Node.
- **Scripts.** `npm run build`, `dev` and `zip` target the extension; `bench:build`, `bench:dev` and `bench:zip` target the bench. `check` and `test` cover both.

### How the bench shares model config

- `models/models.json` lists the models Nook ships, in the bench's current format: id, weights URL, packaged library and its SHA-256, `shader-f16` need, memory estimate and WebLLM overrides. Changing model stays a config change.
- The bench keeps its extra models (the Qwen3 1.7B baseline, and any candidate under test) in `bench/models.json`, which lists only those. The bench loads both lists; the extension loads only the shared one, so it never packages a bench-only library.
- `scripts/fetch-model-libs.ts` takes the list files as arguments, so each build fetches and checks only the libraries it packages.
- For now the bench keeps its own host and prompts. When the bench next runs (the marker round in phase 5), it switches to `core/runtime` and `core/tasks`, so new numbers measure the code that ships. Its own host code is then deleted.

## Phases

Each phase ends with a PR and is done when the listed things are true. The order follows the brief: the model-free foundation first, then the features in order of risk.

### 1. Foundation and model-free tab tools

- The `extension/` root builds, passes `check`, and loads in headless Chromium in a Playwright test.
- The message contracts the tab tools need exist. Nothing model-related is built yet; that waits for phase 2, the first phase that uses it.
- **Close duplicates** works with no model: URLs normalized (fragment, tracking parameters such as `utm_*`, `fbclid`, `gclid`, and a trailing slash only on the bare origin, since `/guide` and `/guide/` can be different pages), keeping the active tab, else the oldest. Canonical URLs are left for later, since reading them needs page access.
- **Group by site** works with no model, using `publicSuffix` to group tabs by registrable domain.
- **Undo last change** restores both: group moves are reversed from a saved snapshot; closed tabs come back through `sessions`, falling back to reopening by URL past its 25-entry limit. The undo record lives in `chrome.storage.session` so it survives a service worker restart.
- Entry points: toolbar icon menu (*Group tabs*, *Close duplicates*, *Undo last change*, *Settings*), the same tab actions on the tab right-click menu, and keyboard shortcuts. Each action gives brief feedback through the toolbar badge.
- `CHROMEWEBSTORE.md` starts here, with a justification for each permission this phase adds.
- `tabs` is an optional permission, requested on the first tab action. The request is the first call in the click handler, with nothing awaited before it, or Chrome drops the user gesture.

### 2. Model setup and selection translation

- The model list moves to `models/models.json` and the bench reads it from there.
- The offscreen host, engine worker, runtime and scheduler exist, with the bench's lessons built in: wait for the offscreen ready message, a heartbeat every 5 s per open request with a 60 s timeout, and only the offscreen document listening for host ports, so a closed host always disconnects its clients (this replaces the bench's `runtime.getContexts` check before reusing a port, which content scripts can't make).
- The model loads once with one context window for every task, 8K to start (a config value). Changing the window means reloading the model, so it is not set per task; E4 showed 8K costs about 0.1 GB more than 4K.
- The runtime picks the `q4f16` build when the GPU has `shader-f16` and the `q4f32` build otherwise.
- The offscreen document closes after 10 minutes idle (a setting) and reopens on demand.
- **Scheduler.** WebLLM runs one request at a time, and a running request can't be reordered. The scheduler orders the waiting queue by priority; when work the user is waiting on arrives (a selection), it cancels a running background request (a page batch) and puts that back in the queue.
- **First download**: a consent step on the options page with the download size, a progress display and the note that this is the only network use. Translation menu items open it when no model is downloaded yet.
- The options page also holds target language (default: browser UI language), model choice, site exclusions and cache management.
- **Translate selection** from the page context menu and a shortcut. The result streams into a small bubble in a closed shadow root, isolated from page styles. The text goes in as text nodes only.
- **Language detection**: `chrome.i18n.detectLanguage` on a sample of the text first, since many sites mark every page `lang="en"` whatever it says. The page's `lang` attribute is the fallback when detection isn't reliable, and otherwise the language is unknown. Detection runs when the user picks a menu item or shortcut, because that gesture is what grants access to the page. Menu labels therefore stay fixed (*Translate selection*, *Translate page*); if the page is already in the target language, Nook says so in the corner indicator instead of translating.
- A repetition guard stops a reply that repeats itself, and the token limit is sized to the input. Both answer the E3 loops.
- Quality checked by hand on real pages in the languages the owner reads.

### 3. AI tab grouping

- With no model downloaded, *Group tabs* keeps the phase 1 rule-only behaviour, so AI stays optional.
- Rules run first; one LLM request places the remaining tabs and names every group, using WebLLM's JSON schema output. Tabs are referred to by short indexes.
- The result is validated (every tab once, known indexes, non-empty names); on failure it retries once, then falls back to the rule groups.
- Done when a 20 to 50 tab window groups reliably, with undo, within the shared context window. If 50 tabs don't fit in 8K, the config value goes up for every task.

### 4. Full-page translation, plain text

- Blocks (paragraphs, headings, list items, cells) are collected, skipping code, form fields and editable areas. A block is skipped as already translated only when detection on it is reliable, since short text often isn't.
- Visible blocks are queued first and the rest follow by distance from the viewport, through the scheduler's priorities. Short blocks go in batches of 4, as a JSON array of fixed length (E6). Long blocks are split into sentences.
- Progress: blocks being translated pulse gently, then cross-fade; reduced motion gets a static dim. A small corner indicator shows progress and offers cancel.
- **Show original** swaps the original text back into the original nodes, instantly. A `MutationObserver` picks up blocks a page adds or re-renders.
- In this phase every block is translated as plain text: a block with inline formatting keeps its nodes, but their text is emptied and the translation goes into one new text node placed directly in the block, outside any bold, italic or link wrapper, so the whole block doesn't turn bold or clickable. Links in such blocks stop working until phase 5. Show original removes the added node and puts the original text back.
- Done when articles, docs and one dynamic site translate and restore cleanly.

### 5. Inline formatting

- A short bench round on the real `core/tasks` code tests the candidates in [Inline formatting](#inline-formatting) and picks one.
- The chosen approach replaces the plain-text path for blocks with inline formatting and links. Validation and the fallback stay.

### 6. Polish and store readiness

- Smooth model download, settings and errors (no WebGPU, too little GPU memory).
- `CHROMEWEBSTORE.md` completed with the privacy statement and listing text, and a pass of the store review checklist.
- Per-site auto-translate (with optional host permissions per site) and near-duplicates fit here or later.

## Permissions

| Permission | Needed for | Phase |
| --- | --- | --- |
| `contextMenus` | Toolbar, tab and page menus | 1 |
| `activeTab`, `scripting` | Running the translator in the current tab after a user gesture | 2 |
| `storage` | Settings and the undo record | 1 |
| `offscreen`, `unlimitedStorage` | The engine's home, and keeping weights from eviction | 2 |
| `tabGroups`, `sessions`, `publicSuffix` | Grouping, restoring closed tabs, grouping by site | 1 |
| `tabs` (optional) | Reading tab URLs and titles for duplicates and grouping | 1 |

No host permissions at install. The manifest keeps `'wasm-unsafe-eval'` in the extension page CSP. `CHROMEWEBSTORE.md` starts in phase 1, and each PR that adds a permission adds its plain-language justification there, so the store listing never has to catch up.

## Open decisions

### Inline formatting

How inline formatting and links survive full-page translation. E6: XML-style tags (`<b1>…</b1>`) kept quality but lost markers in about 4 sentences of 10; separate runs as a JSON array never lost formatting but scored much worse (chrF 36.9 against 51.9). Candidates for the phase 5 bench round:

1. Tags first, with plain text (formatting dropped) as the fallback.
2. Tags first, with separate runs as the fallback.
3. Tags, then a repair pass that puts missing markers back around the words they wrapped, by matching against the source.

**Needed by:** phase 5. Phase 4 ships plain text, so nothing waits on it.

### Weak languages

English into Japanese and Chinese scores about 31 chrF, partly because chrF counts characters; Swahili is not usable from either model. Model choice is config, so fixing this means testing a model, not changing code. Candidates: Qwen3.5-4B (about 3.9 GB of GPU memory, in the catalogue), Gemma 4 E2B, and TranslateGemma 4B as a custom build.

**Needed by:** before the store listing names supported languages (phase 6). Until then, 2B is the only model and weak languages are noted on the options page.

### Whether to offer 0.8B

0.8B is weaker in every pair (mean chrF 32.6 against 40.9 out of English) and no faster per screen, because it writes longer output. Its only case is a machine with too little GPU memory for 2B, and the rough readings did not show a clear memory saving. Options: don't ship it; ship it only for tab grouping; or ship it as a light option with a quality warning.

**Decided in phase 2:** ship it as the light option, with a note on the settings page that it translates noticeably worse. CLAUDE.md stays as it is. Dropping it later is a change to `models/models.json` and makes the package about 14 MB smaller.

## Testing

- `npm run check` and `npm test` on every PR, and the Playwright suite against the built extension in headless Chromium 158. Most task tests use a fake runtime that returns scripted replies, which is fast and also covers the fallbacks.
- **Real-model smoke test in the cloud.** Headless Chromium there has a software WebGPU adapter (SwiftShader) with no `shader-f16`, so it can run the `q4f32` builds but not `q4f16`. A small, separate Playwright suite loads Qwen3.5-0.8B `q4f32` in the offscreen host and runs a handful of short prompts: one sentence translated, a few tabs grouped with JSON output, a cancel mid-reply. It checks that the real model, runtime, prompts and output checks work end to end, not speed or quality. It is slow, so it runs on demand (`npm run test:smoke`) rather than on every PR, and it skips itself when the weights can't be downloaded. Phase 2 covers translation and the cancel; grouping joins it in phase 3. The cloud environment allows `huggingface.co` and its download host `us.aws.cdn.hf.co` for this.
- Speed, memory, quality and the `q4f16` builds need a real GPU: a manual run in Helium on the owner's machine, with the steps in the PR, or a bench build for numbers.
