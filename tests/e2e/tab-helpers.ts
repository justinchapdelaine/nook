// Helpers for the tab tool tests: running an action as a click would, and
// opening and reading the window's tabs.
import type { Page } from "@playwright/test";
import type { TabAction, TabActionResult } from "../../extension/core/messages";
import { expect } from "./fixtures";

/** Opens the settings page, which serves as the test's window into the extension. */
export async function openSettings(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator("#access-button")).toBeVisible();
}

/**
 * Runs a tab action the way a page click would: the message is sent from a
 * real click, so the service worker's permission request has its user gesture.
 */
export async function run(page: Page, action: TabAction): Promise<TabActionResult> {
  const result = page.evaluate(
    (action) =>
      new Promise<TabActionResult>((resolve) => {
        document.addEventListener(
          "click",
          async () => resolve(await chrome.runtime.sendMessage({ type: "tabs:run", action })),
          {
            once: true,
          },
        );
      }),
    action,
  );
  await page.locator("h1").click();
  return result;
}

/**
 * Opens tabs from an extension page, in its window, and waits for them to load. A tab
 * given as [url, title] gets that title, since the test server's pages all
 * have the same one.
 */
export async function openTabs(page: Page, tabs: (string | [string, string])[]) {
  const context = page.context();
  for (const entry of tabs) {
    const [url, title] = typeof entry === "string" ? [entry] : entry;
    const loaded = context.waitForEvent("page");
    await page.evaluate((url) => chrome.tabs.create({ url, active: false }), url);
    const opened = await loaded;
    await opened.waitForLoadState();
    if (title === undefined) continue;
    await opened.evaluate((title) => {
      document.title = title;
    }, title);
    await expect
      .poll(() => page.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.title, url))
      .toBe(title);
  }
}

/** The window's tabs, left to right, as URLs, with each tab's group title where it has one. */
export async function windowTabs(page: Page) {
  return page.evaluate(async () => {
    const { id: windowId } = await chrome.windows.getCurrent();
    const groups = new Map((await chrome.tabGroups.query({ windowId })).map((g) => [g.id, g.title]));
    return (await chrome.tabs.query({ windowId })).map((t) => ({ url: t.url, group: groups.get(t.groupId) }));
  });
}

/** Closes the rightmost tab in the settings page's window, as the user would. */
export async function closeLastTab(page: Page) {
  await page.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const last = tabs[tabs.length - 1];
    if (last?.id !== undefined) await chrome.tabs.remove(last.id);
  });
}

export const badge = (page: Page) => page.evaluate(() => chrome.action.getBadgeText({}));
