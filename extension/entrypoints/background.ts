// Service worker: wires the toolbar and tab menus, keyboard shortcuts and
// messages to the tab tools, and reports each result on the toolbar badge.
import { defineBackground } from "wxt/utils/define-background";
import { clearBadge, flashBadge } from "../core/badge";
import type { NookMessage, TabAction, TabActionResult } from "../core/messages";
import { isTabAction } from "../core/messages";
import { TABS_PERMISSION } from "../core/permissions";
import { closeDuplicates, groupBySite, undoLast } from "../features/tabs/actions";

const TAB_MENUS: { id: TabAction; title: string }[] = [
  { id: "group-tabs", title: "Group tabs" },
  { id: "close-duplicates", title: "Close duplicates" },
  { id: "undo", title: "Undo last change" },
];
const SETTINGS_MENU = "settings";

const RUN: Record<TabAction, (windowId: number) => Promise<number>> = {
  "group-tabs": groupBySite,
  "close-duplicates": closeDuplicates,
  undo: undoLast,
};

// Tab actions run one at a time, so a double press can't interleave two
// changes or save the wrong undo record. A queue in memory is enough: each
// action takes well under a second, far less than the worker's idle limit.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs a tab action. Call it synchronously from the click, shortcut or
 * message handler: the tabs permission request must be its first call, with
 * nothing awaited before it, or Chrome no longer counts the user gesture.
 * Once granted, the request resolves at once without a prompt.
 */
function runTabAction(action: TabAction, windowId: number | undefined): Promise<TabActionResult> {
  const granted = chrome.permissions.request(TABS_PERMISSION);
  // runAfter handles a refusal, maybe only after an earlier action finishes;
  // mark it handled now so the worker doesn't log it as uncaught meanwhile.
  granted.catch(() => {});
  const previous = queue;
  const result = runAfter(previous, action, windowId, granted);
  queue = result;
  return result;
}

async function runAfter(
  previous: Promise<unknown>,
  action: TabAction,
  windowId: number | undefined,
  granted: Promise<boolean>,
): Promise<TabActionResult> {
  await previous;
  let result: TabActionResult;
  try {
    if (!(await granted)) {
      result = { action, count: 0, error: "no-permission" };
    } else {
      const target = windowId ?? (await chrome.windows.getLastFocused()).id;
      if (target === undefined) throw new Error("No browser window is open");
      result = { action, count: await RUN[action](target) };
    }
  } catch (error) {
    console.error(`Nook: ${action} failed`, error);
    result = { action, count: 0, error: error instanceof Error ? error.message : String(error) };
  }
  try {
    await report(result);
  } catch (error) {
    console.error("Nook: badge update failed", error);
  }
  return result;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function report({ action, count, error }: TabActionResult): Promise<void> {
  if (error === "no-permission") return flashBadge("!", "error", "tab tools need access to your tabs");
  if (error) return flashBadge("!", "error", `that didn't work (${error})`);
  if (count === 0) {
    const none = { "group-tabs": "no tabs to group", "close-duplicates": "no duplicates", undo: "nothing to undo" };
    return flashBadge("0", "info", none[action]);
  }
  const done = {
    "group-tabs": `grouped ${plural(count, "tab")} by site`,
    "close-duplicates": `closed ${plural(count, "duplicate tab")}`,
    undo: `put back ${plural(count, "tab")}`,
  };
  return flashBadge(String(count), "done", done[action]);
}

export default defineBackground({
  type: "module",
  main() {
    clearBadge().catch((error: unknown) => console.error("Nook: badge reset failed", error));

    chrome.runtime.onInstalled.addListener(async () => {
      await chrome.contextMenus.removeAll();
      for (const { id, title } of TAB_MENUS) chrome.contextMenus.create({ id, title, contexts: ["action", "tab"] });
      chrome.contextMenus.create({ id: SETTINGS_MENU, title: "Settings", contexts: ["action"] });
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (isTabAction(info.menuItemId)) void runTabAction(info.menuItemId, tab?.windowId);
      else if (info.menuItemId === SETTINGS_MENU) {
        chrome.runtime
          .openOptionsPage()
          .catch((error: unknown) => console.error("Nook: opening settings failed", error));
      }
    });

    chrome.commands.onCommand.addListener((command, tab) => {
      if (isTabAction(command)) void runTabAction(command, tab?.windowId);
    });

    chrome.runtime.onMessage.addListener((message: NookMessage, sender, sendResponse) => {
      if (message?.type !== "tabs:run" || !isTabAction(message.action)) return false;
      // runTabAction makes its permission request before this awaits anything.
      void (async () => sendResponse(await runTabAction(message.action, sender.tab?.windowId)))();
      return true;
    });
  },
});
