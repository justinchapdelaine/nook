import { describe, expect, it } from "vitest";
import { corpusChrf, sentenceChrf } from "../../bench/lib/chrf";
import { SENTENCES } from "../../bench/lib/fixtures";

// Expected values from sacreBLEU 2.6.0 (corpus_chrf and sentence_chrf, defaults).
describe("chrF", () => {
  it("matches sacreBLEU for a sentence", () => {
    expect(sentenceChrf("Le chat est sur le tapis.", "Le chat dort sur le tapis.")).toBeCloseTo(69.8981, 3);
  });

  it("matches sacreBLEU at corpus level", () => {
    const refs = SENTENCES.slice(0, 5).map((s) => s.text.fra);
    const hyps = refs.map((r) => r.replaceAll("a", "e"));
    expect(corpusChrf(hyps, refs)).toBeCloseTo(69.1599, 3);
  });

  it("counts characters, not UTF-16 units, for Japanese", () => {
    const ref = SENTENCES[0]?.text.jpn ?? "";
    expect(sentenceChrf(ref.slice(0, -3), ref)).toBeCloseTo(95.0861, 3);
  });

  it("scores an empty or identical hypothesis", () => {
    expect(sentenceChrf("", "abc")).toBe(0);
    expect(sentenceChrf("same text", "same text")).toBeCloseTo(100, 6);
  });
});
