import { expect, test } from "vitest";
import { groupingPrompt, groupingSchema, MAX_NAME_CHARS, maxTokensForGrouping, parseGrouping } from "./group-tabs";

test("the prompt numbers each tab, shows a site's tabs on one line, and names existing groups", () => {
  const [system, user] = groupingPrompt(
    [
      { titles: ["Lentil soup\nrecipe"], site: "bbcgoodfood.com" },
      { titles: ["PR #1", "PR #2", "Issues", "Wiki"], site: "github.com" },
      { titles: [""], site: "example.org" },
    ],
    ["Travel", "  "],
  );
  expect(system?.content).toContain("exactly one group");
  expect(user?.content).toBe(
    [
      "Existing groups: Travel",
      "",
      "Tabs:",
      "1. Lentil soup recipe (bbcgoodfood.com)",
      "2. github.com, 4 tabs: PR #1; PR #2; Issues; …",
      "3. Untitled (example.org)",
    ].join("\n"),
  );
});

test("long titles are shortened", () => {
  const [, user] = groupingPrompt([{ titles: ["x".repeat(200)], site: "a.com" }], []);
  expect(user?.content).toBe(`Tabs:\n1. ${"x".repeat(79)}… (a.com)`);
});

test("the schema allows only the numbers in the prompt", () => {
  const schema = JSON.parse(groupingSchema(3));
  expect(schema.properties.groups.items.properties.tabs.items.enum).toEqual([1, 2, 3]);
  expect(schema.required).toEqual(["groups"]);
});

test("the token limit grows with the tabs and stays capped", () => {
  expect(maxTokensForGrouping(10)).toBeGreaterThan(maxTokensForGrouping(2));
  expect(maxTokensForGrouping(1000)).toBe(2048);
});

test("a valid reply becomes groups of indexes from 0, without empty groups", () => {
  const reply = JSON.stringify({
    groups: [
      { name: " Cooking ", tabs: [1, 3] },
      { name: "Empty", tabs: [] },
      { name: "Code", tabs: [2] },
    ],
  });
  expect(parseGrouping(reply, 4)).toEqual([
    { name: "Cooking", items: [0, 2] },
    { name: "Code", items: [1] },
  ]);
});

test("a long name is shortened", () => {
  const [group] = parseGrouping(JSON.stringify({ groups: [{ name: "n".repeat(99), tabs: [1] }] }), 1) as {
    name: string;
  }[];
  expect(group?.name).toHaveLength(MAX_NAME_CHARS);
});

test.each([
  ["{ nope", "not JSON"],
  ["[]", "no groups"],
  ['{"groups":[{"name":"  ","tabs":[1]}]}', "a group without a name"],
  ['{"groups":[{"name":"A"}]}', "A has no tabs"],
  ['{"groups":[{"name":"A","tabs":[0]}]}', "unknown tab 0"],
  ['{"groups":[{"name":"A","tabs":[3]}]}', "unknown tab 3"],
  ['{"groups":[{"name":"A","tabs":[1.5]}]}', "unknown tab 1.5"],
  ['{"groups":[{"name":"A","tabs":[1]},{"name":"B","tabs":[1,2]}]}', "tab 1 in two groups"],
])("rejects %s", (reply, problem) => {
  expect(parseGrouping(reply, 2)).toEqual({ problem });
});
