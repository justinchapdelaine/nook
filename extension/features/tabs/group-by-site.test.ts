import { expect, test } from "vitest";
import type { GroupCandidate } from "./group-by-site";
import { colorFor, GROUP_COLORS, planSiteGroups } from "./group-by-site";

// Stands in for chrome.publicSuffix: the last two labels, or three for co.uk.
const siteOf = (host: string) =>
  host
    .split(".")
    .slice(host.endsWith(".co.uk") ? -3 : -2)
    .join(".");

const tab = (id: number, url: string, extra: Partial<GroupCandidate> = {}): GroupCandidate => ({
  id,
  url,
  pinned: false,
  groupId: -1,
  ...extra,
});

test("groups tabs by registrable domain when a site has two or more", () => {
  const tabs = [
    tab(1, "https://news.bbc.co.uk/a"),
    tab(2, "https://github.com/x"),
    tab(3, "https://www.bbc.co.uk/b"),
    tab(4, "https://example.org/"),
    tab(5, "https://gist.github.com/y"),
  ];
  expect(planSiteGroups(tabs, [], siteOf)).toEqual([
    { title: "bbc.co.uk", color: colorFor("bbc.co.uk"), tabIds: [1, 3] },
    { title: "github.com", color: colorFor("github.com"), tabIds: [2, 5] },
  ]);
});

test("adds tabs to an existing group named after their site, even one tab", () => {
  const tabs = [tab(1, "https://github.com/a"), tab(2, "https://github.com/b", { groupId: 7 })];
  expect(planSiteGroups(tabs, [{ id: 7, title: "github.com" }], siteOf)).toEqual([
    { title: "github.com", color: colorFor("github.com"), tabIds: [1], groupId: 7 },
  ]);
});

test("leaves pinned tabs, tabs already in a group and browser pages where they are", () => {
  const tabs = [
    tab(1, "https://a.com/1", { pinned: true }),
    tab(2, "https://a.com/2", { groupId: 3 }),
    tab(3, "https://a.com/3"),
    tab(4, "chrome://settings/"),
    tab(5, "chrome://history/"),
  ];
  expect(planSiteGroups(tabs, [{ id: 3, title: "Work" }], siteOf)).toEqual([]);
});

test("puts local files in one group", () => {
  const tabs = [tab(1, "file:///a.pdf"), tab(2, "file:///b.html")];
  expect(planSiteGroups(tabs, [], siteOf)).toEqual([{ title: "Files", color: colorFor("Files"), tabIds: [1, 2] }]);
});

test("colours are stable and from the tab group palette", () => {
  expect(colorFor("github.com")).toBe(colorFor("github.com"));
  expect(GROUP_COLORS).toContain(colorFor("bbc.co.uk"));
});
