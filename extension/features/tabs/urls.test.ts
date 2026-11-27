import { describe, expect, test } from "vitest";
import { isWebUrl, normalizeUrl } from "./urls";

describe("normalizeUrl", () => {
  test("drops the fragment", () => {
    expect(normalizeUrl("https://a.com/page#section")).toBe(normalizeUrl("https://a.com/page"));
  });

  test("drops tracking parameters and keeps the rest in order", () => {
    expect(normalizeUrl("https://a.com/p?b=2&utm_source=x&UTM_Medium=y&a=1&fbclid=z&gclid=q")).toBe(
      "https://a.com/p?b=2&a=1",
    );
  });

  test("leaves no bare question mark when every parameter was tracking", () => {
    expect(normalizeUrl("https://a.com/p?utm_source=x")).toBe("https://a.com/p");
  });

  test("ignores a trailing slash only on the bare origin", () => {
    expect(normalizeUrl("https://a.com")).toBe(normalizeUrl("https://a.com/"));
    expect(normalizeUrl("https://a.com/guide")).not.toBe(normalizeUrl("https://a.com/guide/"));
  });

  test("treats both encodings of a space in the query as the same", () => {
    expect(normalizeUrl("https://a.com/s?q=a%20b")).toBe(normalizeUrl("https://a.com/s?q=a+b&utm_campaign=c"));
  });

  test("keeps scheme, host case and path differences that matter", () => {
    expect(normalizeUrl("HTTPS://A.com/x")).toBe("https://a.com/x");
    expect(normalizeUrl("http://a.com/x")).not.toBe(normalizeUrl("https://a.com/x"));
    expect(normalizeUrl("https://a.com/X")).not.toBe(normalizeUrl("https://a.com/x"));
  });

  test("returns text that is not a URL unchanged", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

test("isWebUrl accepts web and file pages only", () => {
  expect(isWebUrl("https://a.com")).toBe(true);
  expect(isWebUrl("http://a.com")).toBe(true);
  expect(isWebUrl("file:///home/a.pdf")).toBe(true);
  expect(isWebUrl("chrome://newtab/")).toBe(false);
  expect(isWebUrl("about:blank")).toBe(false);
  expect(isWebUrl(undefined)).toBe(false);
});
