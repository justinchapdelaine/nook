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
  /** Port of a local web server that answers each path in PAGES with that page, and any other with a small test page. */
  sitePort: number;
}

/** Fixed pages the test server knows, by path. */
const PAGES: Record<string, string> = {
  "/french": `<!doctype html><html lang="en"><title>Article</title>
    <p id="text">Le chat dort sur le canapé depuis ce matin, et personne ne veut le réveiller.</p>`,
  "/form": `<!doctype html><html lang="en"><title>Form</title>
    <textarea id="field">Le chat dort sur le canapé depuis ce matin.</textarea>`,
  "/english": `<!doctype html><html lang="en"><title>Article</title>
    <p id="text">The cat has been asleep on the sofa since this morning, and nobody wants to wake it.</p>`,
};

/**
 * A Playwright test that loads one built extension in headless Chromium.
 * Every host name resolves to a local web server, so tests can open tabs on
 * any site (`https` is not served, so use `http://` URLs). With network on,
 * only example.com and names ending in .test do.
 */
function extensionTest(outputDir: string, { network = false } = {}) {
  const extension = join(ROOT, outputDir);
  return base.extend<Fixtures, WorkerFixtures>({
    sitePort: [
      // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the object pattern.
      async ({}, use) => {
        // The pages are fixed and never echo the request, so nothing a test sends can end up as markup.
        const server = createServer((request, response) => {
          response.setHeader("content-type", "text/html; charset=utf-8");
          const path = URL.parse(request.url ?? "/", "http://localhost")?.pathname ?? "/";
          response.end(PAGES[path] ?? "<!doctype html><title>Test page</title><p>Test page");
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
          // With network on, only example.com and *.test go to the local server and the rest to the internet.
          `--host-resolver-rules=${network ? `MAP example.com 127.0.0.1:${sitePort}, MAP *.test 127.0.0.1:${sitePort}` : `MAP * 127.0.0.1:${sitePort}`}`,
        ],
        // The cloud test environment reaches the internet through a proxy.
        proxy:
          network && process.env.HTTPS_PROXY
            ? { server: process.env.HTTPS_PROXY, bypass: "example.com, *.test" }
            : undefined,
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

/**
 * Nook with the real WebLLM engine (npm run build:smoke), for the real-model
 * smoke test. It can reach the internet, to download model weights.
 */
export const smokeTest = extensionTest("extension/.output/chrome-mv3-smoke", { network: true });

export const expect = base.expect;
