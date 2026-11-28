// Works out which language a piece of text is in. Many sites mark every page
// lang="en" whatever it says, so the text itself comes first, through
// chrome.i18n.detectLanguage (chrome.tabs.detectLanguage never answers in
// Helium). The nearest lang attribute is the fallback when detection isn't
// reliable; otherwise the language is unknown.
import { primaryLanguage } from "../../core/settings";

/** Enough text for a reliable guess; detection gets slower, not better, past this. */
const SAMPLE_CHARS = 2000;

export interface Detection {
  isReliable: boolean;
  languages: { language: string; percentage: number }[];
}

/** The text's language as a primary subtag ("fr"), or undefined when unknown. */
export function chooseLanguage(
  detection: Detection | undefined,
  langAttribute: string | undefined,
): string | undefined {
  const top = detection?.languages[0]?.language;
  if (detection?.isReliable && top && top !== "und") return primaryLanguage(top);
  const attribute = langAttribute?.trim();
  if (!attribute) return undefined;
  // Pages put anything in lang, such as "en US" or an unfilled "{{ locale }}"; only a real tag counts.
  try {
    const [tag] = Intl.getCanonicalLocales(attribute);
    return tag ? primaryLanguage(tag) : undefined;
  } catch {
    return undefined;
  }
}

export async function detectLanguage(text: string, near: Element | null): Promise<string | undefined> {
  let detection: Detection | undefined;
  try {
    detection = await chrome.i18n.detectLanguage(text.slice(0, SAMPLE_CHARS));
  } catch (error) {
    console.warn("Nook: language detection failed", error);
  }
  const lang = near?.closest("[lang]")?.getAttribute("lang") ?? document.documentElement.getAttribute("lang");
  return chooseLanguage(detection, lang ?? undefined);
}

/**
 * Whether two languages count as the same for translation. Detection calls
 * Tagalog "fil"; Nook offers it as "fil" too, but a page may say "tl".
 */
export function sameLanguage(a: string, b: string): boolean {
  const norm = (code: string) => (code === "tl" ? "fil" : code);
  return norm(a) === norm(b);
}
