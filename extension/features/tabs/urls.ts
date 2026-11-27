// URL helpers shared by the tab tools. Pure functions, no browser APIs.

/** Query parameters that only track where a click came from, never what page it shows. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

/** The schemes whose tabs the tab tools act on. New tab pages, settings and other browser pages are left alone. */
export function isWebUrl(url: string | undefined): url is string {
  return url !== undefined && /^(https?|file):/i.test(url);
}

/**
 * The form of a URL used to decide whether two tabs show the same page.
 * Drops the fragment and tracking parameters. A trailing slash is only ignored
 * on the bare origin (the URL parser already writes `https://a.com` as
 * `https://a.com/`), because `/guide` and `/guide/` can be different pages.
 * Returns the input unchanged when it does not parse.
 */
export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = "";
  // The query is always rewritten, not only when a parameter goes, so that
  // both URLs of a pair get the same encoding ("%20" and "+" both become "+").
  // This also writes `?a` as `?a=`, which servers treat as the same.
  const kept = [...parsed.searchParams].filter(([name]) => !isTrackingParam(name));
  parsed.search = new URLSearchParams(kept).toString();
  return parsed.href;
}
