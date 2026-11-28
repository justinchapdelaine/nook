// Group tabs by topic, against the scripted fake engine (tests/e2e/fake-engine.ts),
// which groups each tab, or each site's tabs, by the first word of its title.
import type { Page } from "@playwright/test";
import { expect, nookTest as test } from "./fixtures";
import { badge, closeLastTab, openSettings, openTabs, run, windowTabs } from "./tab-helpers";

async function downloadModel(page: Page) {
  await page.getByRole("button", { name: /^Download Qwen3\.5 2B/ }).click();
  await expect(page.locator("#model-status")).toHaveText("Qwen3.5 2B is downloaded and ready.");
}

/** The window's groups, by title, each with its tabs' URLs. */
async function groupsOf(page: Page) {
  const groups: Record<string, string[]> = {};
  for (const tab of await windowTabs(page)) {
    if (tab.group !== undefined) groups[tab.group] = [...(groups[tab.group] ?? []), tab.url ?? ""];
  }
  return groups;
}

const tooltip = (page: Page) => page.evaluate(() => chrome.action.getTitle({}));

test.beforeEach(async ({ context, extensionId }) => {
  const page = context.pages()[0] ?? (await context.newPage());
  await openSettings(page, extensionId);
});

test("with the model, tabs are grouped by topic, a site's tabs stay together, and undo puts them back", async ({
  context,
}) => {
  const page = context.pages()[0] as Page;
  await downloadModel(page);
  await openTabs(page, [
    ["http://food.test/soup", "Recipe: lentil soup"],
    ["http://code.test/pr", "Code review"],
    ["http://bake.test/bread", "Recipe for bread"],
    ["http://code.test/issue", "Issue 42"],
    ["http://news.test/", "Weather today"],
  ]);
  const before = await windowTabs(page);

  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 4, by: "topic" });
  expect(await groupsOf(page)).toEqual({
    Recipe: ["http://food.test/soup", "http://bake.test/bread"],
    // Both code.test tabs went to the model as one item, named after its first title.
    Code: ["http://code.test/pr", "http://code.test/issue"],
  });
  expect(await badge(page)).toBe("4");
  expect(await tooltip(page)).toBe("Nook: grouped 4 tabs by topic");

  expect(await run(page, "undo")).toEqual({ action: "undo", count: 4 });
  expect(await windowTabs(page)).toEqual(before);
});

test("a new tab joins the existing group the model names", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await downloadModel(page);
  await openTabs(page, [
    ["http://a.test/", "Trip to Lisbon"],
    ["http://b.test/", "Trip hotels"],
  ]);
  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 2, by: "topic" });

  await openTabs(page, [["http://c.test/", "Trip museums"]]);
  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 1, by: "topic" });
  expect(await groupsOf(page)).toEqual({ Trip: ["http://a.test/", "http://b.test/", "http://c.test/"] });
});

test("tabs closed while the model answers are left out, and the badge shows the wait", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await downloadModel(page);
  await openTabs(page, [
    ["http://a.test/", "Slow one"],
    ["http://b.test/", "Slow two"],
    ["http://c.test/", "Slow three"],
  ]);
  const result = run(page, "group-tabs");
  await expect.poll(() => badge(page)).toBe("…");
  await closeLastTab(page);
  expect(await result).toEqual({ action: "group-tabs", count: 2, by: "topic" });
  expect(await groupsOf(page)).toEqual({ Slow: ["http://a.test/", "http://b.test/"] });
});

test("a reply that doesn't check out is asked for again", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await downloadModel(page);
  await openTabs(page, [
    ["http://a.test/", "Garden flaky tomatoes"],
    ["http://b.test/", "Garden tools"],
  ]);
  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 2, by: "topic" });
  expect(await groupsOf(page)).toEqual({ Garden: ["http://a.test/", "http://b.test/"] });
});

test("when the model's answers don't check out twice, tabs are grouped by site", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await downloadModel(page);
  await openTabs(page, [
    ["http://a.example.com/", "badjson one"],
    ["http://b.example.com/", "Two"],
    ["http://other.test/", "Three"],
  ]);
  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 2, by: "site" });
  expect(await groupsOf(page)).toEqual({ "example.com": ["http://a.example.com/", "http://b.example.com/"] });
  expect(await tooltip(page)).toBe("Nook: grouped 2 tabs by site");
});

test("without a downloaded model, tabs are grouped by site", async ({ context }) => {
  const page = context.pages()[0] as Page;
  await openTabs(page, [
    ["http://a.example.com/", "Recipe one"],
    ["http://b.example.com/", "Code two"],
    ["http://food.test/", "Recipe three"],
  ]);
  expect(await run(page, "group-tabs")).toEqual({ action: "group-tabs", count: 2, by: "site" });
  expect(await groupsOf(page)).toEqual({ "example.com": ["http://a.example.com/", "http://b.example.com/"] });
});
