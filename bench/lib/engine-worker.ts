// Dedicated worker inside the offscreen document: the offscreen host.
// Messages carry the id of the runtime port they came from, so replies go
// back to the right client.
import { createHost } from "./host";
import type { RequestEnvelope, ResponseEnvelope } from "./protocol";

export type WorkerIn = { portId: number; envelope: RequestEnvelope };
export type WorkerOut = { portId: number; response: ResponseEnvelope };

const host = createHost("offscreen");

self.addEventListener("message", (event: MessageEvent<WorkerIn>) => {
  const { portId, envelope } = event.data;
  host.serve(envelope, (response) => self.postMessage({ portId, response } satisfies WorkerOut));
});
