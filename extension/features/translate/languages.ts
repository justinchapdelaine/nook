// The languages Nook offers to translate into, as primary language subtags
// (Tagalog is "fil", as chrome.i18n.detectLanguage reports it). Names are
// shown in the browser's language through Intl.DisplayNames.
export const TARGET_LANGUAGES = [
  "en",
  "fr",
  "de",
  "es",
  "it",
  "pt",
  "nl",
  "pl",
  "uk",
  "ru",
  "tr",
  "vi",
  "fil",
  "ja",
  "zh",
  "ko",
] as const;

const names = new Intl.DisplayNames([navigator.language], { type: "language" });

/** A language's name in the browser's language, or its code when the browser has no name for it. */
export const languageLabel = (code: string): string => names.of(code) ?? code;
