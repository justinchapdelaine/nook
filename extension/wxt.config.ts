import { defineConfig } from "wxt";
import type { TabAction } from "./core/messages";

// Nook, the extension. Phase 1 holds the model-free tab tools only; the
// model, its host and the translator arrive in later phases (docs/plan.md).
export default defineConfig({
  imports: false,
  zip: { artifactTemplate: "nook-{{version}}-chrome.zip" },
  manifest: ({ mode }) => {
    // The end-to-end tests build with `--mode e2e` (npm run build:e2e).
    // Headless Chromium can't answer a permission prompt, so that build grants
    // `tabs` at install instead of asking for it. That is the only manifest
    // difference (it also means the settings page can't remove tab access
    // there), and the store build never uses this mode.
    const tabsAtInstall = mode === "e2e";
    return {
      name: "Nook",
      version: "0.1.0",
      description: "Tab tools and, later, translation that run only on your device.",
      minimum_chrome_version: "153",
      // Each permission's reason is in CHROMEWEBSTORE.md.
      permissions: [
        "contextMenus",
        "storage",
        "tabGroups",
        "sessions",
        "publicSuffix",
        ...(tabsAtInstall ? ["tabs"] : []),
      ],
      // Asked for on the first tab action, not at install.
      optional_permissions: tabsAtInstall ? [] : ["tabs"],
      action: { default_title: "Nook: right-click for tab tools" },
      commands: {
        "group-tabs": { suggested_key: { default: "Alt+Shift+G" }, description: "Group tabs by site" },
        "close-duplicates": { suggested_key: { default: "Alt+Shift+D" }, description: "Close duplicate tabs" },
        undo: { suggested_key: { default: "Alt+Shift+U" }, description: "Undo the last tab change" },
        // Each command is a tab action, so a renamed action can't silently lose its shortcut.
      } satisfies Record<TabAction, { suggested_key: { default: string }; description: string }>,
      content_security_policy: {
        // WebLLM (phase 2) compiles its model library, WebAssembly, at runtime.
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      },
    };
  },
});
