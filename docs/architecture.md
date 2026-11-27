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

- Ports from `runtime.connect` reach every extension context with a listener, so a host dying does not always disconnect its clients. Clients need a heartbeat or timeout to notice a host that stopped.
- Loading from cache takes about 1 to 2 s, so the offscreen document can close after an idle period to free GPU memory and reopen on demand.

## Contexts and messages

Phase 1 has two contexts. More arrive with the model in phase 2 (see [plan.md](plan.md#repo-organization) for the layout).

- **Service worker** (`extension/entrypoints/background.ts`): registers the menus, listens for menu clicks, keyboard shortcuts and messages, runs the tab tools and reports each result on the toolbar badge. It keeps no state in memory that matters past one event; the undo record is in `chrome.storage.session`.
- **Settings page** (`extension/entrypoints/options/`): tab access and the shortcuts for now.
- Messages between contexts are typed in `extension/core/messages.ts`. The one message so far, `tabs:run`, asks the service worker to run a tab action in the sender's window and replies with what it did.
- Biome stops any file outside `extension/core/runtime/` from importing WebLLM, so the runtime stays swappable.

## Tab tools

The tab tools need no model, and work on the current window only. Each is a pure planner, tested in Node, plus a thin layer in `extension/features/tabs/actions.ts` that reads the window, saves the undo record and applies the plan.

- **Close duplicates** compares normalized URLs: no fragment, no tracking parameters (`utm_*`, `fbclid`, `gclid` and similar), and the query re-encoded the same way. A trailing slash is ignored only on the bare origin, since `/guide` and `/guide/` can be different pages. In each set of matching tabs it keeps the active tab, else a pinned one, else the oldest, and it never closes a pinned tab. Only web and file pages are compared; browser pages such as the new tab page are left alone.
- **Group by site** groups ungrouped tabs by registrable domain, from `chrome.publicSuffix` (so `news.bbc.co.uk` and `www.bbc.co.uk` share `bbc.co.uk`). A site needs two tabs for a new group, and a tab joins an existing group whose title is its site, so running it again picks up new tabs. Groups the user made, pinned tabs and browser pages don't move. Each site keeps the same colour from run to run.
- **Undo last change** reverses the last grouping or close, once. A grouping is undone by ungrouping the tabs and moving each back to its old index. Closed tabs come back from the browser's recently closed list, which keeps their history. Right after closing, Nook notes which new entries in that list are its own, so a tab the user closes later at the same address is never restored in their place. Once other closes push an entry past the list's 25, the tab is reopened by URL at its old place. A tab goes back into its old group, and if the close emptied that group, undo makes it again with the same title and colour. Focus returns to the tab the user was on.
- **Permission.** `tabs` is optional. Every tab action calls `permissions.request` first, before anything is awaited, so the click or shortcut still counts as a user gesture; once granted it resolves at once with no prompt. A declined request shows `!` on the badge.
- **Triggers and feedback.** The toolbar icon's right-click menu (Group tabs, Close duplicates, Undo last change, Settings), the same three tab actions on a tab's right-click menu, and Alt+Shift+G, D and Z. Actions run one at a time. The badge shows the number of tabs changed (or 0, or `!`) for 4 seconds, with the full result in the icon's tooltip.
