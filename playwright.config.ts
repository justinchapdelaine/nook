import { defineConfig } from "@playwright/test";

// Loads the built extension (npm run build) in headless Chromium. There is
// no real GPU here: WebGPU runs on SwiftShader, so these tests check that
// things work, never how fast.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
});
