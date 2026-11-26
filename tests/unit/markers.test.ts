import { describe, expect, it } from "vitest";
import { markSentence } from "../../bench/lib/fixtures";
import type { MarkedBlock } from "../../bench/lib/markers";
import { checkRuns, checkTagged, renderRuns, renderTagged } from "../../bench/lib/markers";

const nested: MarkedBlock = {
  text: "The quick brown fox jumps",
  spans: [
    { id: 1, kind: "b", start: 4, end: 19 },
    { id: 2, kind: "a", start: 10, end: 15 },
  ],
};

describe("renderTagged", () => {
  it("renders nested spans in both tag formats", () => {
    expect(renderTagged(nested, "xml")).toBe("The <b1>quick <a2>brown</a2> fox</b1> jumps");
    expect(renderTagged(nested, "bracket")).toBe("The [1]quick [2]brown[/2] fox[/1] jumps");
  });

  it("renders spans that share an edge", () => {
    const block: MarkedBlock = {
      text: "ab",
      spans: [
        { id: 1, kind: "b", start: 0, end: 1 },
        { id: 2, kind: "b", start: 1, end: 2 },
      ],
    };
    expect(renderTagged(block, "xml")).toBe("<b1>a</b1><b2>b</b2>");
  });
});

describe("checkTagged", () => {
  it("accepts a reply with the same markers, nested", () => {
    const check = checkTagged("Le <b1>rapide <a2>brun</a2> renard</b1> saute", nested, "xml");
    expect(check).toEqual({ ok: true, plain: "Le rapide brun renard saute" });
  });

  it("rejects missing, repeated, misnested, unknown and unclosed markers", () => {
    expect(checkTagged("Le <b1>rapide</b1> renard", nested, "xml")).toMatchObject({ reason: "missing marker" });
    expect(checkTagged("<b1>a</b1><b1>b</b1><a2>c</a2>", nested, "xml")).toMatchObject({ reason: "repeated <b1>" });
    expect(checkTagged("<b1>a<a2>b</b1></a2>", nested, "xml")).toMatchObject({ reason: "misnested </b1>" });
    expect(checkTagged("<b3>a</b3>", nested, "xml")).toMatchObject({ reason: "unknown marker <b3>" });
    expect(checkTagged("<a1>a</a1><a2>b</a2>", nested, "xml")).toMatchObject({ reason: "unknown marker <a1>" });
    expect(checkTagged("[1]a [2]b[/2]", nested, "bracket")).toMatchObject({ reason: "unclosed marker" });
  });
});

describe("runs", () => {
  it("splits at every span edge and checks the reply length", () => {
    const runs = renderRuns(nested);
    expect(runs).toEqual(["The ", "quick ", "brown", " fox", " jumps"]);
    expect(checkRuns(JSON.stringify(["Le ", "rapide ", "brun", " renard", " saute"]), runs.length).ok).toBe(true);
    expect(checkRuns('["a", "b"]', runs.length)).toMatchObject({ ok: false, reason: "2 runs, expected 5" });
    expect(checkRuns("not json", runs.length)).toMatchObject({ ok: false, reason: "not JSON" });
  });
});

describe("markSentence", () => {
  it("adds one or two flat spans, or a nested pair every fourth sentence", () => {
    const text = "one two three four five six seven eight nine";
    expect(renderTagged(markSentence(text, 0), "xml")).toBe(
      "one <b1>two three</b1> four five six <a2>seven eight</a2> nine",
    );
    expect(renderTagged(markSentence(text, 3), "xml")).toBe(
      "one <b1>two <a2>three four</a2> five</b1> six seven eight nine",
    );
  });
});
