# Architecture

This is the current design and is kept up to date as it changes. The reasoning behind it is in [discovery-brief.md](discovery-brief.md). Module names, file layout and APIs are still open until discovery settles them.

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
