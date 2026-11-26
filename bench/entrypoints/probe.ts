// Injected into a web page from the page context menu (E7): checks that a
// content script can reach the offscreen host directly over a runtime port,
// and times the round trip.
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { HostClient } from "../lib/client";
import { KEYS } from "../lib/storage-keys";

export default defineUnlistedScript(async () => {
  const toast = document.createElement("div");
  toast.style.cssText =
    "position:fixed;z-index:2147483647;bottom:16px;right:16px;padding:8px 12px;border-radius:6px;" +
    "background:#222;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 2px 8px #0006";
  toast.textContent = "Nook Bench: testing the model connection…";
  document.documentElement.append(toast);

  const client = new HostClient("offscreen");
  const result: Record<string, unknown> = { at: Date.now(), origin: location.origin };
  try {
    const start = performance.now();
    const status = await client.request({ type: "status" });
    result.statusRoundTripMs = performance.now() - start;
    result.loaded = status.loaded?.modelId ?? null;
    if (status.loaded) {
      const reply = await client.request({
        type: "generate",
        request: {
          messages: [{ role: "user", content: "Say hello in French, one word." }],
          maxTokens: 16,
          temperature: 0,
          enableThinking: false,
        },
      });
      result.ttftMs = reply.ttftMs;
      result.reply = reply.text;
    }
    toast.textContent = `Nook Bench: connected in ${Math.round(result.statusRoundTripMs as number)} ms.`;
  } catch (error) {
    result.error = String(error);
    toast.textContent = `Nook Bench: connection failed (${result.error}).`;
  } finally {
    client.disconnect();
    await chrome.storage.local.set({ [KEYS.probe]: result });
    setTimeout(() => toast.remove(), 4000);
  }
});
