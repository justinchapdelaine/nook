import { defineConfig } from "@playwright/test";

// The real-model smoke test (npm run test:smoke): slow, run on demand, not
// on every PR. It downloads Qwen3.5 0.8B and runs it on the software WebGPU
// adapter, so it checks that things work end to end, never how fast.
export default defineConfig({
  testDir: ".",
  timeout: 30 * 60_000,
  workers: 1,
  reporter: "list",
});
