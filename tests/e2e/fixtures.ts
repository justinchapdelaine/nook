import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Worker } from "@playwright/test";
import { test as base, chromium } from "@playwright/test";

const ROOT = join(import.meta.dirname, "../..");

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}

interface WorkerFixtures {
  /** Port of a local web server that answers every path with a small page titled after it. */
  sitePort: number;
}

/**
 * A Playwright test that loads one built extension in headless Chromium.
 * Every host name resolves to a local web server, so tests can open tabs on
 * any site (`https` is not served, so use `http://` URLs).
 */
function extensionTest(outputDir: string) {
  const extension = join(ROOT, outputDir);
  return base.extend<Fixtures, WorkerFixtures>({
    sitePort: [
      // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the object pattern.
      async ({}, use) => {
        const server = createServer((request, response) => {
          response.setHeader("content-type", "text/html");
          response.end(`<!doctype html><title>${request.headers.host}${request.url}</title><p>Test page`);
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        await use((server.address() as AddressInfo).port);
        server.close();
      },
      { scope: "worker" },
    ],
    context: async ({ sitePort }, use) => {
      const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "nook-e2e-")), {
        channel: "chromium",
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
          "--enable-unsafe-webgpu",
          `--host-resolver-rules=MAP * 127.0.0.1:${sitePort}`,
        ],
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
}

/** Nook Bench (npm run bench:build). */
export const benchTest = extensionTest("bench/.output/chrome-mv3");

/** Nook, built for tests (npm run build:e2e): the same as the store build, but with tab access granted at install. */
export const nookTest = extensionTest("extension/.output/chrome-mv3-e2e");

export const expect = base.expect;
