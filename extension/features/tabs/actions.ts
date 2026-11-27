// The tab tools, applied to a window with the tabs and tabGroups APIs.
// The decisions are made by the pure planners beside this file; this file
// reads the window, saves the undo record, then makes the change.
import { findDuplicates } from "./duplicates";
import { NO_GROUP, planSiteGroups } from "./group-by-site";
import type { ClosedTab, MovedTab, RecentTab, UndoRecord } from "./undo";
import { findOwnEntries, saveUndo, takeUndo } from "./undo";

/** The registrable domain for display, or the hostname when there is none (localhost, intranet names, IPs). */
function siteOf(hostname: string): string {
  return chrome.publicSuffix.getDomain(hostname, { allowIPAddress: true, encoding: "display" }) ?? hostname;
}

/** Groups the window's ungrouped tabs by site. Returns how many tabs moved. */
export async function groupBySite(windowId: number): Promise<number> {
  const [tabs, groups] = await Promise.all([chrome.tabs.query({ windowId }), chrome.tabGroups.query({ windowId })]);
  const plan = planSiteGroups(
    tabs.flatMap((t) => (t.id === undefined ? [] : [{ id: t.id, url: t.url, pinned: t.pinned, groupId: t.groupId }])),
    groups,
    siteOf,
  );
  const moving = new Set(plan.flatMap((group) => group.tabIds));
  if (moving.size === 0) return 0;
  const moved: MovedTab[] = tabs.flatMap((t) =>
    t.id !== undefined && moving.has(t.id) ? [{ id: t.id, windowId: t.windowId, index: t.index }] : [],
  );
  let saved = false;
  for (const group of plan) {
    const tabIds = group.tabIds as [number, ...number[]];
    const groupId = await chrome.tabs.group(
      group.groupId !== undefined ? { groupId: group.groupId, tabIds } : { tabIds, createProperties: { windowId } },
    );
    // Saved once the first tabs have moved: a grouping that fails at once
    // keeps the previous undo, and one that stops halfway can still be undone.
    if (!saved) {
      await saveUndo({ kind: "group", tabs: moved });
      saved = true;
    }
    if (group.groupId === undefined) await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
  }
  return moving.size;
}

/** Closes tabs that show the same page as another tab in the window. Returns how many closed. */
export async function closeDuplicates(windowId: number): Promise<number> {
  const tabs = await chrome.tabs.query({ windowId });
  const ids = findDuplicates(
    tabs.flatMap((t) => (t.id === undefined ? [] : [{ id: t.id, url: t.url, active: t.active, pinned: t.pinned }])),
  );
  if (ids.length === 0) return 0;
  const closing = new Set(ids);
  const [recent, groups] = await Promise.all([recentlyClosedTabs(), chrome.tabGroups.query({ windowId })]);
  const targets: { id: number; tab: ClosedTab }[] = tabs.flatMap((t) => {
    if (t.id === undefined || !t.url || !closing.has(t.id)) return [];
    const group = groups.find((g) => g.id === t.groupId);
    return [
      {
        id: t.id,
        tab: {
          url: t.url,
          windowId: t.windowId,
          index: t.index,
          pinned: t.pinned,
          groupId: t.groupId,
          ...(group && { group: { title: group.title, color: group.color } }),
        },
      },
    ];
  });
  // One remove per tab: a single call with every id stops at the first tab
  // that is already gone (say, the user closed it first), after closing the
  // ones before it. The record then lists exactly the tabs that closed, so
  // undo can't open copies of tabs that are still open.
  const results = await Promise.allSettled(targets.map(({ id }) => chrome.tabs.remove(id)));
  const closed = targets.filter((_, i) => results[i]?.status === "fulfilled").map(({ tab }) => tab);
  if (closed.length === 0) {
    const failure = results.find((r) => r.status === "rejected");
    if (failure) throw failure.reason;
    return 0;
  }
  // Note which recently closed entries are Nook's, so undo restores those and
  // not a tab the user closes later at the same address.
  const before = new Set(recent.map((r) => r.sessionId));
  const own = findOwnEntries(closed, before, await recentlyClosedTabs());
  await saveUndo({ kind: "close", tabs: closed.map((tab, i) => ({ ...tab, sessionId: own[i] })) });
  return closed.length;
}

async function recentlyClosedTabs(): Promise<RecentTab[]> {
  const entries = await chrome.sessions.getRecentlyClosed({ maxResults: chrome.sessions.MAX_SESSION_RESULTS });
  return entries.flatMap((entry) =>
    entry.tab?.sessionId ? [{ sessionId: entry.tab.sessionId, url: entry.tab.url }] : [],
  );
}

/** Undoes the last grouping or close. Returns how many tabs were put back; 0 when there was nothing to undo. */
export async function undoLast(): Promise<number> {
  const record = await takeUndo();
  if (!record) return 0;
  return record.kind === "group" ? ungroup(record) : reopen(record);
}

async function ungroup(record: Extract<UndoRecord, { kind: "group" }>): Promise<number> {
  const open = new Set((await chrome.tabs.query({})).map((t) => t.id));
  const live = record.tabs.filter((t) => open.has(t.id));
  const [first] = live;
  if (!first) return 0;
  const ids = live.map((t) => t.id) as [number, ...number[]];
  // One at a time, so a tab closed since doesn't stop the others.
  await Promise.all(ids.map((id) => chrome.tabs.ungroup(id).catch(() => {})));
  // Park the moved tabs at the end of their window (a grouping only ever
  // moves tabs within one), then put each back in order of its old index.
  // Every tab before the one being placed is then already where it was, so
  // each old index is right again. These moves must run one at a time.
  await chrome.tabs.move(ids, { windowId: first.windowId, index: -1 }).catch(() => {});
  for (const tab of [...live].sort((a, b) => a.index - b.index)) {
    await chrome.tabs.move(tab.id, { windowId: tab.windowId, index: tab.index }).catch(() => {});
  }
  return live.length;
}

async function reopen(record: Extract<UndoRecord, { kind: "close" }>): Promise<number> {
  const [[active], recentTabs] = await Promise.all([
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    recentlyClosedTabs(),
  ]);
  const recent = new Set(recentTabs.map((r) => r.sessionId));
  // Groups made again during this undo, by the id the closed tabs' group had.
  const regrouped = new Map<number, number>();
  let count = 0;
  for (const tab of [...record.tabs].sort((a, b) => a.index - b.index)) {
    // Restoring Nook's own entry brings back the tab's history. Once other
    // closes push it past the list's 25 entries, reopening by URL is the fallback.
    const restored =
      tab.sessionId && recent.has(tab.sessionId)
        ? (await chrome.sessions.restore(tab.sessionId).catch(() => undefined))?.tab
        : undefined;
    const reopened = restored ?? (await reopenByUrl(tab));
    if (reopened?.id === undefined) continue;
    count++;
    // The browser saves a tab's index as it was when that tab closed, which
    // for the later tabs of a bulk close is after the earlier ones went.
    // Placing each tab in order of its old index puts them all back.
    if (reopened.windowId === tab.windowId) await chrome.tabs.move(reopened.id, { index: tab.index }).catch(() => {});
    if (tab.groupId === NO_GROUP) continue;
    // A restored tab may come back in a group the browser made again; later
    // tabs from the same old group then join that one instead of a copy.
    if (reopened.groupId !== NO_GROUP) regrouped.set(tab.groupId, reopened.groupId);
    else await regroup(reopened.id, reopened.windowId, tab, regrouped);
  }
  // Restoring focuses each tab, and maybe its window, in turn; give focus back
  // to the tab and window the user was on.
  if (active?.id !== undefined) {
    await chrome.tabs.update(active.id, { active: true }).catch(() => {});
    await chrome.windows.update(active.windowId, { focused: true }).catch(() => {});
  }
  return count;
}

/**
 * Puts a reopened tab back in its old group. If the close emptied that group,
 * the browser removed it, so the first tab back makes it again with the same
 * title and colour, and the others join it.
 */
async function regroup(
  tabIds: number,
  windowId: number,
  tab: ClosedTab,
  regrouped: Map<number, number>,
): Promise<void> {
  const groupId = regrouped.get(tab.groupId) ?? tab.groupId;
  const joined = await chrome.tabs.group({ groupId, tabIds }).catch(() => undefined);
  if (joined !== undefined || !tab.group) return;
  const created = await chrome.tabs.group({ tabIds, createProperties: { windowId } }).catch(() => {});
  if (created === undefined) return;
  regrouped.set(tab.groupId, created);
  await chrome.tabGroups.update(created, tab.group).catch(() => {});
}

async function reopenByUrl(tab: ClosedTab): Promise<chrome.tabs.Tab | undefined> {
  try {
    return await chrome.tabs.create({
      url: tab.url,
      windowId: tab.windowId,
      index: tab.index,
      pinned: tab.pinned,
      active: false,
    });
  } catch {
    // The window may have closed since; open the tab in the current one.
    try {
      return await chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false });
    } catch {
      return undefined;
    }
  }
}
