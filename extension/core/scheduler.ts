// One GPU queue. WebLLM runs one request at a time and can't reorder a
// running one, so the scheduler orders what is waiting: "user" work (what
// the user is waiting on) before "background" work, then first come, first
// served. When user work arrives while preemptible background work runs, the
// running job is stopped and put back at the front of its queue, to start
// again from the beginning once the user work is done.
import type { Priority } from "./runtime/protocol";

export interface Job<T> {
  priority: Priority;
  /** Whether the job can be stopped part-way and run again from the start. */
  preemptible: boolean;
  /**
   * Does the work. `signal` aborts when the job is cancelled or preempted; the
   * job should stop soon after. `attempt` counts from 0 and goes up each time
   * the job starts again after being preempted.
   */
  run(signal: AbortSignal, attempt: number): Promise<T>;
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

const PREEMPTED = Symbol("preempted");
const CANCELLED = Symbol("cancelled");

interface Entry {
  job: Job<unknown>;
  seq: number;
  attempt: number;
  /** Set by cancel(), so a job stopped for preemption and then cancelled isn't run again. */
  cancelled?: boolean;
  controller?: AbortController;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

export interface Ticket<T> {
  result: Promise<T>;
  /** Removes the job from the queue, or stops it if it is running. Its result rejects with CancelledError. */
  cancel(): void;
}

export class Scheduler {
  private waiting: Entry[] = [];
  private running: Entry | undefined;
  private nextSeq = 0;
  private busy = false;

  /** Called when the scheduler goes from idle to busy and back. */
  constructor(private readonly onBusyChange: (busy: boolean) => void = () => {}) {}

  add<T>(job: Job<T>): Ticket<T> {
    let entry!: Entry;
    const result = new Promise<T>((resolve, reject) => {
      entry = { job, seq: this.nextSeq++, attempt: 0, resolve: resolve as (value: unknown) => void, reject };
    });
    this.insert(entry);
    const running = this.running;
    if (running && job.priority === "user" && running.job.priority === "background" && running.job.preemptible) {
      running.controller?.abort(PREEMPTED);
    }
    this.pump();
    return { result, cancel: () => this.cancel(entry) };
  }

  private insert(entry: Entry): void {
    const rank = (e: Entry) => (e.job.priority === "user" ? 0 : 1);
    const at = this.waiting.findIndex((e) => rank(e) > rank(entry) || (rank(e) === rank(entry) && e.seq > entry.seq));
    if (at < 0) this.waiting.push(entry);
    else this.waiting.splice(at, 0, entry);
  }

  private cancel(entry: Entry): void {
    if (this.running === entry) {
      entry.cancelled = true;
      entry.controller?.abort(CANCELLED);
      return;
    }
    const at = this.waiting.indexOf(entry);
    if (at < 0) return;
    this.waiting.splice(at, 1);
    entry.reject(new CancelledError());
    this.updateBusy();
  }

  private pump(): void {
    this.updateBusy();
    if (this.running) return;
    const entry = this.waiting.shift();
    if (!entry) return;
    this.running = entry;
    const controller = new AbortController();
    entry.controller = controller;
    const settle = (outcome: () => void) => {
      this.running = undefined;
      const reason: unknown = controller.signal.reason;
      if (entry.cancelled || (controller.signal.aborted && reason === CANCELLED)) {
        entry.reject(new CancelledError());
      } else if (controller.signal.aborted && reason === PREEMPTED) {
        entry.attempt++;
        this.insert(entry);
      } else {
        outcome();
      }
      this.pump();
    };
    // Run on a later microtask, so a job that throws at once still settles through `settle`.
    Promise.resolve()
      .then(() => entry.job.run(controller.signal, entry.attempt))
      .then(
        (value) => settle(() => entry.resolve(value)),
        (error: unknown) => settle(() => entry.reject(error)),
      );
  }

  private updateBusy(): void {
    const busy = this.running !== undefined || this.waiting.length > 0;
    if (busy === this.busy) return;
    this.busy = busy;
    this.onBusyChange(busy);
  }
}
