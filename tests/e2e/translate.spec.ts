// Translate selection and the model setup, against the scripted fake engine
// (tests/e2e/fake-engine.ts), which "translates" by upper-casing the text.
import type { Page } from "@playwright/test";
import { expect, nookTest as test } from "./fixtures";
import { bubble, pickTranslateSelection, settings, translateOn } from "./translate-helpers";

async function openSettings(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator("#model-status")).not.toBeEmpty();
}

async function download(page: Page, extensionId: string) {
  await openSettings(page, extensionId);
  await page.getByRole("button", { name: /^Download Qwen3\.5 2B/ }).click();
  await expect(page.locator("#model-status")).toHaveText("Qwen3.5 2B is downloaded and ready.");
}

test.beforeEach(async ({ serviceWorker }) => {
  await settings(serviceWorker, { targetLanguage: "en" });
});

test("the settings page downloads and deletes the model, and says the download is the only network use", async ({
  page,
  extensionId,
}) => {
  await openSettings(page, extensionId);
  await expect(page.locator("#model")).toContainText("That download is the only time Nook uses the network");
  await expect(page.locator("#model-status")).toHaveText("Qwen3.5 2B isn't downloaded yet. Translation needs it.");
  await expect(page.getByRole("radio", { name: /Qwen3\.5 2B/ })).toBeChecked();
  await expect(page.getByText(/Qwen3\.5 0\.8B.*translates noticeably worse/)).toBeVisible();
  await page.getByRole("button", { name: "Download Qwen3.5 2B (1.1 GB)" }).click();
  await expect(page.locator("#model-status")).toHaveText("Qwen3.5 2B is downloaded and ready.");
  await page.reload();
  await expect(page.locator("#model-status")).toHaveText("Qwen3.5 2B is downloaded and ready.");
  await page.getByRole("button", { name: "Delete Qwen3.5 2B" }).click();
  await expect(page.locator("#model-status")).toHaveText("Qwen3.5 2B isn't downloaded yet. Translation needs it.");
});

test("translating before the model is downloaded opens the download step", async ({ context, page, serviceWorker }) => {
  const opened = context.waitForEvent("page", (p) => p.url().endsWith("/options.html#model"));
  await translateOn(page, serviceWorker, "/french");
  await opened;
  await expect.poll(async () => (await bubble(page))?.status).toContain("needs to download its translation model");
});

test("a selection's translation streams into a bubble under it", async ({ page, extensionId, serviceWorker }) => {
  await download(page, extensionId);
  await translateOn(page, serviceWorker, "/french");
  await expect
    .poll(() => bubble(page))
    .toEqual({
      status: "Translated from French",
      text: "LE CHAT DORT SUR LE CANAPÉ DEPUIS CE MATIN, ET PERSONNE NE VEUT LE RÉVEILLER.",
    });
  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect.poll(() => bubble(page)).toBeNull();
});

test("the shortcut translates text selected inside a text field", async ({ page, extensionId, serviceWorker }) => {
  await download(page, extensionId);
  // A two-word selection is too short to detect, and the page says English, so ask for French.
  await settings(serviceWorker, { targetLanguage: "fr" });
  await page.goto("http://example.com/form");
  await page.evaluate(() => {
    const field = document.querySelector("#field") as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(0, 7);
  });
  // The shortcut passes no selection text; the translator must read the field's own selection.
  await pickTranslateSelection(serviceWorker, page.url());
  await expect.poll(async () => (await bubble(page))?.text).toBe("LE CHAT");
});

test("text already in the target language isn't translated", async ({ page, extensionId, serviceWorker }) => {
  await download(page, extensionId);
  await translateOn(page, serviceWorker, "/english");
  await expect.poll(async () => (await bubble(page))?.status).toBe("This is already in English.");
});

test("a reply that repeats itself is stopped", async ({ page, extensionId, serviceWorker }) => {
  await download(page, extensionId);
  await settings(serviceWorker, { targetLanguage: "fr" });
  await translateOn(page, serviceWorker, "/english", "Please loop around the garden and come back in time for dinner.");
  await expect
    .poll(() => bubble(page))
    .toEqual({ status: "Translated from English (stopped early: the reply began repeating itself)", text: "la" });
});

test("closing the bubble stops its reply, so the next one doesn't wait", async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  await download(page, extensionId);
  // About 30 seconds of slow reply.
  await translateOn(page, serviceWorker, "/french", `Un texte très slow ${"et encore ".repeat(25)}`);
  await expect.poll(async () => (await bubble(page))?.text).not.toBe("");
  await page.keyboard.press("Escape");
  await translateOn(page, serviceWorker, "/french");
  await expect.poll(async () => (await bubble(page))?.status, { timeout: 5_000 }).toBe("Translated from French");
});

test("the model host closes after its idle time and opens again on demand", async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  await download(page, extensionId);
  await page.goto("about:blank");
  await settings(serviceWorker, { idleMinutes: 0.02 });
  // The setting applies from the next time the host opens.
  await serviceWorker.evaluate(() => chrome.offscreen.closeDocument().catch(() => {}));
  await translateOn(page, serviceWorker, "/french");
  await expect.poll(async () => (await bubble(page))?.status).toBe("Translated from French");
  await expect
    .poll(() => serviceWorker.evaluate(() => chrome.offscreen.hasDocument()), { timeout: 10_000 })
    .toBe(false);
  await translateOn(page, serviceWorker, "/french");
  await expect.poll(async () => (await bubble(page))?.status).toBe("Translated from French");
});

test("sites where translation is off show it on the badge instead", async ({ page, serviceWorker }) => {
  await settings(serviceWorker, { excludedSites: ["example.com"] });
  await translateOn(page, serviceWorker, "/french");
  await expect.poll(() => serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe("off");
  expect(await bubble(page)).toBeNull();
});

test("a download keeps going when the settings page closes, and shows again when it reopens", async ({
  context,
  page,
  extensionId,
  serviceWorker,
}) => {
  await settings(serviceWorker, { model: "Qwen3.5-0.8B" });
  await openSettings(page, extensionId);
  await page.getByRole("button", { name: /^Download Qwen3\.5 0\.8B/ }).click();
  await expect(page.locator("#model-status")).toHaveText(/^Downloading/);
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(reopened.locator("#model-status")).toHaveText(/^Downloading/);
  await expect(reopened.locator("#download-progress")).toBeVisible();
  await expect(reopened.locator("#model-status")).toHaveText("Qwen3.5 0.8B is downloaded and ready.", {
    timeout: 10_000,
  });
});

test("an open settings page doesn't keep the model loaded, and a new idle time applies at once", async ({
  context,
  page,
  extensionId,
  serviceWorker,
}) => {
  await download(page, extensionId);
  await translateOn(page, serviceWorker, "/french");
  await expect.poll(async () => (await bubble(page))?.status).toBe("Translated from French");
  // The settings page stays open in another tab while the idle time is shortened.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.locator("#model-status")).toHaveText("Qwen3.5 2B is downloaded and ready.");
  expect(await serviceWorker.evaluate(() => chrome.offscreen.hasDocument())).toBe(true);
  // Set it the way the select does, with a time short enough for a test.
  await options.evaluate(async () => {
    const stored = (await chrome.storage.local.get("settings")).settings ?? {};
    await chrome.storage.local.set({ settings: { ...stored, idleMinutes: 0.02 } });
    await chrome.runtime.sendMessage({ type: "offscreen:idle-minutes", minutes: 0.02 }).catch(() => {});
  });
  await expect
    .poll(() => serviceWorker.evaluate(() => chrome.offscreen.hasDocument()), { timeout: 10_000 })
    .toBe(false);
});

test("runs the source has too, such as dot leaders, come through whole", async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  await download(page, extensionId);
  const line = `Chapitre premier, où tout commence ${".".repeat(48)} 5`;
  await translateOn(page, serviceWorker, "/french", line);
  await expect.poll(async () => (await bubble(page))?.status).toBe("Translated from French");
  expect((await bubble(page))?.text).toBe(line.toUpperCase());
});

test("Markdown emphasis the source didn't have is left out", async ({ page, extensionId, serviceWorker }) => {
  await download(page, extensionId);
  await translateOn(page, serviceWorker, "/french", "Le chat dort sur le canapé depuis ce matin, en markdown.");
  await expect.poll(async () => (await bubble(page))?.status).toMatch(/^Translated/);
  expect((await bubble(page))?.text).toBe("LE CHAT DORT SUR LE CANAPÉ DEPUIS CE MATIN, EN MARKDOWN.");
});
