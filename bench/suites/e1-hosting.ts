// E1, hosting: the same model in the offscreen document's worker and in the
// service worker. Load times, idle behaviour, and recovery after the
// service worker is stopped by hand.

import type { HostClient } from "../lib/client";
import { closeOffscreen, ensureOffscreen } from "../lib/client";
import type { BenchModel } from "../lib/models";
import type { HostStatus } from "../lib/protocol";
import type { RunContext } from "./context";
import { preferredVariant, request, speed, usable } from "./context";

const PING = request([{ role: "user", content: "Name three colours, separated by commas." }], 24);

async function loadTwice(ctx: RunContext, client: HostClient, model: BenchModel) {
  const first = await client.request({ type: "load", modelId: model.id }, ctx.status);
  ctx.log(`${client.host}: first load ${(first.ms / 1000).toFixed(1)} s.`);
  const firstReply = await client.request(PING);
  await client.request({ type: "unload" });
  const repeat = await client.request({ type: "load", modelId: model.id }, ctx.status);
  ctx.log(`${client.host}: repeat load ${(repeat.ms / 1000).toFixed(1)} s.`);
  const repeatReply = await client.request(PING);
  const vramGB = await ctx.askVram(`${model.label} loaded in the ${client.host} host`);
  return {
    firstLoadMs: first.ms,
    firstReply: speed(firstReply),
    repeatLoadMs: repeat.ms,
    repeatReply: speed(repeatReply),
    vramGB,
  };
}

/** Leaves a loaded host alone for `minutes`, then checks whether it kept the model. */
async function idleCheck(ctx: RunContext, client: HostClient, model: BenchModel, before: HostStatus, minutes: number) {
  // Drop both ports, so no open connection or message can keep either host awake.
  ctx.offscreen.disconnect();
  ctx.sw.disconnect();
  const start = Date.now();
  await ctx.sleep(minutes * 60_000, `${client.host} host idle`);
  const status = await client.request({ type: "status" });
  const restarted = status.startedAt !== before.startedAt;
  const kept = !restarted && status.loaded?.modelId === model.id;
  ctx.log(
    `${client.host} after ${minutes} min idle: ${kept ? "model still loaded" : restarted ? "host restarted, model lost" : "model unloaded"}.`,
  );
  const check: Record<string, unknown> = { minutes, actualMinutes: (Date.now() - start) / 60_000, restarted, kept };
  if (kept) {
    check.reply = speed(await client.request(PING));
  } else {
    const reload = await client.request({ type: "load", modelId: model.id }, ctx.status);
    check.recoveryLoadMs = reload.ms;
    check.reply = speed(await client.request(PING));
    ctx.log(`${client.host}: reloaded in ${(reload.ms / 1000).toFixed(1)} s.`);
  }
  return check;
}

export async function runHosting(ctx: RunContext) {
  const family = String(ctx.options.e1Family ?? "Qwen3.5-2B");
  const model = usable(ctx, preferredVariant(ctx, family), family);
  if (!model) return { skipped: `${family} not available` };
  const idleMinutes = [5, ...(ctx.options.e1Long ? [60] : [])];
  const result: Record<string, unknown> = { model: model.id };

  // Fresh offscreen document, timed.
  await closeOffscreen(ctx.offscreen);
  result.offscreenCreateMs = (await ensureOffscreen()).ms;

  for (const client of [ctx.offscreen, ctx.sw]) {
    try {
      const host: Record<string, unknown> = await loadTwice(ctx, client, model);
      const idle = [];
      for (const minutes of idleMinutes) {
        // The service worker is known to stop after about 30 s; one 5-minute check is enough.
        if (client.host === "sw" && minutes > 5) break;
        const before = await client.request({ type: "status" });
        idle.push(await idleCheck(ctx, client, model, before, minutes));
      }
      host.idle = idle;
      result[client.host] = host;
    } catch (error) {
      // A host failing (for example the service worker stopping mid-load) is itself a result.
      ctx.log(`${client.host} host failed: ${error}`);
      result[client.host] = { error: String(error) };
    } finally {
      // Free GPU memory even when a step fails, so the next host or experiment starts clean.
      await client.request({ type: "unload" }).catch(() => {});
    }
  }

  if (ctx.options.e1Stop) {
    try {
      await ctx.offscreen.request({ type: "load", modelId: model.id }, ctx.status);
      const offBefore = await ctx.offscreen.request({ type: "status" });
      const swBefore = await ctx.sw.request({ type: "status" });
      ctx.offscreen.disconnect();
      ctx.sw.disconnect();
      const done = await ctx.askStep(
        `Stop the Nook Bench service worker by hand: open chrome://serviceworker-internals in a new tab, find the entry for ` +
          `chrome-extension://${chrome.runtime.id}/ and click Stop. Then come back here and press Done.`,
      );
      if (done) {
        const start = performance.now();
        const offAfter = await ctx.offscreen.request({ type: "status" });
        const offscreenSurvived = offAfter.startedAt === offBefore.startedAt && offAfter.loaded?.modelId === model.id;
        // If the offscreen host lost the model, a reply would fail; record that instead.
        const reply = offscreenSurvived ? speed(await ctx.offscreen.request(PING)) : null;
        const swAfter = await ctx.sw.request({ type: "status" });
        result.manualStop = {
          serviceWorkerRestarted: swAfter.startedAt !== swBefore.startedAt,
          offscreenSurvived,
          offscreenRestarted: offAfter.startedAt !== offBefore.startedAt,
          firstReplyAfterStopMs: reply ? performance.now() - start : null,
          reply,
        };
        ctx.log(`After the stop: ${JSON.stringify(result.manualStop)}`);
      } else {
        result.manualStop = "skipped";
      }
    } finally {
      await ctx.offscreen.request({ type: "unload" }).catch(() => {});
    }
  }
  return result;
}
