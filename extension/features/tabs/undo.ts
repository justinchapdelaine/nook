// The undo record for the last tab change, and how it is put back.
//
// The record lives in chrome.storage.session: it survives a service worker
// restart, and the browser clears it when it closes. Only the last change is
// kept; an action that changes nothing leaves the previous record alone.

const KEY = "tabs.undo";

/** Where a tab was before a grouping moved it. */
export interface MovedTab {
  id: number;
  windowId: number;
  index: number;
}

/** A tab that Close duplicates closed. */
export interface ClosedTab {
  url: string;
  windowId: number;
  index: number;
  pinned: boolean;
  groupId: number;
}

export type UndoRecord =
  | { kind: "group"; at: number; tabs: MovedTab[] }
  | { kind: "close"; at: number; tabs: ClosedTab[] };

export async function saveUndo(record: UndoRecord): Promise<void> {
  await chrome.storage.session.set({ [KEY]: record });
}

/** Reads and clears the record, so one change is undone at most once. */
export async function takeUndo(): Promise<UndoRecord | undefined> {
  const { [KEY]: record } = await chrome.storage.session.get(KEY);
  await chrome.storage.session.remove(KEY);
  return record as UndoRecord | undefined;
}

/** A recently closed tab as `sessions.getRecentlyClosed` lists it. */
export interface RecentTab {
  sessionId: string;
  url?: string;
}

/**
 * Pairs each closed tab with an entry of the recently closed list, by exact
 * URL, newest entry first, each entry used once. Tabs with no entry (the list
 * holds 25, and other closes may have pushed ours out) get `undefined` and
 * are reopened by URL instead.
 */
export function matchRecentlyClosed(
  closed: readonly ClosedTab[],
  recent: readonly RecentTab[],
): (string | undefined)[] {
  const used = new Set<string>();
  return closed.map((tab) => {
    const entry = recent.find((r) => r.url === tab.url && !used.has(r.sessionId));
    if (!entry) return undefined;
    used.add(entry.sessionId);
    return entry.sessionId;
  });
}
