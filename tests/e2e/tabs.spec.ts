import type { BrowserContext, Page } from "@playwright/test";
import type { TabAction, TabActionResult } from "../../extension/core/messages";
import { expect, nookTest as test } from "./fixtures";

/** Opens the settings page, which serves as the test's window into the extension. */
async function openSettings(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator("#access-button")).toBeVisible();
}

/**
 * Runs a tab action the way a page click would: the message is sent from a
 * real click, so the service worker's permission request has its user gesture.
 */
async function run(page: Page, action: TabAction): Promise<TabActionResult> {
  const result = page.evaluate(
    (action) =>
      new Promise<TabActionResult>((resolve) => {
        document.addEventListener(
          "click",
          () => chrome.runtime.sendMessage({ type: "tabs:run", action }).then(resolve),
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

/** Opens tabs in the settings page's window and waits for them to load. */
async function openTabs(context: BrowserContext, urls: string[]) {
  for (const url of urls) {
    const loaded = context.waitForEvent("page");
    await context.pages()[0]?.evaluate((url) => chrome.tabs.create({ url, active: false }), url);
    await (await loaded).waitForLoadState();
  }
}

/** The window's tabs, left to right, as URLs, with each tab's group title where it has one. */
async function windowTabs(page: Page) {
  return page.evaluate(async () => {
    const { id: windowId } = await chrome.windows.getCurrent();
    const groups = new Map((await chrome.tabGroups.query({ windowId })).map((g) => [g.id, g.title]));
    return (await chrome.tabs.query({ windowId })).map((t) => ({ url: t.url, group: groups.get(t.groupId) }));
  });
}

const badge = (page: Page) => page.evaluate(() => chrome.action.getBadgeText({}));

test.beforeEach(async ({ context, extensionId }) => {
  // Use the first tab for the settings page, so the window holds only it and the tabs a test opens.
  const page = context.pages()[0] ?? (await context.newPage());
  await openSettings(page, extensionId);
});

test("the settings page lists the shortcuts and shows tab access", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await expect(page.locator("#access")).toContainText("can read your tabs");
  await expect(page.locator("#shortcuts dd")).toHaveText([
    "Group tabs by site",
    "Close duplicate tabs",
    "Undo the last tab change",
  ]);
  // Every suggested key was accepted; the browser leaves a key it refuses unset.
  await expect(page.locator("#shortcuts dt")).toHaveText(["Alt+Shift+G", "Alt+Shift+D", "Alt+Shift+U"]);
});

test("close duplicates keeps one tab per page, and undo brings the others back", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await openTabs(context, [
    "http://a.example.com/x",
    "http://b.example.com/",
    "http://a.example.com/x#part",
    "http://a.example.com/x?utm_source=feed",
    "http://a.example.com/x/",
  ]);
  const before = await windowTabs(page);

  expect(await run(page, "close-duplicates")).toEqual({ action: "close-duplicates", count: 2 });
  expect((await windowTabs(page)).map((t) => t.url)).toEqual([
    page.url(),
    "http://a.example.com/x",
    "http://b.example.com/",
    "http://a.example.com/x/",
  ]);
  expect(await badge(page)).toBe("2");

  expect(await run(page, "close-duplicates")).toEqual({ action: "close-duplicates", count: 0 });

  expect(await run(page, "undo")).toEqual({ action: "undo", count: 2 });
  expect(await windowTabs(page)).toEqual(before);
  await expect(page).toHaveURL(/options\.html$/);
  expect(await page.evaluate(async () => (await chrome.tabs.getCurrent())?.active)).toBe(true);

  expect(await run(page, "undo")).toEqual({ action: "undo", count: 0 });
});

test("undo restores the tabs Nook closed, not a later tab the user closed at the same address", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await openTabs(context, ["http://a.example.com/x", "http://a.example.com/x#part"]);
  const before = await windowTabs(page);
  expect(await run(page, "close-duplicates")).toEqual({ action: "close-duplicates", count: 1 });
  // Nook found its own recently closed entry, so undo can restore the tab with its history.
  const sessionId = await page.evaluate(async () => {
    const { "tabs.undo": record } = await chrome.storage.session.get("tabs.undo");
    return (record as { tabs: { sessionId?: string }[] }).tabs[0]?.sessionId;
  });
  expect(sessionId).toEqual(expect.any(String));

  // The user opens the same address again and closes it themselves.
  await openTabs(context, ["http://a.example.com/x#part"]);
  await page.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const last = tabs[tabs.length - 1];
    if (last?.id !== undefined) await chrome.tabs.remove(last.id);
  });
  const userEntry = await page.evaluate(async () => (await chrome.sessions.getRecentlyClosed())[0]?.tab?.sessionId);

  expect(await run(page, "undo")).toEqual({ action: "undo", count: 1 });
  expect(await windowTabs(page)).toEqual(before);
  // The user's own closed tab is still waiting in the recently closed list.
  expect(await page.evaluate(async () => (await chrome.sessions.getRecentlyClosed())[0]?.tab?.sessionId)).toBe(
    userEntry,
  );
});

test("undo brings back a group that closing its duplicate tabs emptied", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await openTabs(context, ["http://a.example.com/x", "http://a.example.com/x#one", "http://a.example.com/x#two"]);
  await page.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const ids = tabs.slice(-2).map((t) => t.id) as [number, number];
    const groupId = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(groupId, { title: "Mine", color: "red" });
  });
  const before = await windowTabs(page);

  expect(await run(page, "close-duplicates")).toEqual({ action: "close-duplicates", count: 2 });
  expect((await windowTabs(page)).some((t) => t.group === "Mine")).toBe(false);

  // Push Nook's entries off the browser's recently closed list, so undo has to
  // reopen by URL and make the group itself.
  for (let i = 0; i < 25; i++) {
    await openTabs(context, [`http://filler.test/${i}`]);
    await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const last = tabs[tabs.length - 1];
      if (last?.id !== undefined) await chrome.tabs.remove(last.id);
    });
  }

  expect(await run(page, "undo")).toEqual({ action: "undo", count: 2 });
  expect(await windowTabs(page)).toEqual(before);
});

test("group by site groups by registrable domain, and undo puts every tab back", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await openTabs(context, [
    "http://news.example.co.uk/a",
    "http://docs.example.com/",
    "http://other.test/",
    "http://www.example.co.uk/b",
    "http://www.example.com/c",
  ]);

  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 4 });
  const grouped = await windowTabs(page);
  expect(grouped.filter((t) => t.group === "example.co.uk").map((t) => t.url)).toEqual([
    "http://news.example.co.uk/a",
    "http://www.example.co.uk/b",
  ]);
  expect(grouped.filter((t) => t.group === "example.com").map((t) => t.url)).toEqual([
    "http://docs.example.com/",
    "http://www.example.com/c",
  ]);
  expect(grouped.find((t) => t.url === "http://other.test/")?.group).toBeUndefined();

  // A tab opened later joins its site's existing group on the next run.
  await openTabs(context, ["http://shop.example.com/"]);
  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 1 });
  expect((await windowTabs(page)).find((t) => t.url === "http://shop.example.com/")?.group).toBe("example.com");

  // Undo reverses the last run only.
  expect(await run(page, "undo")).toEqual({ action: "undo", count: 1 });
  expect((await windowTabs(page)).filter((t) => t.group === "example.com")).toHaveLength(2);
});

test("undo still works after the service worker restarts", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await openTabs(context, ["http://a.example.com/", "http://b.example.org/", "http://c.example.com/"]);
  const before = await windowTabs(page);
  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 2 });

  // Stop the service worker, as the browser does when it is idle, and wait until it has stopped.
  const cdp = await context.newCDPSession(page);
  const stopped = new Promise<void>((resolve) =>
    cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
      if (versions.some((v) => v.runningStatus === "stopped")) resolve();
    }),
  );
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await stopped;
  await cdp.detach();

  expect(await run(page, "undo")).toEqual({ action: "undo", count: 2 });
  expect(await windowTabs(page)).toEqual(before);
});
