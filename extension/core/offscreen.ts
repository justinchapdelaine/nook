// Service worker side of the offscreen document that hosts the model.
// Opening and closing run one after another, so a request that arrives while
// an idle document is closing waits for the close and then opens a new one.
import type { OffscreenMessage } from "./runtime/protocol";
import { getSettings } from "./settings";

const OFFSCREEN_PATH = "/offscreen.html";
const READY_TIMEOUT_MS = 15_000;

let last: Promise<unknown> = Promise.resolve();

function inTurn<T>(step: () => Promise<T>): Promise<T> {
  const next = last.then(step, step);
  last = next.catch(() => {});
  return next;
}

/** Opens the offscreen document if it isn't open, and resolves once it listens for ports. */
export function ensureOffscreen(): Promise<void> {
  return inTurn(async () => {
    if (await chrome.offscreen.hasDocument()) return;
    // createDocument can resolve before the document's script has added its
    // port listener, and a port opened before then never reaches it. Wait
    // for the document to say it is ready.
    let listener: ((message: OffscreenMessage) => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      listener = (message) => {
        if (message?.type === "offscreen:ready") resolve();
      };
      chrome.runtime.onMessage.addListener(listener);
      setTimeout(() => reject(new Error("The model host didn't start")), READY_TIMEOUT_MS);
    }).finally(() => {
      if (listener) chrome.runtime.onMessage.removeListener(listener);
    });
    ready.catch(() => {}); // Handled below; this keeps a failed createDocument from leaving it unhandled.
    const { idleMinutes } = await getSettings();
    await chrome.offscreen.createDocument({
      url: `${OFFSCREEN_PATH}?idleMinutes=${encodeURIComponent(idleMinutes)}`,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs Nook's on-device language model in a dedicated worker.",
    });
    await ready;
  });
}

/** Closes the offscreen document, which unloads the model and frees its GPU memory. */
export function closeOffscreen(): Promise<void> {
  return inTurn(async () => {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  });
}
