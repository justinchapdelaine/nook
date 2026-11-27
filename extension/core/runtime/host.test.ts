import { describe, expect, it } from "vitest";
import type { Engine } from "./engine";
import { createHost } from "./host";
import type { GenerateRequest, HostMessage } from "./protocol";

/** An engine with nothing cached until loaded, whose replies stream one word every 5 ms until aborted. */
function fakeEngine(words = ["un", "deux", "trois"]): Engine & { loads: string[] } {
  const cached = new Set<string>();
  const loads: string[] = [];
  return {
    loads,
    hasF16: async () => true,
    isCached: async (build) => cached.has(build.id),
    load: async (build, onProgress) => {
      loads.push(build.id);
      cached.add(build.id);
      onProgress("done", 1);
    },
    unload: async () => {},
    remove: async (build) => void cached.delete(build.id),
    generate: async (_request, onDelta, signal) => {
      for (const word of words) {
        if (signal.aborted) return { finishReason: "abort" };
        onDelta(`${word} `);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { finishReason: "stop" };
    },
  };
}

const generate = (priority: GenerateRequest["priority"]): GenerateRequest => ({
  family: "Qwen3.5-2B",
  priority,
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 10,
  temperature: 0,
});

/** Sends one request and collects what comes back until its result or error. */
function call(
  host: ReturnType<typeof createHost>,
  portId: number,
  id: number,
  request: Parameters<typeof host.receive>[1],
) {
  const messages: HostMessage[] = [];
  const done = new Promise<HostMessage[]>((resolve) => {
    host.receive(portId, request, (message) => {
      messages.push(message);
      if (message.kind === "result" || message.kind === "error") resolve(messages);
    });
  });
  return { id, done };
}

describe("host", () => {
  it("won't download a model to translate", async () => {
    const host = createHost(fakeEngine(), () => {});
    const { done } = call(host, 1, 1, { id: 1, request: { type: "generate", request: generate("user") } });
    expect((await done).at(-1)).toMatchObject({ kind: "error", code: "not-downloaded" });
  });

  it("downloads the GPU's build, then streams a reply", async () => {
    const engine = fakeEngine();
    const host = createHost(engine, () => {});
    await call(host, 1, 1, { id: 1, request: { type: "download", family: "Qwen3.5-2B" } }).done;
    expect(engine.loads).toEqual(["Qwen3.5-2B-q4f16_1-MLC"]);
    const messages = await call(host, 1, 2, { id: 2, request: { type: "generate", request: generate("user") } }).done;
    expect(messages.filter((m) => m.kind === "delta").map((m) => (m as { text: string }).text)).toEqual([
      "un ",
      "deux ",
      "trois ",
    ]);
    expect(messages.at(-1)).toMatchObject({ kind: "result", result: { text: "un deux trois ", finishReason: "stop" } });
  });

  it("restarts background work that user work interrupted", async () => {
    const host = createHost(fakeEngine(), () => {});
    await call(host, 1, 1, { id: 1, request: { type: "download", family: "Qwen3.5-2B" } }).done;
    const background = call(host, 1, 2, { id: 2, request: { type: "generate", request: generate("background") } });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await call(host, 2, 1, { id: 1, request: { type: "generate", request: generate("user") } }).done;
    const messages = await background.done;
    expect(messages.some((m) => m.kind === "restart")).toBe(true);
    expect(messages.at(-1)).toMatchObject({ kind: "result", result: { text: "un deux trois " } });
  });

  it("cancels a closed port's work", async () => {
    const host = createHost(fakeEngine(), () => {});
    await call(host, 1, 1, { id: 1, request: { type: "download", family: "Qwen3.5-2B" } }).done;
    const pending = call(host, 1, 2, { id: 2, request: { type: "generate", request: generate("user") } });
    host.disconnected(1);
    expect((await pending.done).at(-1)).toMatchObject({ kind: "error", code: "cancelled" });
  });

  it("doesn't start a reply cancelled while the model loaded", async () => {
    const engine = fakeEngine();
    let generated = 0;
    const generate0 = engine.generate;
    engine.generate = (...args) => {
      generated++;
      return generate0(...args);
    };
    const host = createHost(engine, () => {});
    await call(host, 1, 1, { id: 1, request: { type: "download", family: "Qwen3.5-2B" } }).done;
    await call(host, 1, 2, { id: 2, request: { type: "download", family: "Qwen3.5-0.8B" } }).done;
    // 2B is cached but not loaded, so this request loads it first; cancel it meanwhile.
    const pending = call(host, 1, 3, { id: 3, request: { type: "generate", request: generate("user") } });
    host.receive(1, { id: 3, cancel: true }, () => {});
    expect((await pending.done).at(-1)).toMatchObject({ kind: "error", code: "cancelled" });
    expect(generated).toBe(0);
  });

  it("loads the model again after a failed reply", async () => {
    const engine = fakeEngine();
    const host = createHost(engine, () => {});
    await call(host, 1, 1, { id: 1, request: { type: "download", family: "Qwen3.5-2B" } }).done;
    const generate0 = engine.generate;
    engine.generate = async () => {
      engine.generate = generate0;
      throw new Error("Device lost");
    };
    const failed = await call(host, 1, 2, { id: 2, request: { type: "generate", request: generate("user") } }).done;
    expect(failed.at(-1)).toMatchObject({ kind: "error", error: "Device lost" });
    await call(host, 1, 3, { id: 3, request: { type: "generate", request: generate("user") } }).done;
    expect(engine.loads).toEqual(["Qwen3.5-2B-q4f16_1-MLC", "Qwen3.5-2B-q4f16_1-MLC"]);
  });
});
