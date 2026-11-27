// Close duplicates: deciding which tabs go. Pure, so it runs in Node tests.
import { isWebUrl, normalizeUrl } from "./urls";

/** The parts of a tab the duplicate check reads. */
export interface DuplicateCandidate {
  id: number;
  url?: string;
  active: boolean;
  pinned: boolean;
}

/**
 * Picks the tabs to close so that each page stays open once. Tabs match when
 * their normalized URLs are equal. In each set the active tab stays, else a
 * pinned one, else the oldest. Tab ids grow as tabs open, so the lowest id is
 * the oldest. Pinned tabs are never closed.
 */
export function findDuplicates(tabs: readonly DuplicateCandidate[]): number[] {
  const byPage = new Map<string, DuplicateCandidate[]>();
  for (const tab of tabs) {
    if (!isWebUrl(tab.url)) continue;
    const key = normalizeUrl(tab.url);
    const list = byPage.get(key);
    if (list) list.push(tab);
    else byPage.set(key, [tab]);
  }
  const close: number[] = [];
  for (const list of byPage.values()) {
    if (list.length < 2) continue;
    const keep = [...list].sort(
      (a, b) => Number(b.active) - Number(a.active) || Number(b.pinned) - Number(a.pinned) || a.id - b.id,
    )[0];
    for (const tab of list) {
      if (tab !== keep && !tab.pinned) close.push(tab.id);
    }
  }
  return close.sort((a, b) => a - b);
}
