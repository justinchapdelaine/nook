// Group by site: deciding which tabs go into which group. Pure, so it runs
// in Node tests; the caller passes in the registrable-domain lookup.
import { isWebUrl } from "./urls";

export type GroupColor = `${chrome.tabGroups.Color}`;
export const GROUP_COLORS: readonly GroupColor[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

/** The `groupId` of a tab in no group (chrome.tabGroups.TAB_GROUP_ID_NONE, kept here so this file needs no browser). */
export const NO_GROUP = -1;

/** The parts of a tab the grouping reads. `groupId` is NO_GROUP for a tab in no group. */
export interface GroupCandidate {
  id: number;
  url?: string;
  pinned: boolean;
  groupId: number;
}

/** An existing group in the window. */
export interface ExistingGroup {
  id: number;
  title?: string;
}

/** One group to create (no `groupId`) or to add tabs to. `color` is only used for a new group. */
export interface SiteGroup {
  title: string;
  color: GroupColor;
  tabIds: number[];
  groupId?: number;
}

/** A stable colour per site, so a site keeps its colour from one run to the next. */
export function colorFor(title: string): GroupColor {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length] as GroupColor;
}

/**
 * Plans groups by registrable domain (`news.bbc.co.uk` and `www.bbc.co.uk`
 * both become `bbc.co.uk`). Only tabs in no group move, so groups the user
 * made stay as they are. A site's tabs join an existing group with the site's
 * name as its title, else a new group is made when the site has two or more
 * tabs. Pinned tabs and browser pages stay put.
 */
export function planSiteGroups(
  tabs: readonly GroupCandidate[],
  groups: readonly ExistingGroup[],
  siteOf: (hostname: string) => string,
): SiteGroup[] {
  const bySite = new Map<string, number[]>();
  for (const tab of tabs) {
    if (tab.pinned || tab.groupId !== NO_GROUP || !isWebUrl(tab.url)) continue;
    const url = new URL(tab.url);
    const site = url.protocol === "file:" ? "Files" : siteOf(url.hostname);
    const list = bySite.get(site);
    if (list) list.push(tab.id);
    else bySite.set(site, [tab.id]);
  }
  const plan: SiteGroup[] = [];
  for (const [title, tabIds] of bySite) {
    const existing = groups.find((group) => group.title === title);
    if (existing) plan.push({ title, color: colorFor(title), tabIds, groupId: existing.id });
    else if (tabIds.length >= 2) plan.push({ title, color: colorFor(title), tabIds });
  }
  return plan;
}
