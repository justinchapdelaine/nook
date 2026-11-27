import { describe, expect, it } from "vitest";
import type { Job } from "./scheduler";
import { CancelledError, Scheduler } from "./scheduler";

/** A job that runs until `finish` is called or its signal aborts, and records each start. */
function controllableJob(name: string, priority: Job<string>["priority"], log: string[], preemptible = true) {
  let finish: () => void = () => {};
  const job: Job<string> = {
    priority,
    preemptible,
    run: (signal, attempt) =>
      new Promise<string>((resolve, reject) => {
        log.push(`${name}#${attempt}`);
        finish = () => resolve(name);
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  };
  return { job, finish: () => finish() };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Scheduler", () => {
  it("runs jobs one at a time, in order within a priority", async () => {
    const log: string[] = [];
    const scheduler = new Scheduler();
    const a = controllableJob("a", "background", log);
    const b = controllableJob("b", "background", log);
    const ra = scheduler.add(a.job).result;
    const rb = scheduler.add(b.job).result;
    await tick();
    expect(log).toEqual(["a#0"]);
    a.finish();
    expect(await ra).toBe("a");
    await tick();
    expect(log).toEqual(["a#0", "b#0"]);
    b.finish();
    expect(await rb).toBe("b");
  });

  it("puts waiting user work before waiting background work", async () => {
    const log: string[] = [];
    const scheduler = new Scheduler();
    const first = controllableJob("first", "user", log);
    const bg = controllableJob("bg", "background", log);
    const user = controllableJob("user", "user", log);
    scheduler.add(first.job);
    scheduler.add(bg.job);
    scheduler.add(user.job);
    await tick();
    first.finish();
    await tick();
    await tick();
    expect(log).toEqual(["first#0", "user#0"]);
  });

  it("stops running background work for user work, then starts it again", async () => {
    const log: string[] = [];
    const scheduler = new Scheduler();
    const bg = controllableJob("bg", "background", log);
    const user = controllableJob("user", "user", log);
    const rbg = scheduler.add(bg.job).result;
    await tick();
    const ruser = scheduler.add(user.job).result;
    await tick();
    await tick();
    expect(log).toEqual(["bg#0", "user#0"]);
    user.finish();
    expect(await ruser).toBe("user");
    await tick();
    expect(log).toEqual(["bg#0", "user#0", "bg#1"]);
    bg.finish();
    expect(await rbg).toBe("bg");
  });

  it("never stops user work or work that can't be preempted", async () => {
    const log: string[] = [];
    const scheduler = new Scheduler();
    const load = controllableJob("load", "background", log, false);
    const user = controllableJob("user", "user", log);
    scheduler.add(load.job);
    await tick();
    scheduler.add(user.job);
    await tick();
    expect(log).toEqual(["load#0"]);
    load.finish();
    await tick();
    await tick();
    expect(log).toEqual(["load#0", "user#0"]);
  });

  it("cancels waiting and running jobs", async () => {
    const log: string[] = [];
    const scheduler = new Scheduler();
    const a = controllableJob("a", "user", log);
    const b = controllableJob("b", "user", log);
    const c = controllableJob("c", "user", log);
    const ta = scheduler.add(a.job);
    const tb = scheduler.add(b.job);
    const tc = scheduler.add(c.job);
    await tick();
    tb.cancel();
    await expect(tb.result).rejects.toBeInstanceOf(CancelledError);
    ta.cancel();
    await expect(ta.result).rejects.toBeInstanceOf(CancelledError);
    await tick();
    expect(log).toEqual(["a#0", "c#0"]);
    c.finish();
    expect(await tc.result).toBe("c");
  });

  it("passes on a job's own error", async () => {
    const scheduler = new Scheduler();
    const result = scheduler.add({
      priority: "user",
      preemptible: false,
      run: () => {
        throw new Error("boom");
      },
    }).result;
    await expect(result).rejects.toThrow("boom");
  });

  it("reports when it becomes busy and idle", async () => {
    const changes: boolean[] = [];
    const scheduler = new Scheduler((busy) => changes.push(busy));
    const a = controllableJob("a", "user", []);
    const result = scheduler.add(a.job).result;
    expect(changes).toEqual([true]);
    await tick();
    a.finish();
    await result;
    await tick();
    expect(changes).toEqual([true, false]);
  });
});
