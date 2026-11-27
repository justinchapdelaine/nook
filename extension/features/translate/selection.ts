// Translate selection: reads the selected text, works out its language, and
// streams its translation into a bubble under it.
import type { OpenSetupMessage } from "../../core/messages";
import type { HostClient } from "../../core/runtime/client";
import { HostRequestError } from "../../core/runtime/client";
import { getSettings } from "../../core/settings";
import { MAX_INPUT_CHARS, translate } from "../../core/tasks/translate";
import type { BubbleView } from "./bubble";
import { openBubble } from "./bubble";
import { detectLanguage, sameLanguage } from "./language";

const names = new Intl.DisplayNames([navigator.language], { type: "language" });
const nameOf = (code: string) => names.of(code) ?? code;

let current: BubbleView | undefined;

/** Text selected inside a focused text field, which the document's selection doesn't include. */
function fieldSelection(): string {
  const field = document.activeElement;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return "";
  const { selectionStart: start, selectionEnd: end } = field;
  // Inputs without text selection (such as checkboxes) report null.
  return start !== null && end !== null ? field.value.slice(start, end) : "";
}

export async function translateSelection(client: HostClient, fallbackText = ""): Promise<void> {
  current?.close();
  const selection = getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
  const text = (selection?.toString() || fieldSelection() || fallbackText).trim();
  const anchor = range?.getBoundingClientRect();
  // With nothing selected, or a selection inside a form field (which has no useful rectangle), show it near the top.
  const where = anchor && (anchor.width > 0 || anchor.height > 0) ? anchor : new DOMRect(innerWidth - 16, 16, 0, 0);

  let cancel: (() => void) | undefined;
  let closed = false;
  const bubble = openBubble(where, () => {
    closed = true;
    cancel?.();
    if (current === bubble) current = undefined;
  });
  current = bubble;

  if (!text) return bubble.setStatus("Select some text to translate first.");
  if (text.length > MAX_INPUT_CHARS) {
    return bubble.setStatus("That's more text than Nook translates at once. Select up to about a page.");
  }

  bubble.setStatus("Translating…", true);
  const settings = await getSettings();
  const container = range?.commonAncestorContainer;
  const near = container instanceof Element ? container : (container?.parentElement ?? null);
  const from = await detectLanguage(text, near);
  const to = settings.targetLanguage;
  // Closed while the settings or the language were read: there is nothing to translate for.
  if (closed) return;
  if (from && sameLanguage(from, to)) return bubble.setStatus(`This is already in ${nameOf(to)}.`);

  const fromLabel = from ? `from ${nameOf(from)}` : "";
  bubble.setStatus(from ? `Translating ${fromLabel}…` : "Translating…", true);
  const job = translate(client, text, {
    family: settings.model,
    priority: "user",
    from,
    to,
    onLoading: (fraction) => bubble.setStatus(`Loading the model… ${Math.round(fraction * 100)}%`, true),
    onText: (sofar) => {
      if (sofar) bubble.setStatus(from ? `Translating ${fromLabel}…` : "Translating…", true);
      bubble.setText(sofar, to);
    },
  });
  cancel = job.cancel;
  try {
    const { text: translation, cut } = await job.result;
    bubble.setText(translation, to);
    const done = from ? `Translated ${fromLabel}` : "Translated";
    const note = {
      repetition: " (stopped early: the reply began repeating itself)",
      length: " (stopped at the length limit)",
    };
    bubble.setStatus(cut ? `${done}${note[cut]}` : done);
  } catch (error) {
    if (!(error instanceof HostRequestError)) {
      bubble.setStatus(`Translation failed: ${String(error)}`);
      return;
    }
    if (error.code === "cancelled") return;
    if (error.code === "not-downloaded") {
      bubble.setStatus("Nook needs to download its translation model first. Opening settings…");
      await chrome.runtime.sendMessage({ type: "setup:open" } satisfies OpenSetupMessage);
      return;
    }
    if (error.code === "no-webgpu") {
      bubble.setStatus("Translation needs WebGPU, which this browser or GPU doesn't offer.");
      return;
    }
    bubble.setStatus(`Translation failed: ${error.message}`);
  }
}
