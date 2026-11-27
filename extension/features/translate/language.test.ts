import { describe, expect, it } from "vitest";
import { chooseLanguage, sameLanguage } from "./language";

const reliable = (language: string) => ({ isReliable: true, languages: [{ language, percentage: 99 }] });

describe("chooseLanguage", () => {
  it("trusts reliable detection over the lang attribute", () => {
    expect(chooseLanguage(reliable("fr"), "en")).toBe("fr");
  });

  it("reduces detected tags to their primary subtag", () => {
    expect(chooseLanguage(reliable("zh-Hant"), undefined)).toBe("zh");
  });

  it("falls back to the lang attribute when detection is unsure", () => {
    expect(chooseLanguage({ isReliable: false, languages: [{ language: "de", percentage: 40 }] }, "en-GB")).toBe("en");
    expect(chooseLanguage(reliable("und"), "es")).toBe("es");
    expect(chooseLanguage(undefined, "ja")).toBe("ja");
  });

  it("is unknown with neither", () => {
    expect(chooseLanguage({ isReliable: false, languages: [] }, " ")).toBeUndefined();
  });
});

describe("sameLanguage", () => {
  it("treats tl and fil as the same", () => {
    expect(sameLanguage("tl", "fil")).toBe(true);
    expect(sameLanguage("fr", "en")).toBe(false);
  });
});
