// The translator, injected into a frame by the service worker when the user
// picks Translate selection (the click or shortcut grants activeTab). It is
// not declared for all pages. Injecting it again reuses a live copy.
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import type { TranslateSelectionMessage } from "../core/messages";
import { translateSelection } from "../features/translate/selection";

declare global {
  /** The listener of the copy injected first, kept so a later copy can replace it. */
  var __nookTranslator: ((message: TranslateSelectionMessage) => boolean) | undefined;
}

export default defineUnlistedScript(() => {
  // A copy from before an extension reload stays in the page with a dead runtime, so a
  // new copy replaces its listener rather than relying on it. A live copy is reused.
  const previous = globalThis.__nookTranslator;
  if (previous) {
    try {
      if (chrome.runtime.onMessage.hasListener(previous)) return;
    } catch {
      // The old runtime is gone; fall through and install a fresh listener.
    }
  }
  const listener = (message: TranslateSelectionMessage): boolean => {
    if (message?.type !== "translate:selection") return false;
    translateSelection(message.selectionText).catch((error: unknown) =>
      console.error("Nook: translating the selection failed", error),
    );
    return false;
  };
  globalThis.__nookTranslator = listener;
  chrome.runtime.onMessage.addListener(listener);
});
