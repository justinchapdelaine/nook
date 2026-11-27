// Settings page. Phase 1 holds the tab tools' access and shortcuts; the
// model and translation settings arrive in phase 2.
import type { TabAction } from "../../core/messages";
import { isTabAction, TAB_ACTIONS } from "../../core/messages";
import { TABS_PERMISSION } from "../../core/permissions";

const access = document.querySelector("#access") as HTMLParagraphElement;
const accessButton = document.querySelector("#access-button") as HTMLButtonElement;

let granted = false;

async function showAccess(): Promise<void> {
  granted = await chrome.permissions.contains(TABS_PERMISSION);
  access.textContent = granted
    ? "Nook can read your tabs' addresses and titles. It needs this to find duplicates and group by site, and nothing leaves this device."
    : "Nook asks to read your tabs' addresses and titles the first time you use a tab tool.";
  accessButton.textContent = granted ? "Remove tab access" : "Allow tab access";
  accessButton.hidden = false;
}

accessButton.addEventListener("click", async () => {
  // The request must be the first call in the click handler, or the click no
  // longer counts as a user gesture.
  await (granted ? chrome.permissions.remove(TABS_PERMISSION) : chrome.permissions.request(TABS_PERMISSION));
  await showAccess();
});

async function showShortcuts(): Promise<void> {
  const list = document.querySelector("#shortcuts") as HTMLDListElement;
  // The browser lists commands alphabetically; show them in menu order.
  const commands = (await chrome.commands.getAll()).filter((c): c is chrome.commands.Command & { name: TabAction } =>
    isTabAction(c.name),
  );
  commands.sort((a, b) => TAB_ACTIONS.indexOf(a.name) - TAB_ACTIONS.indexOf(b.name));
  for (const command of commands) {
    const key = document.createElement("dt");
    key.textContent = command.shortcut || "Not set";
    const what = document.createElement("dd");
    what.textContent = command.description ?? "";
    list.append(key, what);
  }
}

document.querySelector("#change-shortcuts")?.addEventListener("click", () => {
  // A page can't link to browser pages, but it can open one in a new tab.
  void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

chrome.permissions.onAdded.addListener(() => void showAccess());
chrome.permissions.onRemoved.addListener(() => void showAccess());
void showAccess();
void showShortcuts();
