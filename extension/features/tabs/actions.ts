// The tab tools, applied to a window with the tabs and tabGroups APIs.
// The decisions are made by the pure planners beside this file; this file
// reads the window, saves the undo record, then makes the change.
import { findDuplicates } from "./duplicates";
import { colorFor, planSiteGroups } from "./group-by-site";
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
  // Saved before the change, so undo still covers a change that stops halfway.
  await saveUndo({ kind: "group", at: Date.now(), tabs: moved });
  for (const group of plan) {
    const tabIds = group.tabIds as [number, ...number[]];
    if (group.groupId !== undefined) {
      await chrome.tabs.group({ groupId: group.groupId, tabIds });
    } else {
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: group.title, color: colorFor(group.title) });
    }
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
  const closed: ClosedTab[] = tabs.flatMap((t) =>
    t.id !== undefined && t.url && closing.has(t.id)
      ? [{ url: t.url, windowId: t.windowId, index: t.index, pinned: t.pinned, groupId: t.groupId }]
      : [],
  );
  const before = new Set((await recentlyClosedTabs()).map((r) => r.sessionId));
  await saveUndo({ kind: "close", at: Date.now(), tabs: closed });
  await chrome.tabs.remove(ids);
  // Note which recently closed entries are Nook's, so undo restores those and
  // not a tab the user closes later at the same address.
  const own = findOwnEntries(closed, before, await recentlyClosedTabs());
  await saveUndo({ kind: "close", at: Date.now(), tabs: closed.map((tab, i) => ({ ...tab, sessionId: own[i] })) });
  return ids.length;
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
  const live = (await Promise.all(record.tabs.map((t) => chrome.tabs.get(t.id).catch(() => undefined)))).flatMap(
    (tab, i) => (tab ? [record.tabs[i] as MovedTab] : []),
  );
  if (live.length === 0) return 0;
  await chrome.tabs.ungroup(live.map((t) => t.id) as [number, ...number[]]);
  // Park the moved tabs at the end of their windows, then put each back in
  // order of its old index. Every tab before the one being placed is then
  // already where it was, so each old index is right again.
  for (const tab of live) await chrome.tabs.move(tab.id, { windowId: tab.windowId, index: -1 }).catch(() => {});
  for (const tab of [...live].sort((a, b) => a.index - b.index)) {
    await chrome.tabs.move(tab.id, { windowId: tab.windowId, index: tab.index }).catch(() => {});
  }
  return live.length;
}

async function reopen(record: Extract<UndoRecord, { kind: "close" }>): Promise<number> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const recent = new Set((await recentlyClosedTabs()).map((r) => r.sessionId));
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
  }
  // Restoring focuses each tab in turn; give focus back to the tab the user was on.
  if (active?.id !== undefined) await chrome.tabs.update(active.id, { active: true }).catch(() => {});
  return count;
}

async function reopenByUrl(tab: ClosedTab): Promise<chrome.tabs.Tab | undefined> {
  const props = { url: tab.url, index: tab.index, pinned: tab.pinned, active: false };
  const created = await chrome.tabs
    .create({ ...props, windowId: tab.windowId })
    // The window may have closed since; open the tab in the current one.
    .catch(() => chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false }))
    .catch(() => undefined);
  if (created?.id !== undefined && tab.groupId !== -1) {
    await chrome.tabs.group({ groupId: tab.groupId, tabIds: created.id }).catch(() => {});
  }
  return created;
}
