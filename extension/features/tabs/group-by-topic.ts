// Group by topic: rules first, then the model. Pure, so it runs in Node
// tests; the caller passes in the registrable-domain lookup and asks the
// model in between the two steps.
//
// 1. prepareTopics() runs the site rules. A site's tabs that would join an
//    existing group named after the site stay a rule decision. A new site
//    group, and every tab left over, becomes one numbered item for the model.
// 2. The model puts items into named groups (core/tasks/group-tabs.ts).
// 3. planTopicGroups() turns that answer into groups to make or add to.
import type { TabItem, TopicGroup } from "../../core/tasks/group-tabs";
import { MAX_ITEMS } from "../../core/tasks/group-tabs";
import type { ExistingGroup, GroupCandidate, PlannedGroup } from "./group-by-site";
import { colorFor, isMovable, planSiteGroups } from "./group-by-site";

/** An item for the model, with the tabs it stands for. A site group from the rules is one item. */
export interface TopicItem extends TabItem {
  tabIds: number[];
  /** The rule's site group, kept when the model leaves this item out. */
  siteGroup?: PlannedGroup;
}

export interface PreparedTopics {
  /** What the rules decide alone: tabs joining existing site groups, and site groups past MAX_ITEMS. */
  ruled: PlannedGroup[];
  /** What the model is asked to place, at most MAX_ITEMS, in window order. */
  items: TopicItem[];
  /** Titles of the window's named groups, which the model may add to. */
  existing: string[];
}

/** The site shown beside a single tab: its hostname without "www.", or "file" for a file. */
function siteLabel(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === "file:" ? "file" : parsed.hostname.replace(/^www\./, "");
}

export function prepareTopics(
  tabs: readonly GroupCandidate[],
  groups: readonly ExistingGroup[],
  siteOf: (hostname: string) => string,
): PreparedTopics {
  const sitePlan = planSiteGroups(tabs, groups, siteOf);
  const ruled = sitePlan.filter((group) => group.groupId !== undefined);
  const newSiteGroups = sitePlan.filter((group) => group.groupId === undefined);
  const placed = new Set(ruled.flatMap((group) => group.tabIds));
  const siteGroupOf = new Map(newSiteGroups.flatMap((group) => group.tabIds.map((id) => [id, group] as const)));
  const items: TopicItem[] = [];
  const seen = new Set<PlannedGroup>();
  for (const tab of tabs.filter(isMovable)) {
    if (placed.has(tab.id)) continue;
    const siteGroup = siteGroupOf.get(tab.id);
    if (!siteGroup) {
      items.push({ titles: [tab.title ?? ""], site: siteLabel(tab.url), tabIds: [tab.id] });
    } else if (!seen.has(siteGroup)) {
      seen.add(siteGroup);
      const titles = siteGroup.tabIds.map((id) => tabs.find((t) => t.id === id)?.title ?? "");
      items.push({ titles, site: siteGroup.title, tabIds: siteGroup.tabIds, siteGroup });
    }
  }
  // Past the limit, the rules decide: a site group is still made, and single tabs stay where they are.
  for (const item of items.splice(MAX_ITEMS)) if (item.siteGroup) ruled.push(item.siteGroup);
  const existing = groups.flatMap((group) => (group.title?.trim() ? [group.title.trim()] : []));
  return { ruled, items, existing };
}

/** Whether the model has anything to do: two items to sort, or one to name or add to a group. */
export function worthAsking({ items, existing }: PreparedTopics): boolean {
  return items.length >= 2 || (items.length === 1 && (items[0]?.siteGroup !== undefined || existing.length > 0));
}

/**
 * Turns the model's groups into a plan. Groups with the same name become
 * one. A name that matches an existing group (ignoring case) adds the tabs
 * to it; otherwise a group with two or more tabs is made, and a lone tab
 * stays where it is. An item the model left out keeps its site group, if
 * the rules gave it one.
 */
export function planTopicGroups(
  prepared: PreparedTopics,
  topics: readonly TopicGroup[],
  groups: readonly ExistingGroup[],
): PlannedGroup[] {
  const key = (name: string) => name.trim().toLowerCase();
  const byName = new Map<string, { name: string; tabIds: number[] }>();
  const used = new Set<number>();
  for (const topic of topics) {
    const entry = byName.get(key(topic.name)) ?? { name: topic.name, tabIds: [] };
    byName.set(key(topic.name), entry);
    for (const index of topic.items) {
      const item = prepared.items[index];
      if (!item) continue;
      used.add(index);
      entry.tabIds.push(...item.tabIds);
    }
  }
  const plan = [...prepared.ruled];
  for (const [name, { name: title, tabIds }] of byName) {
    const existing = groups.find((group) => group.title !== undefined && key(group.title) === name);
    if (existing && tabIds.length > 0)
      plan.push({ title: existing.title ?? title, color: colorFor(title), tabIds, groupId: existing.id });
    else if (tabIds.length >= 2) plan.push({ title, color: colorFor(title), tabIds });
  }
  for (const [index, item] of prepared.items.entries()) {
    if (!used.has(index) && item.siteGroup) plan.push(item.siteGroup);
  }
  return plan;
}
