import { defineConfig } from "wxt";

// Nook Bench: a test harness, not the Nook extension. It measures what
// docs/discovery.md left open (experiments E1 to E7) on real hardware.
export default defineConfig({
  imports: false,
  // WebLLM is about 6 MB and is bundled whole into each host.
  vite: () => ({ build: { chunkSizeWarningLimit: 8000 } }),
  zip: { artifactTemplate: "nook-bench-{{version}}-chrome.zip" },
  manifest: {
    name: "Nook Bench",
    // Bump when the harness changes; the results block records it.
    version: "0.1.1",
    description: "Benchmarks for Nook: on-device model hosting, speed, memory and translation quality.",
    minimum_chrome_version: "153",
    permissions: [
      "contextMenus",
      "activeTab",
      "scripting",
      "offscreen",
      "storage",
      "unlimitedStorage",
      "tabGroups",
      "sessions",
      "publicSuffix",
    ],
    optional_permissions: ["tabs"],
    action: { default_title: "Open Nook Bench" },
    content_security_policy: {
      // WebLLM compiles its model library (WebAssembly) at runtime.
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
