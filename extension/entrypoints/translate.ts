// The translator, injected into a frame by the service worker when the user
// picks Translate selection (the click or shortcut grants activeTab). It is
// not declared for all pages. Injecting it again reuses the first copy.
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import type { TranslateSelectionMessage } from "../core/messages";
import { HostClient } from "../core/runtime/client";
import { translateSelection } from "../features/translate/selection";

declare global {
  var __nookTranslator: boolean | undefined;
}

export default defineUnlistedScript(() => {
  if (globalThis.__nookTranslator) return;
  globalThis.__nookTranslator = true;
  const client = new HostClient();
  chrome.runtime.onMessage.addListener((message: TranslateSelectionMessage) => {
    if (message?.type !== "translate:selection") return false;
    translateSelection(client, message.selectionText).catch((error: unknown) =>
      console.error("Nook: translating the selection failed", error),
    );
    return false;
  });
});
