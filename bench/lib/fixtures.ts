// Fixed test data shared by the experiments, so runs are comparable.
import flores from "../fixtures/flores.json";
import screens from "../fixtures/screens.json";
import tabs from "../fixtures/tabs.json";
import type { MarkedBlock, Span } from "./markers";

export const LANGUAGE_NAMES = {
  eng: "English",
  fra: "French",
  deu: "German",
  spa: "Spanish",
  jpn: "Japanese",
  zho: "Simplified Chinese",
  pol: "Polish",
  ukr: "Ukrainian",
  vie: "Vietnamese",
  swh: "Swahili",
  tgl: "Tagalog",
} as const;

export type Lang = keyof typeof LANGUAGE_NAMES;
export const OTHER_LANGUAGES = Object.keys(LANGUAGE_NAMES).filter((l) => l !== "eng") as Exclude<Lang, "eng">[];

export type Sentence = { line: number; text: Record<Lang, string> };
export const SENTENCES: Sentence[] = flores.sentences as Sentence[];
export const FLORES_CREDIT = flores.source;

/** The i-th fixture sentence, wrapping around. */
export const sentence = (i: number): Sentence => SENTENCES[i % SENTENCES.length] as Sentence;
/** The i-th non-English language, wrapping around. */
export const otherLanguage = (i: number) => OTHER_LANGUAGES[i % OTHER_LANGUAGES.length] as Exclude<Lang, "eng">;

export type Tab = { title: string; host: string };
export const TABS: Tab[] = tabs.tabs;

export type Screen = { title: string; paragraphs: string[] };
export const SCREENS: Screen[] = screens.screens;

/** Tab lists for the grouping prompts: `count` lists of 6 to 12 tabs, picked with fixed strides. */
export function tabLists(count: number): Tab[][] {
  const lists: Tab[][] = [];
  for (let k = 0; k < count; k++) {
    const size = 6 + (k % 7);
    const stride = [1, 5, 7, 11][k % 4] ?? 1;
    const list: Tab[] = [];
    for (let i = 0; i < size; i++) list.push(TABS[(k * 3 + i * stride) % TABS.length] as Tab);
    lists.push([...new Set(list)]);
  }
  return lists;
}

/**
 * Adds marked spans to a sentence by word position: one bold span over the
 * 2nd and 3rd words, a link over the last two words but one, and on every
 * fourth sentence a link nested inside a wider bold span instead.
 */
export function markSentence(text: string, index: number): MarkedBlock {
  const words: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    words.push({ start: match.index, end: match.index + match[0].length });
  }
  const range = (from: number, to: number) => ({ start: words[from]?.start ?? 0, end: words[to]?.end ?? text.length });
  const spans: Span[] = [];
  if (index % 4 === 3 && words.length >= 6) {
    spans.push({ id: 1, kind: "b", ...range(1, 4) }, { id: 2, kind: "a", ...range(2, 3) });
  } else {
    spans.push({ id: 1, kind: "b", ...range(1, 2) });
    if (words.length >= 8) spans.push({ id: 2, kind: "a", ...range(words.length - 3, words.length - 2) });
  }
  return { text, spans };
}
