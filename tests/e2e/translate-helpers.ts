// Helpers for the translation tests: reading the bubble, changing settings,
// and running Translate selection on a test page.
import type { Page, Worker } from "@playwright/test";
import type { Settings } from "../../extension/core/settings";

type Node = { nodeType: number; nodeValue: string; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };

/**
 * The bubble's status line and text. The bubble sits in a closed shadow root,
 * which page scripts and Playwright selectors can't see into, so this reads
 * the DOM through the DevTools protocol, which can.
 */
export async function bubble(page: Page): Promise<{ status: string; text: string } | null> {
  const cdp = await page.context().newCDPSession(page);
  const { root } = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as { root: Node };
  await cdp.detach();
  const classOf = (node: Node) => {
    const attributes = node.attributes ?? [];
    return attributes[attributes.indexOf("class") + 1] ?? "";
  };
  const find = (node: Node, className: string): Node | undefined => {
    if (node.attributes?.includes("class") && classOf(node).split(" ").includes(className)) return node;
    for (const child of [...(node.shadowRoots ?? []), ...(node.children ?? [])]) {
      const found = find(child, className);
      if (found) return found;
    }
  };
  const textOf = (node: Node | undefined): string =>
    node ? (node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(textOf).join("")) : "";
  const panel = find(root, "bubble");
  return panel ? { status: textOf(find(panel, "status")), text: textOf(find(panel, "text")) } : null;
}

// SETTINGS_KEY in extension/core/settings.ts. Importing it would pull the model
// list's JSON into the test runner, which can't load it.
const SETTINGS_KEY = "settings";

export async function settings(serviceWorker: Worker, change: Partial<Settings>) {
  await serviceWorker.evaluate(
    async ([key, change]) => {
      const stored = (await chrome.storage.local.get(key))[key] ?? {};
      await chrome.storage.local.set({ [key]: { ...stored, ...change } });
    },
    [SETTINGS_KEY, change] as const,
  );
}

/** Opens a test page, selects its paragraph and picks Translate selection, as the page menu would. */
export async function translateOn(page: Page, serviceWorker: Worker, path: string, text?: string) {
  await page.goto(`http://example.com${path}`);
  await page.evaluate((text) => {
    const paragraph = document.querySelector("#text") as HTMLParagraphElement;
    if (text) paragraph.textContent = text;
    getSelection()?.selectAllChildren(paragraph);
  }, text);
  await pickTranslateSelection(serviceWorker, page.url());
}

/** Runs Translate selection on the tab at `url`, through the test build's hook in the service worker. */
export async function pickTranslateSelection(serviceWorker: Worker, url: string) {
  await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await (globalThis as unknown as { nookTranslateSelection(tab: unknown): Promise<void> }).nookTranslateSelection(
      tab,
    );
  }, url);
}
