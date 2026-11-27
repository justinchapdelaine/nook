# Implementation plan

2026-11-27. How Nook gets from the benchmark to a shippable extension. It builds on [discovery.md](discovery.md) and the measured numbers in [bench-results.md](bench-results.md). Rules and locked decisions stay in [CLAUDE.md](../CLAUDE.md); the design as built goes in [architecture.md](architecture.md), which each phase updates as it lands. This page is the plan, and it is edited when the plan changes.

## Where things stand

- Qwen3.5-2B runs through WebLLM in Helium at about 93 tokens per second, or 4.3 s per screen of article text. It is the default model.
- The engine lives in a dedicated worker inside an offscreen document. It survives idle time and service worker restarts, and reloads from cache in about 1 s.
- Every Helium API Nook needs works, except `chrome.tabs.detectLanguage`, which never answers. Nook detects page language itself.
- Open: how inline formatting survives translation, quality in the weaker languages, and whether 0.8B is worth offering. See [Open decisions](#open-decisions).

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
- Message contracts, the offscreen host, the engine worker, the scheduler and the runtime exist, with the bench's lessons built in: wait for the offscreen ready message, never disconnect a port meant for another context, a heartbeat every 5 s per open request with a 60 s timeout, and checking `runtime.getContexts` before reusing a port.
- The offscreen document closes after 10 minutes idle (a setting) and reopens on demand.
- **Close duplicates** works with no model: URLs normalized (fragment, tracking parameters such as `utm_*`, `fbclid`, `gclid`, trailing slash), keeping the active tab, else the oldest. Canonical URLs are left for later, since reading them needs page access.
- **Group by site** works with no model, using `publicSuffix` to group tabs by registrable domain.
- **Undo last change** restores both: group moves are reversed from a saved snapshot; closed tabs come back through `sessions`, falling back to reopening by URL past its 25-entry limit. The undo record lives in `chrome.storage.session` so it survives a service worker restart.
- Entry points: toolbar icon menu (*Group tabs*, *Close duplicates*, *Undo last change*, *Settings*), the same tab actions on the tab right-click menu, and keyboard shortcuts. Each action gives brief feedback through the toolbar badge.
- `tabs` is an optional permission, requested on the first tab action. The request is the first call in the click handler, with nothing awaited before it, or Chrome drops the user gesture.

### 2. Model setup and selection translation

- **First download**: a consent step on the options page with the download size, a progress display and the note that this is the only network use. Translation menu items open it when no model is downloaded yet.
- The options page also holds target language (default: browser UI language), model choice, site exclusions and cache management.
- **Translate selection** from the page context menu and a shortcut. The result streams into a small bubble in a closed shadow root, isolated from page styles. The text goes in as text nodes only.
- **Language detection**: the page's `lang` attribute, then `chrome.i18n.detectLanguage` on a text sample, with the result treated as unknown when not reliable. Menu labels name the detected language, and the page entry hides when the page is already in the target language.
- A repetition guard stops a reply that repeats itself, and the token limit is sized to the input. Both answer the E3 loops.
- Quality checked by hand on real pages in the languages the owner reads.

### 3. AI tab grouping

- Rules run first; one LLM request places the remaining tabs and names every group, using WebLLM's JSON schema output. Tabs are referred to by short indexes.
- The result is validated (every tab once, known indexes, non-empty names); on failure it retries once, then falls back to the rule groups.
- Done when a 20 to 50 tab window groups reliably, with undo. The context window is sized for 50 tabs; E4 showed a bigger window costs little memory.

### 4. Full-page translation, plain text

- Blocks (paragraphs, headings, list items, cells) are collected, skipping code, form fields, editable areas and blocks already in the target language.
- Visible blocks are queued first and the rest follow by distance from the viewport, through the scheduler's priorities. Short blocks go in batches of 4, as a JSON array of fixed length (E6). Long blocks are split into sentences.
- Progress: blocks being translated pulse gently, then cross-fade; reduced motion gets a static dim. A small corner indicator shows progress and offers cancel.
- **Show original** swaps the original text back into the original nodes, instantly. A `MutationObserver` picks up blocks a page adds or re-renders.
- In this phase every block is translated as plain text: a block with inline formatting keeps its nodes, its translation goes into the first text node and the others are emptied. Restore still works, because the nodes are kept.
- Done when articles, docs and one dynamic site translate and restore cleanly.

### 5. Inline formatting

- A short bench round on the real `core/tasks` code tests the candidates in [Inline formatting](#inline-formatting) and picks one.
- The chosen approach replaces the plain-text path for blocks with inline formatting and links. Validation and the fallback stay.

### 6. Polish and store readiness

- Smooth model download, settings and errors (no WebGPU, no `shader-f16` so `q4f32` is used, too little memory).
- `CHROMEWEBSTORE.md` with a justification for every permission, the privacy statement and the listing text, and a pass of the store review checklist.
- Per-site auto-translate (with optional host permissions per site) and near-duplicates fit here or later.

## Permissions

| Permission | Needed for | Phase |
| --- | --- | --- |
| `contextMenus`, `activeTab`, `scripting` | Menus, and running the translator in the current tab after a user gesture | 1, 2 |
| `offscreen`, `storage`, `unlimitedStorage` | The engine's home, settings and undo, and keeping weights from eviction | 1 |
| `tabGroups`, `sessions`, `publicSuffix` | Grouping, restoring closed tabs, grouping by site | 1 |
| `tabs` (optional) | Reading tab URLs and titles for duplicates and grouping | 1 |

No host permissions at install. The manifest keeps `'wasm-unsafe-eval'` in the extension page CSP.

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

**Needed by:** phase 2, when the options page gets its model choice. Default until decided: not shipped, which also saves about 14 MB of packaged libraries.

## Testing

- `npm run check` and `npm test` on every PR, and the Playwright suite against the built extension in headless Chromium 158. The cloud has no GPU, so tests cover everything except model output: tasks are tested with a fake runtime that returns scripted replies, which also covers the fallbacks.
- Anything that needs the real model is a manual run in Helium on the owner's machine, with the steps in the PR.
