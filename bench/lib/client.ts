// Client side of the host protocol, for the benchmark page and the probe
// content script. Connects lazily; if the port drops (for example the
// service worker stopped), pending requests fail and the next request
// reconnects.
//
// The other contexts that listen for ports keep a port open after its host
// dies (Chrome can stop the service worker in the middle of a reply), so a
// disconnect is not guaranteed. The host sends "alive" every few seconds per
// open request; if a pending request hears nothing for SILENCE_LIMIT_MS, the
// client treats the host as stopped and fails every pending request.
import type {
  HostName,
  HostRequest,
  HostResults,
  OffscreenEnsureResult,
  RequestEnvelope,
  ResponseEnvelope,
} from "./protocol";
import { HEARTBEAT_MS, portName } from "./protocol";

/** Longer than a heartbeat gap plus a slow WebLLM step that blocks the host's thread. */
const SILENCE_LIMIT_MS = 12 * HEARTBEAT_MS;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (text: string) => void;
  heardAt: number;
};

export class HostClient {
  private port: chrome.runtime.Port | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private watchdog: ReturnType<typeof setInterval> | undefined;

  constructor(readonly host: HostName) {}

  async request<T extends HostRequest>(
    request: T,
    onProgress?: (text: string) => void,
  ): Promise<HostResults[T["type"]]> {
    const port = await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress, heardAt: Date.now() });
      this.watchdog ??= setInterval(() => this.checkSilence(), HEARTBEAT_MS);
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
      pending.heardAt = Date.now();
      if (message.kind === "alive") return;
      if (message.kind === "progress") return pending.onProgress?.(message.text);
      this.pending.delete(message.id);
      if (this.pending.size === 0) this.stopWatchdog();
      if (message.kind === "result") pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
    port.onDisconnect.addListener(() => this.dropped(new Error(`${this.host} host disconnected`)));
    this.port = port;
    return port;
  }

  private checkSilence(): void {
    const now = Date.now();
    for (const pending of this.pending.values()) {
      if (now - pending.heardAt < SILENCE_LIMIT_MS) continue;
      this.port?.disconnect();
      this.dropped(new Error(`${this.host} host stopped responding (nothing heard for ${SILENCE_LIMIT_MS / 1000} s)`));
      return;
    }
  }

  private stopWatchdog(): void {
    clearInterval(this.watchdog);
    this.watchdog = undefined;
  }

  private dropped(error: Error): void {
    this.port = undefined;
    this.stopWatchdog();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

async function offscreenExists(): Promise<boolean> {
  // Content scripts have no getContexts; assume the document is there and let a failed request show it.
  if (!chrome.runtime.getContexts) return true;
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
