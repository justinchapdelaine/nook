import type { Page } from "@playwright/test";
import { expect, benchTest as test } from "./fixtures";

async function openBench(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/bench.html`);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
}

async function results(page: Page) {
  return JSON.parse(await page.locator("#results").inputValue());
}

test("the page loads without touching the network for models", async ({ context, page, extensionId }) => {
  const remote: string[] = [];
  context.on("request", (request) => {
    if (!request.url().startsWith("chrome-extension://")) remote.push(request.url());
  });
  await openBench(page, extensionId);
  await expect(page.locator("#models tr")).toHaveCount(5);
  await expect(page.locator("#models button", { hasText: "Download" }).first()).toBeVisible();
  const block = await results(page);
  expect(block.schema).toBe("nook-bench/1");
  expect(block.env.gpu, JSON.stringify(block.env.gpu)).toMatchObject({ available: true });
  expect(remote).toEqual([]);
});

test("E0: both hosts see WebGPU and compile every packaged model library", async ({ page, extensionId }) => {
  await openBench(page, extensionId);
  const card = page.locator('[data-exp="e0"]');
  await card.getByRole("button", { name: "Run" }).click();
  await expect(card.locator(".status")).toHaveText(/Finished|error/, { timeout: 90_000 });
  const { e0 } = await results(page);
  expect(e0.error).toBeUndefined();
  for (const host of ["offscreen", "sw"]) {
    expect(e0.hosts[host].gpu.available).toBe(true);
    expect(e0.hosts[host].libs).toHaveLength(5);
    for (const lib of e0.hosts[host].libs) {
      expect(lib.error).toBeUndefined();
      expect(lib.sha256Ok).toBe(true);
    }
  }
});

test("E7: menus register and the automatic tab checks pass", async ({ page, extensionId }) => {
  await openBench(page, extensionId);
  const card = page.locator('[data-exp="e7"]');
  await card.getByRole("button", { name: "Run automatic checks" }).click();
  // The run asks whether the tab group is visible; answer Done.
  await page.locator("#step-dialog").getByRole("button", { name: "Done" }).click();
  await expect(card.locator(".status")).toHaveText(/Finished|error/, { timeout: 60_000 });
  const { e7 } = await results(page);
  expect(e7.error).toBeUndefined();
  expect(e7.menus).toEqual({ "tab-a": "ok", "tab-b": "ok", "request-tabs": "ok", probe: "ok" });
  expect(e7.tabGroup).toEqual({ grouped: true, userSawGroup: true });
  expect(e7.publicSuffix["news.bbc.co.uk"]).toBe("bbc.co.uk");
  expect(e7.detectLanguage.fra.top[0]).toMatch(/^fr /);
  expect(e7.restore).toMatchObject({ found: true, restored: true });
});

test("model experiments skip models that are not downloaded, and results survive a reload", async ({
  page,
  extensionId,
}) => {
  await openBench(page, extensionId);
  const card = page.locator('[data-exp="e2"]');
  await card.getByRole("button", { name: "Run" }).click();
  await expect(card.locator(".status")).toHaveText(/Finished/, { timeout: 30_000 });
  await expect(card.locator(".log")).toContainText("Skipping Qwen3.5 2B");
  // The results box refreshes just after the status line, so wait for it.
  await expect.poll(async () => (await results(page)).e2?.models).toEqual({});
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  expect((await results(page)).e2.models).toEqual({});
});
