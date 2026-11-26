// Offscreen document: relays host requests from runtime ports to the
// engine worker, which keeps inference off this document's main thread.
import type { WorkerIn, WorkerOut } from "../../lib/engine-worker";
import type { ControlMessage } from "../../lib/protocol";
import { portName } from "../../lib/protocol";

const worker = new Worker(new URL("../../lib/engine-worker.ts", import.meta.url), { type: "module" });
const ports = new Map<number, chrome.runtime.Port>();
let nextPortId = 1;

worker.addEventListener("message", (event: MessageEvent<WorkerOut>) => {
  ports.get(event.data.portId)?.postMessage(event.data.response);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== portName("offscreen")) return;
  const portId = nextPortId++;
  ports.set(portId, port);
  port.onDisconnect.addListener(() => ports.delete(portId));
  port.onMessage.addListener((envelope) => worker.postMessage({ portId, envelope } satisfies WorkerIn));
});

chrome.runtime.sendMessage({ type: "offscreen:ready" } satisfies ControlMessage);
