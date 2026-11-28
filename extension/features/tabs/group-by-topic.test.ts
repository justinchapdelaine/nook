import { expect, test } from "vitest";
import { MAX_ITEMS } from "../../core/tasks/group-tabs";
import type { GroupCandidate } from "./group-by-site";
import { colorFor, NO_GROUP } from "./group-by-site";
import { planTopicGroups, prepareTopics, worthAsking } from "./group-by-topic";

const siteOf = (host: string) => host.split(".").slice(-2).join(".");

const tab = (id: number, url: string, title: string, extra: Partial<GroupCandidate> = {}): GroupCandidate => ({
  id,
  url,
  title,
  pinned: false,
  groupId: NO_GROUP,
  ...extra,
});

const window = [
  tab(1, "https://www.bbcgoodfood.com/soup", "Lentil soup"),
  tab(2, "https://github.com/a", "PR #1"),
  tab(3, "https://gist.github.com/b", "Gist"),
  tab(4, "https://www.lonelyplanet.com/lisbon", "Lisbon in 3 days"),
  tab(5, "https://news.example.com/", "News", { groupId: 9 }),
  tab(6, "https://pinned.example/", "Mail", { pinned: true }),
  tab(7, "chrome://settings/", "Settings"),
  tab(8, "https://example.com/today", "Today"),
];
const groups = [{ id: 9, title: "example.com" }, { id: 10, title: "Travel" }, { id: 11 }];

test("site rules come first: a site's tabs are one item, and tabs joining a group named after their site are left to the rules", () => {
  const prepared = prepareTopics(window, groups, siteOf);
  expect(prepared.ruled).toEqual([{ title: "example.com", color: colorFor("example.com"), tabIds: [8], groupId: 9 }]);
  expect(prepared.items.map(({ titles, site, tabIds }) => ({ titles, site, tabIds }))).toEqual([
    { titles: ["Lentil soup"], site: "bbcgoodfood.com", tabIds: [1] },
    { titles: ["PR #1", "Gist"], site: "github.com", tabIds: [2, 3] },
    { titles: ["Lisbon in 3 days"], site: "lonelyplanet.com", tabIds: [4] },
  ]);
  expect(prepared.existing).toEqual(["example.com", "Travel"]);
  expect(worthAsking(prepared)).toBe(true);
});

test("the model is asked only when it has something to sort, name or add to a group", () => {
  expect(worthAsking(prepareTopics([], [], siteOf))).toBe(false);
  expect(worthAsking(prepareTopics([tab(1, "https://a.com/", "A")], [], siteOf))).toBe(false);
  expect(worthAsking(prepareTopics([tab(1, "https://a.com/", "A")], [{ id: 2, title: "Work" }], siteOf))).toBe(true);
  expect(worthAsking(prepareTopics([tab(1, "https://a.com/x", "A"), tab(2, "https://a.com/y", "B")], [], siteOf))).toBe(
    true,
  );
});

test("past the item limit, site groups are made by the rules and single tabs stay", () => {
  const many = Array.from({ length: MAX_ITEMS + 2 }, (_, i) => tab(i + 1, `https://site${i}.com/`, `Tab ${i}`));
  many.push(tab(500, "https://site101.com/other", "Tab 101 again"));
  const prepared = prepareTopics(many, [], siteOf);
  expect(prepared.items).toHaveLength(MAX_ITEMS);
  expect(prepared.ruled).toEqual([
    { title: "site101.com", color: colorFor("site101.com"), tabIds: [MAX_ITEMS + 2, 500] },
  ]);
});

test("the model's groups become new groups, additions to existing ones, or nothing for a lone tab", () => {
  const prepared = prepareTopics(window, groups, siteOf);
  const plan = planTopicGroups(
    prepared,
    [
      { name: "Code", items: [1] },
      { name: "travel", items: [2] },
      { name: "Cooking", items: [0] },
    ],
    groups,
  );
  expect(plan).toEqual([
    { title: "example.com", color: colorFor("example.com"), tabIds: [8], groupId: 9 },
    { title: "Code", color: colorFor("Code"), tabIds: [2, 3] },
    { title: "Travel", color: colorFor("travel"), tabIds: [4], groupId: 10 },
  ]);
});

test("groups with the same name merge, and an item the model left out keeps its site group", () => {
  const prepared = prepareTopics(window, groups, siteOf);
  const plan = planTopicGroups(
    prepared,
    [
      { name: "Weekend", items: [0] },
      { name: "weekend", items: [2] },
    ],
    groups,
  );
  expect(plan).toEqual([
    { title: "example.com", color: colorFor("example.com"), tabIds: [8], groupId: 9 },
    { title: "Weekend", color: colorFor("Weekend"), tabIds: [1, 4] },
    { title: "github.com", color: colorFor("github.com"), tabIds: [2, 3] },
  ]);
});
