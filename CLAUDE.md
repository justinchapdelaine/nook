# Nook repo rules

This file is the single place for the rules of this repo. Read it before any change. There is no AGENTS.md; do not add one.

Nook is a Chromium extension (Helium first) that adds AI features running only on the user's device.

## Where things live

- **CLAUDE.md** (this file): rules and locked decisions. Short, and always current. When a decision changes, update it here in the same PR.
- **[docs/architecture.md](docs/architecture.md)**: the current design and module boundaries. Update it when the design changes.
- **[docs/discovery-brief.md](docs/discovery-brief.md)**: the starting brief, a snapshot from 2026-11-26. Not kept up to date; use it for background and reasoning only.
- **[docs/plan.md](docs/plan.md)**: the implementation plan: repo layout, phases and open decisions. Edited when the plan changes.
- New findings, plans and longer decision records go in new files under `docs/`, linked from here or from the architecture page.
- **[CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)**: the store listing as it will be submitted, with a justification for every permission. A PR that adds or widens a permission updates it.
- **[bench/](bench/README.md)**: Nook Bench, the benchmark test harness for the experiments in discovery.md. Not the extension; its code need not carry over.

## Product principles

- **Local only.** Inference runs on the device. Downloading model files is the only network use, and the UI makes that difference clear.
- **Unobtrusive.** Features live in the page context menu, the toolbar icon and its context menu, and keyboard shortcuts, with minimal in-page feedback (a selection bubble, a progress indicator). Popups and panels are a last resort.
- **AI is optional.** Deterministic code handles everything it can. Duplicate detection and rule-based grouping work with no model loaded.
- **Reversible.** Tab moves, tab closes and page translations can always be undone or restored.
- **User work first.** When work competes for the GPU, what the user is waiting on goes first.
- **Modular.** The inference runtime and the model can be swapped without touching feature code.
- **Modern stack.** Prefer current tooling and web platform features, checked against what Helium actually supports.

## Locked decisions

These are fixed. If one turns out not to work, raise it with a concrete reason rather than working around it.

- **WebLLM is the only inference runtime.** No second runtime (such as Transformers.js) for now.
- **No cloud translation.** No Google Cloud Translation or any other remote API. Page text never leaves the device.
- **Translation is done by an LLM**, not a dedicated translation model.
- **The model list lives in config, not code.** The final model is not chosen; Qwen3.5-2B is the stand-in and 0.8B the light option. Changing model is a config change.
- **Never insert model output as HTML.** Translated text goes into text nodes only.
- **Restore by keeping the original nodes.** Never rebuild elements from saved `innerHTML`; keep the original nodes and swap their text back.
- **Chrome Web Store ready from the start.** Minimal, justified permissions. No remotely hosted code: JS and Wasm (including WebLLM `model_lib` files) ship inside the package; only model weights are downloaded.
- **Helium is the first browser to validate on.** Keep other Chromium browsers possible.
- **Embeddings are deferred.** Tab grouping uses rules plus the LLM, so there is one model to download and keep loaded.
- **Tabs only move when the user asks.** No automatic grouping of new tabs.

## Stack

Chosen after discovery; the reasoning is in [docs/discovery.md](docs/discovery.md#stack).

- **Language:** TypeScript 7.
- **Build:** WXT on Vite 8, with WXT's auto-imports turned off so every file imports what it uses.
- **Format and lint:** Biome. All code goes through it.
- **Tests:** Vitest (browser mode for DOM logic) and Playwright with headless Chromium for the built extension.
- **Runtime:** Node 26, the current LTS line.
- The extension page CSP includes `'wasm-unsafe-eval'`, which WebLLM needs.

## Engineering

- Keep changes to the requested work, with explicit contracts between modules rather than hidden coupling.
- Keep it simple, and build only what is needed now. Remove duplication where it helps, not by reflex.
- For extension work and any UI shown on web pages, use the Modern Web Guidance skills, including its Chrome extensions skill, rather than relying on memory of the APIs.
- Update docs when a change makes them wrong. Record important knowledge in the repo or in code comments, not only in conversation.

## Git and pull requests

- Branch from `main` as `branch/<short-descriptive-name>`, and target `main`.
- Commits follow Conventional Commits: `type(scope): description`. Folder names make good scopes. One kind of change per commit.
- PRs are squash-merged after review.
- PR descriptions follow [.github/pull_request_template.md](.github/pull_request_template.md): Why, What changes, Risk and review focus, Testing.

## Writing rules for PRs and commits

- Write for a reviewer who wasn't in the conversation. Use plain, everyday words and no internal shorthand.
- A PR description is about 150 to 300 words. A squash commit message is a few short paragraphs.
- No commit hashes, plan numbers or audit numbers. Use internal names only when the reviewer needs them.
- Describe behaviour, not a file-by-file list; the diff shows the files.
- State decisions directly, for example "It stays like this on purpose." Don't attribute them to a person. Docs may say "Owner decision".
- Re-read these rules and the template before writing or editing a PR description or commit message, and check again whenever the text changes.
