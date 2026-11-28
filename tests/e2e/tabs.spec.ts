import type { Page } from "@playwright/test";
import { UNDO_KEY } from "../../extension/features/tabs/undo";
import { expect, nookTest as test } from "./fixtures";
import { badge, closeLastTab, openSettings, openTabs, run, windowTabs } from "./tab-helpers";

test.beforeEach(async ({ context, extensionId }) => {
  // Use the first tab for the settings page, so the window holds only it and the tabs a test opens.
  const page = context.pages()[0] ?? (await context.newPage());
  await openSettings(page, extensionId);
});

test("the settings page lists the shortcuts and shows tab access", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await expect(page.locator("#access")).toContainText("can read your tabs");
  await expect(page.locator("#shortcuts dd")).toHaveText([
    "Translate the selected text",
    "Group tabs by topic or site",
    "Close duplicate tabs",
    "Undo the last tab change",
  ]);
  // Every suggested key was accepted; the browser leaves a key it refuses unset.
  await expect(page.locator("#shortcuts dt")).toHaveText(["Alt+Shift+L", "Alt+Shift+G", "Alt+Shift+D", "Alt+Shift+U"]);
});

test("close duplicates keeps one tab per page, and undo brings the others back", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await openTabs(page, [
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
  await openTabs(page, ["http://a.example.com/x", "http://a.example.com/x#part"]);
  const before = await windowTabs(page);
  expect(await run(page, "close-duplicates")).toEqual({ action: "close-duplicates", count: 1 });
  // Nook found its own recently closed entry, so undo can restore the tab with its history.
  const sessionId = await page.evaluate(async (key) => {
    const { [key]: record } = await chrome.storage.session.get(key);
    return (record as { tabs: { sessionId?: string }[] }).tabs[0]?.sessionId;
  }, UNDO_KEY);
  expect(sessionId).toEqual(expect.any(String));

  // The user opens the same address again and closes it themselves.
  await openTabs(page, ["http://a.example.com/x#part"]);
  await closeLastTab(page);
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
  await openTabs(page, ["http://a.example.com/x", "http://a.example.com/x#one", "http://a.example.com/x#two"]);
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
    await openTabs(page, [`http://filler.test/${i}`]);
    await closeLastTab(page);
  }

  expect(await run(page, "undo")).toEqual({ action: "undo", count: 2 });
  // A tab reopened by URL reports an empty URL until its navigation commits.
  await expect.poll(() => windowTabs(page)).toEqual(before);
});

test("group by site groups by registrable domain, and undo puts every tab back", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await openTabs(page, [
    "http://news.example.co.uk/a",
    "http://docs.example.com/",
    "http://other.test/",
    "http://www.example.co.uk/b",
    "http://www.example.com/c",
  ]);

  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 4, by: "site" });
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
  await openTabs(page, ["http://shop.example.com/"]);
  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 1, by: "site" });
  expect((await windowTabs(page)).find((t) => t.url === "http://shop.example.com/")?.group).toBe("example.com");

  // Undo reverses the last run only.
  expect(await run(page, "undo")).toEqual({ action: "undo", count: 1 });
  expect((await windowTabs(page)).filter((t) => t.group === "example.com")).toHaveLength(2);
});

test("undo still works after the service worker restarts", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await openTabs(page, ["http://a.example.com/", "http://b.example.org/", "http://c.example.com/"]);
  const before = await windowTabs(page);
  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 2, by: "site" });

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
