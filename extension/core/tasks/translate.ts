// translate(): turns a piece of text into a translation request, streams the
// answer back, and checks it. Features call this and never see the model.
import type { HostClient } from "../runtime/client";
import type { ChatMessage, Priority } from "../runtime/protocol";
import { findRepetition } from "./repetition";

/** Longest text one request takes: with its answer, it fits the 8K context window even for Chinese or Japanese. */
export const MAX_INPUT_CHARS = 4000;
/** Never ask for more than this many tokens. */
const MAX_OUTPUT_TOKENS = 3072;

/**
 * A token limit sized to the input, so a reply stuck repeating itself stops
 * soon. A token is at least one character in every language Nook offers,
 * and a translation rarely runs past 1.5 times the source's length.
 */
export function maxTokensFor(text: string): number {
  return Math.min(MAX_OUTPUT_TOKENS, Math.ceil(text.length * 1.5) + 64);
}

const englishNames = new Intl.DisplayNames(["en"], { type: "language" });
const languageName = (code: string) => englishNames.of(code) ?? code;

export function translatePrompt(text: string, from: string | undefined, to: string): ChatMessage[] {
  const source = from ? ` from ${languageName(from)}` : "";
  return [
    {
      role: "system",
      content: `Translate the user's text${source} to ${languageName(to)}. Keep the same paragraphs and line breaks. Reply in plain text with the translation only, without Markdown, notes, quotes or explanations.`,
    },
    { role: "user", content: text },
  ];
}

export interface TranslateOptions {
  family: string;
  priority: Priority;
  /** Source language, when known. */
  from?: string;
  to: string;
  /** Called with the whole translation so far, each time it grows. */
  onText?(text: string): void;
  /** Called while the model loads, with a fraction from 0 to 1. */
  onLoading?(fraction: number): void;
}

export interface Translation {
  text: string;
  /** Set when the reply was cut short: it began repeating itself, or reached the token limit. */
  cut?: "repetition" | "length";
}

export function translate(
  client: HostClient,
  text: string,
  options: TranslateOptions,
): { result: Promise<Translation>; cancel(): void } {
  let sofar = "";
  let repeatedAt = -1;
  const request = client.request(
    {
      type: "generate",
      request: {
        family: options.family,
        priority: options.priority,
        messages: translatePrompt(text, options.from, options.to),
        maxTokens: maxTokensFor(text),
        temperature: 0,
      },
    },
    {
      onProgress: (_text, fraction) => options.onLoading?.(fraction),
      onRestart: () => {
        sofar = "";
        options.onText?.("");
      },
      onDelta: (delta) => {
        if (repeatedAt >= 0) return;
        sofar += delta;
        repeatedAt = findRepetition(sofar);
        if (repeatedAt >= 0) {
          sofar = sofar.slice(0, repeatedAt);
          request.cancel();
        }
        options.onText?.(sofar.trim());
      },
    },
  );
  const result = (async (): Promise<Translation> => {
    try {
      const { finishReason } = await request.result;
      return finishReason === "length" ? { text: sofar.trim(), cut: "length" } : { text: sofar.trim() };
    } catch (error) {
      // The guard cancelled the reply itself; what came before the loop is the answer.
      if (repeatedAt >= 0) return { text: sofar.trim(), cut: "repetition" };
      throw error;
    }
  })();
  return { result, cancel: request.cancel };
}
