// End to end with the real model: the settings page downloads Qwen3.5 0.8B
// (the q4f32 build, since the cloud's software GPU has no shader-f16), a
// selection is translated, and a reply is cancelled part-way. It skips itself
// when the weights can't be downloaded.
import type { Page, Worker } from "@playwright/test";
import { expect, smokeTest as test } from "../e2e/fixtures";
import { bubble, settings, translateOn } from "../e2e/translate-helpers";

const WEIGHTS = "https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f32_1-MLC/resolve/main/mlc-chat-config.json";

async function downloadLightModel(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole("radio", { name: /Qwen3\.5 0\.8B/ })).toBeChecked();
  await page.getByRole("button", { name: /^Download Qwen3\.5 0\.8B/ }).click();
  await expect(page.locator("#model-status")).toHaveText("Qwen3.5 0.8B is downloaded and ready.", {
    timeout: 20 * 60_000,
  });
}

const finished = async (page: Page) => (await bubble(page))?.status ?? "";

test("the real model downloads, translates a selection and stops when cancelled", async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  const reachable = await fetch(WEIGHTS, { method: "HEAD" }).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!reachable, "The model weights can't be downloaded from here");

  await settings(serviceWorker as Worker, { targetLanguage: "en", model: "Qwen3.5-0.8B" });
  await downloadLightModel(page, extensionId);

  await translateOn(page, serviceWorker, "/french");
  await expect.poll(() => finished(page), { timeout: 10 * 60_000, intervals: [2_000] }).toMatch(/^Translated/);
  const { text } = (await bubble(page)) ?? { text: "" };
  console.log(`Translation: ${text}`);
  expect(text.length).toBeGreaterThan(10);
  expect(text).not.toContain("Le chat");
  expect(text).toMatch(/cat/i);

  // A long reply, cancelled once it starts; the next request must not wait for it.
  await translateOn(page, serviceWorker, "/french", "Le chat dort. ".repeat(60));
  await expect.poll(async () => (await bubble(page))?.text ?? "", { timeout: 10 * 60_000 }).not.toBe("");
  await page.keyboard.press("Escape");
  const start = Date.now();
  await translateOn(page, serviceWorker, "/french", "Bonjour.");
  await expect.poll(() => finished(page), { timeout: 10 * 60_000, intervals: [2_000] }).toMatch(/^Translated/);
  console.log(`Short reply after a cancel took ${((Date.now() - start) / 1000).toFixed(1)} s`);
});
