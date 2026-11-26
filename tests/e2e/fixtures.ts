import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Worker } from "@playwright/test";
import { test as base, chromium } from "@playwright/test";

const EXTENSION = join(import.meta.dirname, "../../bench/.output/chrome-mv3");

export const test = base.extend<{ context: BrowserContext; extensionId: string; serviceWorker: Worker }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the object pattern.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "nook-bench-")), {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, "--enable-unsafe-webgpu"],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;
