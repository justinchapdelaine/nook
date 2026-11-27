import { expect, test } from "vitest";
import type { ClosedTab } from "./undo";
import { findOwnEntries } from "./undo";

const closed = (url: string): ClosedTab => ({ url, windowId: 1, index: 0, pinned: false, groupId: -1 });

test("pairs each closed tab with an entry its own close created, by URL, each entry once", () => {
  const after = [
    { sessionId: "s4", url: "https://a.com/" },
    { sessionId: "s3", url: "https://b.com/" },
    { sessionId: "s2", url: "https://a.com/" },
    { sessionId: "s1", url: "https://a.com/" },
  ];
  const tabs = [closed("https://a.com/"), closed("https://b.com/"), closed("https://a.com/")];
  expect(findOwnEntries(tabs, new Set(["s1"]), after)).toEqual(["s4", "s3", "s2"]);
});

test("never takes an entry that was already in the list before the close", () => {
  const after = [{ sessionId: "s1", url: "https://a.com/" }];
  expect(findOwnEntries([closed("https://a.com/")], new Set(["s1"]), after)).toEqual([undefined]);
});
