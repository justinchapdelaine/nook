// Settings page: translation, the model and its download, and tab access.
import { isTabAction, TAB_ACTIONS } from "../../core/messages";
import type { ModelFamily } from "../../core/models";
import { FAMILIES, findFamily } from "../../core/models";
import { TABS_PERMISSION } from "../../core/permissions";
import { HostClient, HostRequestError } from "../../core/runtime/client";
import type { ModelStatus } from "../../core/runtime/protocol";
import { getSettings, updateSettings } from "../../core/settings";
import { TARGET_LANGUAGES } from "../../features/translate/languages";

const $ = <T extends Element>(selector: string) => document.querySelector(selector) as T;
const logError = (what: string) => (error: unknown) => console.error(`Nook: ${what} failed`, error);

const client = new HostClient();
const sizeOf = (family: ModelFamily) => `${(family.downloadMB / 1000).toFixed(1)} GB`;

// Translation

async function showTranslation(): Promise<void> {
  const settings = await getSettings();
  const select = $<HTMLSelectElement>("#target-language");
  const names = new Intl.DisplayNames([navigator.language], { type: "language" });
  const codes: string[] = [...TARGET_LANGUAGES];
  // Keep a language set before this list changed, so the page shows the truth.
  if (!codes.includes(settings.targetLanguage)) codes.unshift(settings.targetLanguage);
  select.replaceChildren(
    ...codes.map((code) => new Option(names.of(code) ?? code, code, false, code === settings.targetLanguage)),
  );
  select.addEventListener("change", () => {
    updateSettings({ targetLanguage: select.value }).catch(logError("saving the language"));
  });

  const sites = $<HTMLTextAreaElement>("#excluded-sites");
  sites.value = settings.excludedSites.join("\n");
  $<HTMLFormElement>("#sites-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const excludedSites = sites.value
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean)
      // Accept a pasted address as well as a bare site.
      .map((line) => URL.parse(line)?.hostname || line);
    await updateSettings({ excludedSites });
    sites.value = excludedSites.join("\n");
    $("#sites-saved").textContent = "Saved.";
  });
}

// Model

const modelStatus = $<HTMLParagraphElement>("#model-status");
const progress = $<HTMLProgressElement>("#download-progress");
const downloadButton = $<HTMLButtonElement>("#download");
const deleteButton = $<HTMLButtonElement>("#delete");
let busy = false;

async function showModels(): Promise<void> {
  const settings = await getSettings();
  const fieldset = $<HTMLFieldSetElement>("#models");
  for (const family of FAMILIES) {
    const label = document.createElement("label");
    label.className = "choice";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "model";
    radio.value = family.id;
    radio.checked = family.id === settings.model;
    radio.addEventListener("change", async () => {
      await updateSettings({ model: family.id });
      await refreshModel();
    });
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = family.label;
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.dataset.family = family.id;
    text.append(name, ` (${sizeOf(family)}). ${family.note}`, detail);
    label.append(radio, text);
    fieldset.append(label);
  }
  $<HTMLSelectElement>("#idle-minutes").value = String(settings.idleMinutes);
  $<HTMLSelectElement>("#idle-minutes").addEventListener("change", (event) => {
    const idleMinutes = Number((event.target as HTMLSelectElement).value);
    updateSettings({ idleMinutes }).catch(logError("saving the idle time"));
  });
  await refreshModel();
}

/** Shows whether the chosen model is downloaded, and offers the download or the delete. */
async function refreshModel(): Promise<void> {
  if (busy) return;
  const family = findFamily((await getSettings()).model) ?? (FAMILIES[0] as ModelFamily);
  let statuses: ModelStatus[];
  try {
    statuses = await client.request({ type: "models" }).result;
  } catch (error) {
    downloadButton.hidden = deleteButton.hidden = true;
    modelStatus.textContent =
      error instanceof HostRequestError && error.code === "no-webgpu"
        ? "Translation needs WebGPU, which this browser or graphics card doesn't offer."
        : `Nook couldn't check the model: ${String(error)}`;
    return;
  }
  for (const status of statuses) {
    const detail = document.querySelector(`.detail[data-family="${CSS.escape(status.family)}"]`);
    if (detail) detail.textContent = status.downloaded ? " Downloaded." : "";
  }
  const downloaded = statuses.find((s) => s.family === family.id)?.downloaded ?? false;
  modelStatus.textContent = downloaded
    ? `${family.label} is downloaded and ready.`
    : `${family.label} isn't downloaded yet. Translation needs it.`;
  downloadButton.hidden = downloaded;
  downloadButton.textContent = `Download ${family.label} (${sizeOf(family)})`;
  deleteButton.hidden = !downloaded;
  deleteButton.textContent = `Delete ${family.label}`;
}

async function run(what: string, work: () => Promise<unknown>): Promise<void> {
  busy = true;
  downloadButton.disabled = deleteButton.disabled = true;
  try {
    await work();
  } catch (error) {
    busy = false;
    modelStatus.textContent = `${what} failed: ${error instanceof Error ? error.message : String(error)}`;
    return;
  } finally {
    downloadButton.disabled = deleteButton.disabled = false;
    progress.hidden = true;
  }
  busy = false;
  await refreshModel();
}

downloadButton.addEventListener("click", async () => {
  const family = (await getSettings()).model;
  progress.value = 0;
  progress.hidden = false;
  modelStatus.textContent = "Downloading…";
  await run(
    "The download",
    () =>
      client.request(
        { type: "download", family },
        {
          onProgress: (text, fraction) => {
            progress.value = fraction;
            modelStatus.textContent = `Downloading: ${Math.round(fraction * 100)}%`;
            progress.title = text;
          },
        },
      ).result,
  );
});

deleteButton.addEventListener("click", async () => {
  const family = (await getSettings()).model;
  modelStatus.textContent = "Deleting…";
  await run("Deleting", () => client.request({ type: "delete", family }).result);
});

// Tab access

const access = $<HTMLParagraphElement>("#access");
const accessButton = $<HTMLButtonElement>("#access-button");
let granted = false;

async function showAccess(): Promise<void> {
  granted = await chrome.permissions.contains(TABS_PERMISSION);
  access.textContent = granted
    ? "Nook can read your tabs' addresses and titles. It needs this to find duplicates and group by site, and nothing leaves this device."
    : "Nook asks to read your tabs' addresses and titles the first time you use a tab tool.";
  accessButton.textContent = granted ? "Remove tab access" : "Allow tab access";
  accessButton.hidden = false;
}

accessButton.addEventListener("click", () => {
  // The request must be the first call in the click handler, or the click no
  // longer counts as a user gesture. The permission listeners below update
  // the page once access changes.
  const change = granted ? chrome.permissions.remove(TABS_PERMISSION) : chrome.permissions.request(TABS_PERMISSION);
  change.catch(logError("changing tab access"));
});

// Shortcuts

/** Commands in the order the page lists them; the browser lists them alphabetically. */
const COMMAND_ORDER = ["translate-selection", ...TAB_ACTIONS];

async function showShortcuts(): Promise<void> {
  const list = $<HTMLDListElement>("#shortcuts");
  const commands = (await chrome.commands.getAll()).filter(
    (c) => c.name !== undefined && (isTabAction(c.name) || c.name === "translate-selection"),
  );
  commands.sort((a, b) => COMMAND_ORDER.indexOf(a.name ?? "") - COMMAND_ORDER.indexOf(b.name ?? ""));
  for (const command of commands) {
    const key = document.createElement("dt");
    key.textContent = command.shortcut || "Not set";
    const what = document.createElement("dd");
    what.textContent = command.description ?? "";
    list.append(key, what);
  }
}

$("#change-shortcuts").addEventListener("click", () => {
  // A page can't link to browser pages, but it can open one in a new tab.
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).catch(logError("opening shortcut settings"));
});

const refreshAccess = () => showAccess().catch(logError("reading tab access"));
chrome.permissions.onAdded.addListener(refreshAccess);
chrome.permissions.onRemoved.addListener(refreshAccess);
refreshAccess();
showShortcuts().catch(logError("listing shortcuts"));
showTranslation().catch(logError("showing translation settings"));
showModels().catch(logError("showing the model"));
