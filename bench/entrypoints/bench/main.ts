// The benchmark page: downloads models on request, runs one experiment at a
// time, and keeps the results block up to date.
import { HostClient } from "../../lib/client";
import { gpuInfo } from "../../lib/gpu";
import { MODELS } from "../../lib/models";
import type { GpuInfo } from "../../lib/protocol";
import type { Results } from "../../lib/results";
import { clearResults, formatResults, loadResults, saveSection } from "../../lib/results";
import { KEYS } from "../../lib/storage-keys";
import type { RunContext } from "../../suites/context";
import { runPackageCheck } from "../../suites/e0-package";
import { runHosting } from "../../suites/e1-hosting";
import { runSpeed } from "../../suites/e2-speed";
import { runStability } from "../../suites/e3-stability";
import { runContext } from "../../suites/e4-context";
import { runQuality } from "../../suites/e5-quality";
import { runMarkers } from "../../suites/e6-markers";
import { runHeliumChecks } from "../../suites/e7-helium";

const SUITES: Record<string, (ctx: RunContext) => Promise<unknown>> = {
  e0: runPackageCheck,
  e1: runHosting,
  e2: runSpeed,
  e3: runStability,
  e4: runContext,
  e5: runQuality,
  e6: runMarkers,
  e7: runHeliumChecks,
};
const EVENT_KEYS = [KEYS.menus, KEYS.tabMenu, KEYS.tabsPermission, KEYS.probe];

const $ = <T extends Element>(selector: string, root: ParentNode = document) => root.querySelector(selector) as T;
const offscreen = new HostClient("offscreen");
const sw = new HostClient("sw");
let busy = false;
let gpu: GpuInfo = { available: false, error: "not checked" };
let cached = new Set<string>();

// ---- Results block ----

async function fullResults(): Promise<Results> {
  const results = await loadResults();
  const events = await chrome.storage.local.get(EVENT_KEYS);
  return { ...results, e7Events: events };
}

async function renderResults(): Promise<void> {
  $<HTMLTextAreaElement>("#results").value = formatResults(await fullResults());
}

async function renderEvents(): Promise<void> {
  const events = await chrome.storage.local.get(EVENT_KEYS);
  for (const el of document.querySelectorAll<HTMLElement>("[data-event]")) {
    const value = events[el.dataset.event ?? ""];
    el.textContent = value ? `Recorded: ${JSON.stringify(value)}` : "";
  }
}

// ---- Environment ----

async function environment() {
  gpu = await gpuInfo();
  const uaData = (
    navigator as Navigator & { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<object> } }
  ).userAgentData;
  const ua = uaData
    ? await uaData.getHighEntropyValues(["fullVersionList", "platform", "platformVersion", "architecture", "bitness"])
    : null;
  const estimate = await navigator.storage.estimate();
  return {
    harness: chrome.runtime.getManifest().version,
    collectedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    userAgentData: ua,
    cores: navigator.hardwareConcurrency,
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    storage: {
      quotaGB: (estimate.quota ?? 0) / 1e9,
      usageGB: (estimate.usage ?? 0) / 1e9,
      persisted: await navigator.storage.persisted(),
    },
    gpu,
  };
}

function shaderF16(): boolean {
  return gpu.available && gpu.features.includes("shader-f16");
}

// ---- Models ----

async function refreshModels(): Promise<void> {
  try {
    const status = await offscreen.request({ type: "cacheStatus" });
    cached = new Set(Object.entries(status).flatMap(([id, has]) => (has ? [id] : [])));
  } catch (error) {
    $("#download-status").textContent = `Could not read the model cache: ${error}`;
  }
  const body = $<HTMLTableSectionElement>("#models");
  body.replaceChildren();
  for (const model of MODELS) {
    const row = body.insertRow();
    row.insertCell().textContent = model.label;
    row.insertCell().textContent = `${(model.vramMB / 1024).toFixed(1)} GB`;
    const runnable = shaderF16() || !model.needsF16;
    row.insertCell().textContent = !runnable
      ? "Needs shader-f16, not on this GPU"
      : cached.has(model.id)
        ? "Downloaded"
        : "Not downloaded";
    const actions = row.insertCell();
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = busy || !runnable;
    if (cached.has(model.id)) {
      button.textContent = "Delete";
      button.addEventListener("click", () => deleteModel(model.id));
    } else {
      button.textContent = "Download";
      button.title = `Downloads the weights from ${new URL(model.weights).host}`;
      button.addEventListener("click", () => download(model.id));
    }
    actions.append(button);
  }
  const note = $("#f16-note");
  note.textContent = gpu.available
    ? shaderF16()
      ? "This GPU supports shader-f16, so q4f16 models run. Experiments use them, and E2 also times 2B in q4f32."
      : "This GPU has no shader-f16, so only q4f32 models run."
    : `WebGPU is not available here: ${gpu.error}`;
}

async function download(modelId: string): Promise<void> {
  if (busy) return;
  setBusy(true);
  const status = $("#download-status");
  const start = performance.now();
  try {
    await offscreen.request({ type: "load", modelId }, (text) => {
      status.textContent = text;
    });
    await offscreen.request({ type: "unload" });
    const seconds = (performance.now() - start) / 1000;
    status.textContent = `Downloaded ${modelId} in ${seconds.toFixed(0)} s.`;
    const downloads = ((await loadResults()).downloads as Record<string, unknown>) ?? {};
    await saveSection("downloads", { ...downloads, [modelId]: { seconds, at: new Date().toISOString() } });
  } catch (error) {
    status.textContent = `Download failed: ${error}`;
  } finally {
    setBusy(false);
    await refreshModels();
    await renderResults();
  }
}

async function deleteModel(modelId: string): Promise<void> {
  if (busy) return;
  setBusy(true);
  try {
    await offscreen.request({ type: "deleteModel", modelId });
  } finally {
    setBusy(false);
    await refreshModels();
  }
}

// ---- Dialogs ----

function openDialog(dialog: HTMLDialogElement): Promise<string> {
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true }));
}

async function askVram(moment: string): Promise<number | null> {
  if (!$<HTMLInputElement>("#ask-vram").checked) return null;
  const dialog = $<HTMLDialogElement>("#vram-dialog");
  const input = $<HTMLInputElement>("input[name=gb]", dialog);
  input.value = "";
  $("#vram-moment").textContent = `Now: ${moment}.`;
  const answer = await openDialog(dialog);
  const value = Number.parseFloat(input.value);
  return answer === "ok" && Number.isFinite(value) ? value : null;
}

async function askStep(instructions: string): Promise<boolean> {
  $("#step-text").textContent = instructions;
  return (await openDialog($<HTMLDialogElement>("#step-dialog"))) === "done";
}

// ---- Running experiments ----

function setBusy(value: boolean): void {
  busy = value;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-run], #models button"))
    button.disabled = value;
}

function options(card: HTMLElement): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const input of card.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[name]")) {
    values[input.name] = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value;
  }
  return values;
}

async function run(card: HTMLElement): Promise<void> {
  const key = card.dataset.exp ?? "";
  if (busy) return;
  setBusy(true);
  const status = $(".status", card);
  const log = $(".log", card);
  log.textContent = "";
  const write = (message: string) => {
    log.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
    status.textContent = message;
  };
  const ctx: RunContext = {
    offscreen,
    sw,
    shaderF16: shaderF16(),
    cached,
    log: write,
    status: (message) => {
      status.textContent = message;
    },
    askVram,
    askStep,
    sleep: async (ms, label) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        status.textContent = `${label}: ${Math.ceil((end - Date.now()) / 1000)} s left`;
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000, end - Date.now())));
      }
    },
    options: options(card),
  };
  const start = Date.now();
  write("Started.");
  try {
    await saveSection("env", await environment());
    const suite = SUITES[key];
    if (!suite) throw new Error(`Unknown experiment ${key}`);
    const result = await suite(ctx);
    await saveSection(key, {
      ranAt: new Date(start).toISOString(),
      minutes: (Date.now() - start) / 60_000,
      ...(result as object),
    });
    write("Finished. Results updated below.");
  } catch (error) {
    write(`Stopped with an error: ${error}`);
    await saveSection(key, { ranAt: new Date(start).toISOString(), error: String(error), options: ctx.options });
  } finally {
    setBusy(false);
    await refreshModels();
    await renderResults();
  }
}

// ---- Manual answers (E7) ----

async function setupManual(): Promise<void> {
  const saved = ((await loadResults()).e7Manual as Record<string, string>) ?? {};
  const save = async (name: string, value: string) => {
    const current = ((await loadResults()).e7Manual as Record<string, string>) ?? {};
    await saveSection("e7Manual", { ...current, [name]: value });
    await renderResults();
  };
  for (const span of document.querySelectorAll<HTMLElement>(".answer[data-manual]")) {
    const name = span.dataset.manual ?? "";
    for (const value of ["yes", "no"]) {
      const label = document.createElement("label");
      label.className = "toggle";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = value;
      input.checked = saved[name] === value;
      input.addEventListener("change", () => save(name, value));
      label.append(input, value === "yes" ? "Yes, both items" : "No");
      span.append(label);
    }
  }
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    ":is(input, textarea)[data-manual]",
  )) {
    const name = field.dataset.manual ?? "";
    field.value = saved[name] ?? "";
    field.addEventListener("change", () => save(name, field.value));
  }
}

// ---- Copy ----

const copyTimers = new WeakMap<HTMLElement, number>();
document.addEventListener(
  "command",
  async (event) => {
    const { command, source, target } = event as Event & {
      command: string;
      source: HTMLElement;
      target: HTMLTextAreaElement;
    };
    if (command !== "--copy") return;
    const tip = source.nextElementSibling as HTMLElement;
    clearTimeout(copyTimers.get(source));
    try {
      await navigator.clipboard.writeText(target.value);
      tip.textContent = "Copied";
    } catch {
      target.select();
      tip.textContent = "Copy failed; the text is selected, press Ctrl+C";
    }
    copyTimers.set(
      source,
      window.setTimeout(() => {
        tip.textContent = "";
      }, 4000),
    );
  },
  true,
);

// ---- Start ----

for (const card of document.querySelectorAll<HTMLElement>(".exp")) {
  $("[data-run]", card).addEventListener("click", () => run(card));
}
$("#clear").addEventListener("click", async () => {
  await clearResults();
  await chrome.storage.local.remove([KEYS.tabMenu, KEYS.tabsPermission, KEYS.probe]);
  await renderResults();
  await renderEvents();
});
chrome.storage.onChanged.addListener(async (changes) => {
  if (EVENT_KEYS.some((key) => key in changes)) {
    await renderEvents();
    await renderResults();
  }
});

await saveSection("env", await environment());
const found = gpu as GpuInfo;
$("#env-summary").textContent = found.available
  ? `GPU: ${[found.vendor, found.architecture, found.description].filter(Boolean).join(", ")}${found.isFallbackAdapter ? " (software fallback)" : ""}. ` +
    `Browser: ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? "unknown"}.`
  : `No WebGPU adapter: ${found.error}`;
await refreshModels();
await setupManual();
await renderEvents();
await renderResults();
document.body.dataset.ready = "true";
