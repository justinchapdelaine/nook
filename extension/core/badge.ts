// Brief feedback on the toolbar icon's badge: a short text that clears
// itself after a few seconds.

const SHOW_MS = 4000;
const COLORS = { done: "#2f6f4f", info: "#5f6368", error: "#b3261e" } as const;

let clearTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Shows `text` (up to about 4 characters) on the badge, and `title` as the
 * icon's tooltip for the same time, so the result can also be read in full.
 */
export async function flashBadge(text: string, tone: keyof typeof COLORS, title: string): Promise<void> {
  clearTimeout(clearTimer);
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: COLORS[tone] }),
    chrome.action.setBadgeTextColor({ color: "#ffffff" }),
    chrome.action.setBadgeText({ text }),
    chrome.action.setTitle({ title: `Nook: ${title}` }),
  ]);
  // A timer is enough here: the service worker stays alive well past a few
  // seconds after an event, and if it stops first the badge is cleared on the
  // next start (see clearBadge).
  clearTimer = setTimeout(() => void clearBadge(), SHOW_MS);
}

/** Shows `text` until the next flashBadge or clearBadge, for work that takes a few seconds. */
export async function showBadge(text: string, title: string): Promise<void> {
  clearTimeout(clearTimer);
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: COLORS.info }),
    chrome.action.setBadgeTextColor({ color: "#ffffff" }),
    chrome.action.setBadgeText({ text }),
    chrome.action.setTitle({ title: `Nook: ${title}` }),
  ]);
}

export async function clearBadge(): Promise<void> {
  const title = chrome.runtime.getManifest().action?.default_title ?? "Nook";
  await Promise.all([chrome.action.setBadgeText({ text: "" }), chrome.action.setTitle({ title })]);
}
