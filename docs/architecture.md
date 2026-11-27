# Architecture

This is the current design and is kept up to date as it changes. The reasoning behind it is in [discovery-brief.md](discovery-brief.md). The planned file layout and phases are in [plan.md](plan.md); this page changes as they land.

## Module boundaries

The features are separated from inference so the runtime and the model can change without touching feature code. Only the inference runtime knows about WebLLM.

```mermaid
flowchart TD
    menu["Page context menu"] --> dom["DOM translator<br/>Blocks, inline markers, exact restore"]
    toolbar["Toolbar icon, its menu, shortcuts"] --> tabs["Tab manager<br/>Rules, then LLM; duplicates; undo"]
    dom --> task["Task layer<br/>translate(segments, source, target) and groupTabs(tabs); picks model and prompt"]
    tabs --> task
    task --> sched["Scheduler<br/>One GPU queue; what the user is waiting on runs first"]
    sched --> runtime["Inference runtime<br/>WebLLM in a worker inside the offscreen document"]
    config["Model config<br/>Weights downloaded, .wasm bundled"] --> runtime
```

- Requests flow down from the browser surfaces (page context menu, toolbar icon and its menu, keyboard shortcuts).
- The DOM translator only sends text segments and receives translations. It never sees a model.
- The task layer turns feature requests into prompts and picks the model.
- The scheduler runs one GPU queue, so what the user is waiting on goes first.
- The model list is configuration. A fine-tuned or newer model is a config change.

## Hosting

The inference runtime runs WebLLM in a dedicated worker inside an offscreen document. The service worker stays a thin router for `chrome.*` APIs and opens the offscreen document on demand. In [Nook Bench](bench-results.md#hosting-e1) the offscreen document kept the model through idle time and through a service worker restart, while the service worker lost it every time, once in the middle of a reply.

- **Ports.** Clients (the settings page, the translator in a page) talk to the host over a runtime port named `nook:host`. Ports from `runtime.connect` reach every extension context with an `onConnect` listener, and a port stays open while any of them holds it. So the offscreen document is the only context that listens for ports: when it closes, every client's port disconnects. The bench learned this the hard way, with the service worker holding ports to a closed host.
- **Heartbeat.** A host can also hang without closing. The host sends `alive` every 5 s for each open request; a client fails a request after 60 s of silence.
- **Opening.** The service worker opens the document when a client asks (`offscreen:ensure`) and replies once the document says it listens (`offscreen:ready`), since a port opened earlier never reaches it. Opening and closing run one after the other.
- **Idle close.** A client disconnects once it has nothing pending. When the document has no client and no queued or running work for the idle time (a setting, 10 minutes by default, passed in the document's URL), it turns new ports away and asks the service worker to close it, which frees the GPU memory. A request turned away, or caught by the close before the host answered it, is sent once more to a fresh document. Loading from cache takes about 1 to 2 s.
- **Model choice.** A model "family" (Qwen3.5-2B) is what settings store. The host loads the family's `q4f16` build when the GPU has `shader-f16` and its `q4f32` build otherwise, always with the context window from `models/models.json` (8K), so one load serves every task.
- **Downloads.** Only the settings page asks the host to download, after the user presses Download. A translation request for a model that isn't cached fails with `not-downloaded`, and the translator opens the settings page at that step.
- **Scheduler** (`extension/core/scheduler.ts`). One queue: work the user is waiting on (`user`) before `background` work, then first come, first served. When user work arrives while background generation runs, the running request is stopped, put back at the front of its queue and later starts again from the beginning; its client hears `restart` and drops what it had. Loads, downloads and deletes are never stopped part-way. A client that cancels, or whose port closes, takes its requests out of the queue or stops the running one.
- **Engine contract** (`extension/core/runtime/engine.ts`). The host uses an engine through a small interface (GPU check, cache check, load, unload, remove, streaming generate with an abort signal). `webllm.ts` is the real one and the only file that imports WebLLM; it also removes the empty `<think></think>` block Qwen3.5 starts each reply with. The end-to-end tests build with a scripted fake in its place.

## Contexts and messages

- **Service worker** (`extension/entrypoints/background.ts`): registers the menus, listens for menu clicks, keyboard shortcuts and messages, runs the tab tools and reports each result on the toolbar badge, injects the translator, and opens and closes the offscreen document. It keeps no state in memory that matters past one event; the undo record is in `chrome.storage.session` and settings are in `chrome.storage.local`.
- **Offscreen document** (`extension/entrypoints/offscreen/`) and its **engine worker** (`extension/core/runtime/worker.ts`): the model host. The document relays each client port to the worker, tagged with a port id.
- **Translator** (`extension/entrypoints/translate.ts`): a script the service worker injects into the frame where the user picked *Translate selection*. It is not declared for all pages; the click or shortcut grants `activeTab`, which is what lets it in.
- **Settings page** (`extension/entrypoints/options/`): translation language, sites where translation is off, the model, its download and deletion, the idle time, tab access and the shortcuts.
- Messages between contexts are typed in `extension/core/messages.ts` (tab actions, translating a selection, opening the model setup) and `extension/core/runtime/protocol.ts` (the host protocol and the offscreen document's lifecycle).
- Biome stops any file outside `extension/core/runtime/` from importing WebLLM, so the runtime stays swappable.

## Translate selection

- **Triggers.** *Translate selection* on the page context menu when text is selected, and Alt+Shift+L (Chromium keeps Alt+Shift+T for focusing the toolbar). On a site in the settings' list, nothing is injected and the badge shows `off`.
- **Language.** `chrome.i18n.detectLanguage` on the selected text (up to 2,000 characters) first, since many sites mark every page `lang="en"`; the nearest `lang` attribute when detection isn't reliable; otherwise unknown, and the prompt names only the target. If the text is already in the target language, the bubble says so instead of translating.
- **Task layer** (`extension/core/tasks/translate.ts`). Builds the prompt, sizes the token limit to the input (1.5 tokens per source character plus 64, at most 3,072), and takes at most 4,000 characters at once, which fits the 8K window even for Chinese or Japanese. A repetition guard watches the streamed reply: when its end is one piece repeated at least 4 times over at least 40 characters, it cancels the request and keeps the text up to the first copy. The bubble says when a reply was cut short.
- **Bubble** (`extension/features/translate/bubble.ts`). A popover in a closed shadow root, so page styles can't change it and page scripts can't read the translation. Text goes in through `textContent` only. It sits under the selection (above it when there is no room), scrolls with the page, follows the light or dark scheme, and fades in (shorter with reduced motion). Escape, a click elsewhere or its close button closes it and cancels the reply.

## Tab tools

The tab tools need no model, and work on the current window only. Each is a pure planner, tested in Node, plus a thin layer in `extension/features/tabs/actions.ts` that reads the window, saves the undo record and applies the plan.

- **Close duplicates** compares normalized URLs: no fragment, no tracking parameters (`utm_*`, `fbclid`, `gclid` and similar), and the query re-encoded the same way. A trailing slash is ignored only on the bare origin, since `/guide` and `/guide/` can be different pages. In each set of matching tabs it keeps the active tab, else a pinned one, else the oldest, and it never closes a pinned tab. Only web and file pages are compared; browser pages such as the new tab page are left alone.
- **Group by site** groups ungrouped tabs by registrable domain, from `chrome.publicSuffix` (so `news.bbc.co.uk` and `www.bbc.co.uk` share `bbc.co.uk`). A site needs two tabs for a new group, and a tab joins an existing group whose title is its site, so running it again picks up new tabs. Groups the user made, pinned tabs and browser pages don't move. Each site keeps the same colour from run to run.
- **Undo last change** reverses the last grouping or close, once. A grouping is undone by ungrouping the tabs and moving each back to its old index. Closed tabs come back from the browser's recently closed list, which keeps their history. Right after closing, Nook notes which new entries in that list are its own, so a tab the user closes later at the same address is never restored in their place. Once other closes push an entry past the list's 25, the tab is reopened by URL at its old place. A tab goes back into its old group, and if the close emptied that group, undo makes it again with the same title and colour. Focus returns to the tab the user was on.
- **Permission.** `tabs` is optional. Every tab action calls `permissions.request` first, before anything is awaited, so the click or shortcut still counts as a user gesture; once granted it resolves at once with no prompt. A declined request shows `!` on the badge.
- **Triggers and feedback.** The toolbar icon's right-click menu (Group tabs, Close duplicates, Undo last change, Settings), the same three tab actions on a tab's right-click menu, and Alt+Shift+G, D and U (Chromium turns down Alt+Shift+Z as a suggested key and leaves the command without one). Actions run one at a time. The badge shows the number of tabs changed (or 0, or `!`) for 4 seconds, with the full result in the icon's tooltip.
