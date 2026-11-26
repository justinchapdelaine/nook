// Service worker: opens the benchmark page, owns the offscreen document,
// registers the menus for the Helium API checks (E7), and runs the service
// worker inference host for the hosting comparison (E1).
import { defineBackground } from "wxt/utils/define-background";
import { createHost } from "../lib/host";
import type { ControlMessage, OffscreenEnsureResult } from "../lib/protocol";
import { portName } from "../lib/protocol";
import { KEYS } from "../lib/storage-keys";

const OFFSCREEN_URL = "/offscreen.html";

const MENUS: chrome.contextMenus.CreateProperties[] = [
  { id: "tab-a", title: "Nook Bench: tab item A", contexts: ["tab"] },
  { id: "tab-b", title: "Nook Bench: tab item B", contexts: ["tab"] },
  { id: "request-tabs", title: "Request the tabs permission", contexts: ["action"] },
  { id: "probe", title: "Nook Bench: test the model connection from this page", contexts: ["page"] },
];

let creating: Promise<OffscreenEnsureResult> | undefined;

/** Creates the offscreen document if needed. Concurrent callers share one creation and all wait for it to be ready. */
function ensureOffscreen(): Promise<OffscreenEnsureResult> {
  creating ??= createOffscreen().finally(() => {
    creating = undefined;
  });
  return creating;
}

async function createOffscreen(): Promise<OffscreenEnsureResult> {
  const start = performance.now();
  if (await chrome.offscreen.hasDocument()) return { created: false, ms: performance.now() - start };
  // createDocument can resolve before the document's script has added its port listener,
  // and a port opened before then never reaches it. Wait for the document to say it is ready.
  const ready = new Promise<void>((resolve) => {
    const listener = (message: ControlMessage) => {
      if (message.type !== "offscreen:ready") return;
      chrome.runtime.onMessage.removeListener(listener);
      resolve();
    };
    chrome.runtime.onMessage.addListener(listener);
  });
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Runs the on-device language model in a dedicated worker.",
  });
  await ready;
  return { created: true, ms: performance.now() - start };
}

export default defineBackground({
  type: "module",
  main() {
    const host = createHost("sw");

    chrome.runtime.onInstalled.addListener(async () => {
      await chrome.contextMenus.removeAll();
      const results: Record<string, string> = {};
      for (const menu of MENUS) {
        try {
          await new Promise<void>((resolve, reject) =>
            chrome.contextMenus.create(menu, () =>
              chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(),
            ),
          );
          results[String(menu.id)] = "ok";
        } catch (error) {
          results[String(menu.id)] = String(error);
        }
      }
      await chrome.storage.local.set({ [KEYS.menus]: results });
    });

    chrome.action.onClicked.addListener(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL("/bench.html") });
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === "request-tabs") {
        // Must be the first call in the handler, while the click still counts as a user gesture.
        chrome.permissions.request({ permissions: ["tabs"] }).then(
          (granted) => chrome.storage.local.set({ [KEYS.tabsPermission]: { granted, at: Date.now() } }),
          (error: unknown) =>
            chrome.storage.local.set({ [KEYS.tabsPermission]: { error: String(error), at: Date.now() } }),
        );
        return;
      }
      if (info.menuItemId === "tab-a" || info.menuItemId === "tab-b") {
        chrome.storage.local.set({
          [KEYS.tabMenu]: {
            item: info.menuItemId,
            tabId: tab?.id,
            tabTitle: tab?.title ?? null,
            at: Date.now(),
          },
        });
        return;
      }
      if (info.menuItemId === "probe" && tab?.id !== undefined) {
        chrome.scripting
          .executeScript({ target: { tabId: tab.id }, files: ["/probe.js"] })
          .catch((error: unknown) =>
            chrome.storage.local.set({ [KEYS.probe]: { error: String(error), at: Date.now() } }),
          );
      }
    });

    chrome.runtime.onMessage.addListener((message: ControlMessage, _sender, sendResponse) => {
      if (message.type === "offscreen:ensure") {
        ensureOffscreen().then(sendResponse, (error: unknown) => sendResponse({ error: String(error) }));
        return true;
      }
      if (message.type === "offscreen:close") {
        chrome.offscreen.closeDocument().then(
          () => sendResponse(null),
          () => sendResponse(null),
        );
        return true;
      }
      return false;
    });

    chrome.runtime.onConnect.addListener((port) => {
      // Ports reach every extension context. Ignore, rather than disconnect, ports for the
      // offscreen host: a disconnect here would close them for the offscreen document too.
      if (port.name !== portName("sw")) return;
      let open = true;
      port.onDisconnect.addListener(() => {
        open = false;
      });
      port.onMessage.addListener((envelope) =>
        host.serve(envelope, (response) => {
          if (open) port.postMessage(response);
        }),
      );
    });
  },
});
