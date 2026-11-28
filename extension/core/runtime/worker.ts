// The offscreen document's dedicated worker, which keeps inference off the
// document's main thread. Messages carry the id of the client port they
// came from, so replies go back to the right client.
import { createHost } from "./host";
import type { ClientMessage, HostMessage } from "./protocol";
import { createEngine } from "./webllm";

export type WorkerIn = { portId: number; message: ClientMessage } | { portId: number; disconnected: true };
export type WorkerOut = { portId: number; message: HostMessage } | { busy: boolean };

const post = (out: WorkerOut) => self.postMessage(out);
const host = createHost(createEngine(), (busy) => post({ busy }));

self.addEventListener("message", (event: MessageEvent<WorkerIn>) => {
  const data = event.data;
  if ("disconnected" in data) host.disconnected(data.portId);
  else host.receive(data.portId, data.message, (message) => post({ portId: data.portId, message }));
});
