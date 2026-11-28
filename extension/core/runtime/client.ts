// Client side of the host protocol, for any context that can open a runtime
// port: the settings page, the translator in a web page and the service
// worker (for tab grouping). It opens the offscreen document through the
// service worker, or directly when it runs there, connects when a request
// starts, and disconnects when none is left, so the host can tell it is idle.
//
// Only the offscreen document listens for HOST_PORT, so its closing
// disconnects the port. A host can also hang without closing; the host sends
// "alive" every HEARTBEAT_MS per open request, and a request that hears
// nothing for SILENCE_LIMIT_MS fails.

import { ensureOffscreen } from "../offscreen";
import type {
  ClientMessage,
  EnsureResult,
  HostErrorCode,
  HostMessage,
  HostRequest,
  HostResults,
  OffscreenMessage,
} from "./protocol";
import { HEARTBEAT_MS, HOST_PORT, SILENCE_LIMIT_MS } from "./protocol";

/** Opens the offscreen document. The service worker does it itself, since its messages never reach its own listener. */
async function ensureHost(): Promise<void> {
  if ("ServiceWorkerGlobalScope" in globalThis) return ensureOffscreen();
  const ready = (await chrome.runtime.sendMessage({ type: "offscreen:ensure" } satisfies OffscreenMessage)) as
    | EnsureResult
    | undefined;
  if (!ready?.ok) throw new HostRequestError(`Nook couldn't start its model host: ${ready?.error ?? "no reply"}`);
}

export class HostRequestError extends Error {
  constructor(
    message: string,
    readonly code?: HostErrorCode,
  ) {
    super(message);
    this.name = "HostRequestError";
  }
}

export interface RequestHandlers {
  onProgress?(text: string, fraction: number): void;
  onDelta?(text: string): void;
  /** The host put the request back in the queue; drop any text received so far. */
  onRestart?(): void;
}

export interface PendingRequest<T> {
  result: Promise<T>;
  cancel(): void;
}

interface Pending {
  request: HostRequest;
  handlers: RequestHandlers;
  heardAt: number;
  /** Whether anything came back yet. A request never heard from is sent again once if the port drops. */
  heard: boolean;
  retried: boolean;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class HostClient {
  private port: chrome.runtime.Port | undefined;
  private connecting: Promise<chrome.runtime.Port> | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private watchdog: ReturnType<typeof setInterval> | undefined;

  request<T extends HostRequest>(request: T, handlers: RequestHandlers = {}): PendingRequest<HostResults[T["type"]]> {
    const id = this.nextId++;
    const result = new Promise<HostResults[T["type"]]>((resolve, reject) => {
      this.pending.set(id, {
        request,
        handlers,
        heardAt: Date.now(),
        heard: false,
        retried: false,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
    this.watchdog ??= setInterval(() => this.checkSilence(), HEARTBEAT_MS);
    void this.send(id);
    return {
      result,
      cancel: () => {
        if (!this.pending.has(id)) return;
        this.port?.postMessage({ id, cancel: true } satisfies ClientMessage);
        this.settle(id, (p) => p.reject(new HostRequestError("Cancelled", "cancelled")));
      },
    };
  }

  private async send(id: number): Promise<void> {
    const pending = this.pending.get(id);
    if (!pending) return;
    try {
      const port = await this.connect();
      // Cancelled or failed while connecting.
      if (!this.pending.has(id)) return this.releaseIfIdle();
      port.postMessage({ id, request: pending.request } satisfies ClientMessage);
    } catch (error) {
      this.settle(id, (p) => p.reject(error instanceof Error ? error : new Error(String(error))));
    }
  }

  private async connect(): Promise<chrome.runtime.Port> {
    if (this.port) return this.port;
    this.connecting ??= (async () => {
      await ensureHost();
      const port = chrome.runtime.connect({ name: HOST_PORT });
      port.onMessage.addListener((message: HostMessage) => this.receive(message));
      port.onDisconnect.addListener(() => this.dropped(port));
      this.port = port;
      return port;
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private receive(message: HostMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    pending.heardAt = Date.now();
    pending.heard = true;
    if (message.kind === "progress") pending.handlers.onProgress?.(message.text, message.fraction);
    else if (message.kind === "delta") pending.handlers.onDelta?.(message.text);
    else if (message.kind === "restart") pending.handlers.onRestart?.();
    else if (message.kind === "result") this.settle(message.id, (p) => p.resolve(message.result));
    else if (message.kind === "error")
      this.settle(message.id, (p) => p.reject(new HostRequestError(message.error, message.code)));
  }

  private settle(id: number, outcome: (pending: Pending) => void): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    outcome(pending);
    this.releaseIfIdle();
  }

  /** With nothing left to wait for, let go of the host so it can go idle. */
  private releaseIfIdle(): void {
    if (this.pending.size > 0) return;
    clearInterval(this.watchdog);
    this.watchdog = undefined;
    const port = this.port;
    this.port = undefined;
    port?.disconnect();
  }

  /** The port closed (the document closed, or turned us away while closing). */
  private dropped(port: chrome.runtime.Port): void {
    if (this.port !== port) return;
    this.port = undefined;
    for (const [id, pending] of this.pending) {
      if (!pending.heard && !pending.retried) {
        pending.retried = true;
        void this.send(id);
      } else {
        this.settle(id, (p) => p.reject(new HostRequestError("Nook's model host closed")));
      }
    }
  }

  private checkSilence(): void {
    const now = Date.now();
    for (const [id, pending] of this.pending) {
      if (now - pending.heardAt < SILENCE_LIMIT_MS) continue;
      this.settle(id, (p) =>
        p.reject(
          new HostRequestError(`Nook's model host stopped responding (nothing for ${SILENCE_LIMIT_MS / 1000} s)`),
        ),
      );
    }
  }
}
