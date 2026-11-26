// Client side of the host protocol, for the benchmark page and the probe
// content script. Connects lazily; if the port drops (for example the
// service worker stopped), pending requests fail and the next request
// reconnects.
import type {
  HostName,
  HostRequest,
  HostResults,
  OffscreenEnsureResult,
  RequestEnvelope,
  ResponseEnvelope,
} from "./protocol";
import { portName } from "./protocol";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (text: string) => void;
};

export class HostClient {
  private port: chrome.runtime.Port | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(readonly host: HostName) {}

  async request<T extends HostRequest>(
    request: T,
    onProgress?: (text: string) => void,
  ): Promise<HostResults[T["type"]]> {
    const port = await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
      port.postMessage({ id, request } satisfies RequestEnvelope);
    });
  }

  disconnect(): void {
    this.port?.disconnect();
    this.dropped(new Error("Disconnected"));
  }

  private async connect(): Promise<chrome.runtime.Port> {
    // The service worker also holds every port, so a port to a closed offscreen document
    // never reports a disconnect. Check the document still exists before reusing the port.
    if (this.port && this.host === "offscreen" && !(await offscreenExists()))
      this.dropped(new Error("Offscreen document closed"));
    if (this.port) return this.port;
    // A port only reaches the offscreen document if it exists when connecting.
    if (this.host === "offscreen") await ensureOffscreen();
    if (this.port) return this.port;
    const port = chrome.runtime.connect({ name: portName(this.host) });
    port.onMessage.addListener((message: ResponseEnvelope) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (message.kind === "progress") return pending.onProgress?.(message.text);
      this.pending.delete(message.id);
      if (message.kind === "result") pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
    port.onDisconnect.addListener(() => this.dropped(new Error(`${this.host} host disconnected`)));
    this.port = port;
    return port;
  }

  private dropped(error: Error): void {
    this.port = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

async function offscreenExists(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<OffscreenEnsureResult> {
  const result = (await chrome.runtime.sendMessage({ type: "offscreen:ensure" })) as
    | OffscreenEnsureResult
    | { error: string };
  if ("error" in result) throw new Error(`Could not open the offscreen document: ${result.error}`);
  return result;
}

/** Closes the offscreen document. Drops the client's port first so no request goes to the closing document. */
export async function closeOffscreen(client: HostClient): Promise<void> {
  client.disconnect();
  await chrome.runtime.sendMessage({ type: "offscreen:close" });
}
