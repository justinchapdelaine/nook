// Offscreen document: the home of the engine worker. It relays client ports
// to the worker and closes itself, through the service worker, once nothing
// has needed the model for the idle time in its URL (?idleMinutes=10), which
// frees GPU memory. It reopens on the next request and reloads from cache.

import type { OffscreenMessage } from "../../core/runtime/protocol";
import { HOST_PORT } from "../../core/runtime/protocol";
import type { WorkerIn, WorkerOut } from "../../core/runtime/worker";

const idleMs = Number(new URLSearchParams(location.search).get("idleMinutes") ?? 10) * 60_000;

const worker = new Worker(new URL("../../core/runtime/worker.ts", import.meta.url), { type: "module" });
const ports = new Map<number, chrome.runtime.Port>();
let nextPortId = 1;
let busy = false;
let closing = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Idle means no client connected and no work queued or running (a download can outlive its settings page). */
function checkIdle(): void {
  clearTimeout(idleTimer);
  if (busy || ports.size > 0) return;
  idleTimer = setTimeout(() => {
    closing = true;
    chrome.runtime.sendMessage({ type: "offscreen:idle" } satisfies OffscreenMessage).catch(() => {});
  }, idleMs);
}

worker.addEventListener("message", (event: MessageEvent<WorkerOut>) => {
  const data = event.data;
  if ("busy" in data) {
    busy = data.busy;
    checkIdle();
  } else {
    ports.get(data.portId)?.postMessage(data.message);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== HOST_PORT) return;
  // Closing: turn the client away, so it opens a fresh document instead of waiting on this one.
  if (closing) return port.disconnect();
  const portId = nextPortId++;
  ports.set(portId, port);
  checkIdle();
  port.onDisconnect.addListener(() => {
    ports.delete(portId);
    worker.postMessage({ portId, disconnected: true } satisfies WorkerIn);
    checkIdle();
  });
  port.onMessage.addListener((message) => worker.postMessage({ portId, message } satisfies WorkerIn));
});

checkIdle();
chrome.runtime.sendMessage({ type: "offscreen:ready" } satisfies OffscreenMessage).catch(() => {});
