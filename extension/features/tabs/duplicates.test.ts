import { expect, test } from "vitest";
import type { DuplicateCandidate } from "./duplicates";
import { findDuplicates } from "./duplicates";

const tab = (id: number, url: string, extra: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id,
  url,
  active: false,
  pinned: false,
  ...extra,
});

test("keeps the oldest tab of each page and closes the rest", () => {
  const tabs = [tab(5, "https://a.com/x"), tab(2, "https://a.com/x#top"), tab(9, "https://a.com/x?utm_source=n")];
  expect(findDuplicates(tabs)).toEqual([5, 9]);
});

test("keeps the active tab over an older one", () => {
  const tabs = [tab(1, "https://a.com/"), tab(2, "https://a.com", { active: true })];
  expect(findDuplicates(tabs)).toEqual([1]);
});

test("never closes a pinned tab, and prefers to keep one", () => {
  const tabs = [
    tab(1, "https://a.com/"),
    tab(2, "https://a.com/", { pinned: true }),
    tab(3, "https://a.com/", { pinned: true }),
  ];
  expect(findDuplicates(tabs)).toEqual([1]);
  const withActive = [tab(1, "https://a.com/", { pinned: true }), tab(2, "https://a.com/", { active: true })];
  expect(findDuplicates(withActive)).toEqual([]);
});

test("leaves different pages, browser pages and tabs without a URL alone", () => {
  const tabs = [
    tab(1, "https://a.com/guide"),
    tab(2, "https://a.com/guide/"),
    tab(3, "chrome://newtab/"),
    tab(4, "chrome://newtab/"),
    { id: 5, active: false, pinned: false },
    { id: 6, active: false, pinned: false },
  ];
  expect(findDuplicates(tabs)).toEqual([]);
});
