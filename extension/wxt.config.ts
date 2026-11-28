import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";
import type { TabAction } from "./core/messages";

type Command = { suggested_key: { default: string }; description: string };

// Each tab action is a command, so a renamed action can't silently lose its shortcut.
const TAB_COMMANDS = {
  "group-tabs": { suggested_key: { default: "Alt+Shift+G" }, description: "Group tabs by topic or site" },
  "close-duplicates": { suggested_key: { default: "Alt+Shift+D" }, description: "Close duplicate tabs" },
  undo: { suggested_key: { default: "Alt+Shift+U" }, description: "Undo the last tab change" },
} satisfies Record<TabAction, Command>;

// Nook, the extension (docs/plan.md has the phases).
//
// Test builds: headless Chromium can't answer a permission prompt, click a
// page menu or press a browser shortcut, so `--mode e2e` and `--mode smoke`
// grant `tabs` and access to every site at install (the store build asks for
// `tabs` on first use and gets page access only from activeTab). Besides
// that, `e2e` swaps the WebLLM engine for a scripted fake, so the end-to-end
// tests run fast with no model; `smoke` keeps the real engine for the
// real-model smoke test. The store build never uses either mode.
export default defineConfig({
  imports: false,
  zip: { artifactTemplate: "nook-{{version}}-chrome.zip" },
  vite: ({ mode }) => ({
    define: { __NOOK_TEST_BUILD__: JSON.stringify(mode === "e2e" || mode === "smoke") },
    // WebLLM is about 6 MB and is bundled whole into the engine worker.
    build: { chunkSizeWarningLimit: 8000 },
    resolve: {
      alias:
        mode === "e2e"
          ? [
              {
                find: /^\.\/webllm$/,
                replacement: fileURLToPath(new URL("../tests/e2e/fake-engine.ts", import.meta.url)),
              },
            ]
          : [],
    },
  }),
  manifest: ({ mode }) => {
    const testBuild = mode === "e2e" || mode === "smoke";
    return {
      name: "Nook",
      version: "0.3.0",
      description: "Tab tools and translation that run only on your device.",
      minimum_chrome_version: "153",
      // Each permission's reason is in CHROMEWEBSTORE.md.
      permissions: [
        "contextMenus",
        "storage",
        "tabGroups",
        "sessions",
        "publicSuffix",
        "activeTab",
        "scripting",
        "offscreen",
        "unlimitedStorage",
        ...(testBuild ? ["tabs"] : []),
      ],
      // Asked for on the first tab action, not at install.
      optional_permissions: testBuild ? [] : ["tabs"],
      ...(testBuild ? { host_permissions: ["<all_urls>"] } : {}),
      action: { default_title: "Nook: right-click for tab tools" },
      commands: {
        ...TAB_COMMANDS,
        "translate-selection": {
          suggested_key: { default: "Alt+Shift+L" },
          description: "Translate the selected text",
        },
      },
      content_security_policy: {
        // WebLLM compiles its model library, WebAssembly, at runtime.
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      },
    };
  },
});
