import { expect, test } from "vitest";
import type { ClosedTab } from "./undo";
import { matchRecentlyClosed } from "./undo";

const closed = (url: string): ClosedTab => ({ url, windowId: 1, index: 0, pinned: false, groupId: -1 });

test("pairs each closed tab with a recently closed entry by URL, each entry once", () => {
  const recent = [
    { sessionId: "s3", url: "https://a.com/" },
    { sessionId: "s2", url: "https://b.com/" },
    { sessionId: "s1", url: "https://a.com/" },
  ];
  expect(
    matchRecentlyClosed([closed("https://a.com/"), closed("https://b.com/"), closed("https://a.com/")], recent),
  ).toEqual(["s3", "s2", "s1"]);
});

test("leaves tabs that fell off the recently closed list for reopening by URL", () => {
  expect(
    matchRecentlyClosed(
      [closed("https://a.com/"), closed("https://c.com/")],
      [{ sessionId: "s1", url: "https://a.com/" }],
    ),
  ).toEqual(["s1", undefined]);
});
