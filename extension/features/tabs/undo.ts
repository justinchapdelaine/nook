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
  /** The tab's group's look, so undo can make the group again if the close emptied it. */
  group?: { title?: string; color: `${chrome.tabGroups.Color}` };
  /** The browser's recently closed entry for this tab, when it could be found right after the close. */
  sessionId?: string;
}

export type UndoRecord = { kind: "group"; tabs: MovedTab[] } | { kind: "close"; tabs: ClosedTab[] };

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
 * Finds the recently closed entries that Nook's own close created: entries
 * missing from the list taken just before the close, paired with the closed
 * tabs by URL, each used once. Matching only new entries means a tab the user
 * closes later at the same address is never mistaken for Nook's. A tab with
 * no new entry gets `undefined`, and undo reopens it by URL.
 */
export function findOwnEntries(
  closed: readonly ClosedTab[],
  before: ReadonlySet<string>,
  after: readonly RecentTab[],
): (string | undefined)[] {
  const used = new Set(before);
  return closed.map((tab) => {
    const entry = after.find((r) => r.url === tab.url && !used.has(r.sessionId));
    if (!entry) return undefined;
    used.add(entry.sessionId);
    return entry.sessionId;
  });
}
