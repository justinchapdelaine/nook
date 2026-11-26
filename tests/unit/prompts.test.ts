import { describe, expect, it } from "vitest";
import { tabLists } from "../../bench/lib/fixtures";
import { checkGrouping, hasReasoning, stripEmptyThinkBlock } from "../../bench/lib/prompts";

describe("checkGrouping", () => {
  const good =
    '{"groups":[{"name":"Cooking","color":"green","tabs":[1,2]},{"name":"Travel","color":"blue","tabs":[3]}]}';

  it("accepts valid JSON, and counts a code fence", () => {
    expect(checkGrouping(good, 4)).toEqual({ ok: true, fenced: false, groups: 2 });
    expect(checkGrouping(`\`\`\`json\n${good}\n\`\`\``, 4)).toEqual({ ok: true, fenced: true, groups: 2 });
  });

  it("rejects broken or inconsistent replies", () => {
    expect(checkGrouping("{groups:", 4).reason).toBe("not JSON");
    expect(checkGrouping('{"groups":[{"name":"A","color":"teal","tabs":[1]}]}', 4).reason).toBe("bad color teal");
    expect(checkGrouping('{"groups":[{"name":"A","color":"red","tabs":[5]}]}', 4).reason).toBe("bad tab 5");
    expect(
      checkGrouping('{"groups":[{"name":"A","color":"red","tabs":[1]},{"name":"B","color":"red","tabs":[1]}]}', 4)
        .reason,
    ).toBe("tab 1 twice");
  });
});

describe("hasReasoning", () => {
  it("flags think tags and reasoning openers only", () => {
    expect(hasReasoning("<think>hmm</think>Bonjour")).toBe(true);
    expect(hasReasoning("Okay, the user wants French.")).toBe(true);
    expect(hasReasoning("Bonjour tout le monde")).toBe(false);
  });
});

describe("tabLists", () => {
  it("makes fixed lists of 6 to 12 distinct tabs", () => {
    const lists = tabLists(20);
    expect(lists).toHaveLength(20);
    for (const list of lists) {
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(list.length).toBeLessThanOrEqual(12);
      expect(new Set(list).size).toBe(list.length);
    }
    expect(tabLists(20)).toEqual(lists);
  });
});

describe("stripEmptyThinkBlock", () => {
  it("removes only an empty think block at the start", () => {
    expect(stripEmptyThinkBlock("<think>\n\n</think>\n\nBonjour")).toBe("Bonjour");
    expect(hasReasoning(stripEmptyThinkBlock("<think>\n\n</think>\n\nBonjour"))).toBe(false);
    expect(stripEmptyThinkBlock("<think>hmm</think>Bonjour")).toBe("<think>hmm</think>Bonjour");
    expect(stripEmptyThinkBlock('["a"]')).toBe('["a"]');
  });
});
