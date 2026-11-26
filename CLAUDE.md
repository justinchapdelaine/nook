# Nook repo rules

This file is the single place for the rules of this repo. Read it before any change. There is no AGENTS.md; do not add one.

Nook is a Chromium extension (Helium first) that adds AI features running only on the user's device. The background, open questions and reasoning are in [docs/discovery-brief.md](docs/discovery-brief.md). When a decision below changes, update this file in the same PR.

## Product principles

- **Local only.** Inference runs on the device. Downloading model files is the only network use, and the UI makes that difference clear.
- **Unobtrusive.** Features live in the page context menu, the toolbar icon and its context menu, and keyboard shortcuts, with minimal in-page feedback (a selection bubble, a progress indicator). Popups and panels are a last resort.
- **AI is optional.** Deterministic code handles everything it can. Duplicate detection and rule-based grouping work with no model loaded.
- **Reversible.** Tab moves, tab closes and page translations can always be undone or restored.
- **User work first.** When work competes for the GPU, what the user is waiting on goes first.
- **Modular.** The inference runtime and the model can be swapped without touching feature code.

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
- **Tabs only move when the user asks.** No automatic grouping of new tabs.

## Stack

Pending discovery. Not yet chosen: TypeScript or plain JavaScript, the build tool (Vite, WXT or similar), and the formatter and linter. Do not add build tooling until these are decided and recorded here. Once chosen, all code goes through the formatter and linter.

## Engineering

- Keep changes to the requested work, with explicit contracts between modules rather than hidden coupling.
- Keep it simple, and build only what is needed now. Remove duplication where it helps, not by reflex.
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
