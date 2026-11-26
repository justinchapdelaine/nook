// Package and GPU check: needs no download. Confirms each host sees WebGPU
// and can fetch and compile every model library shipped in the package.
import { closeOffscreen, ensureOffscreen } from "../lib/client";
import type { RunContext } from "./context";

export async function runPackageCheck(ctx: RunContext) {
  await closeOffscreen(ctx.offscreen);
  const offscreen = await ensureOffscreen();
  ctx.log(`Offscreen document created in ${offscreen.ms.toFixed(0)} ms.`);
  const hosts: Record<string, unknown> = {};
  for (const client of [ctx.offscreen, ctx.sw]) {
    ctx.log(`Checking the ${client.host} host…`);
    const gpu = await client.request({ type: "gpu" });
    const libs = await client.request({ type: "checkLibs" });
    for (const lib of libs) {
      ctx.log(
        lib.error
          ? `${lib.lib}: ${lib.error}`
          : `${lib.lib}: ${(lib.bytes / 1e6).toFixed(1)} MB, fetch ${lib.fetchMs.toFixed(0)} ms, compile ${lib.compileMs.toFixed(0)} ms, hash ${lib.sha256Ok ? "ok" : "WRONG"}`,
      );
    }
    hosts[client.host] = { gpu, libs };
  }
  return { offscreenCreateMs: offscreen.ms, hosts };
}
