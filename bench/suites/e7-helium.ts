// E7, Helium APIs and permissions: automatic checks of the Chromium probe
// results, run in Helium itself. Manual checks are on the page.
import { OTHER_LANGUAGES, sentence } from "../lib/fixtures";
import { KEYS } from "../lib/storage-keys";
import type { RunContext } from "./context";

async function attempt<T>(body: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await body();
  } catch (error) {
    return { error: String(error) };
  }
}

export async function runHeliumChecks(ctx: RunContext) {
  const result: Record<string, unknown> = {};
  result.menus = (await chrome.storage.local.get(KEYS.menus))[KEYS.menus] ?? "not registered yet";
  result.uiLanguage = chrome.i18n.getUILanguage();
  result.tabsPermission = await chrome.permissions.contains({ permissions: ["tabs"] });

  ctx.log("Detecting text language…");
  const detect: Record<string, unknown> = {};
  for (const lang of ["eng", ...OTHER_LANGUAGES] as const) {
    detect[lang] = await attempt(async () => {
      const r = await chrome.i18n.detectLanguage(sentence(2).text[lang]);
      return { reliable: r.isReliable, top: r.languages.slice(0, 2).map((l) => `${l.language} ${l.percentage}%`) };
    });
  }
  result.detectLanguage = detect;

  result.publicSuffix = await attempt(async () => {
    if (!chrome.publicSuffix) throw new Error("chrome.publicSuffix is missing");
    return Object.fromEntries(
      ["news.bbc.co.uk", "foo.github.io", "www.example.com", "localhost"].map((h) => [
        h,
        chrome.publicSuffix.getDomain(h),
      ]),
    );
  });

  ctx.log("Opening three test tabs and grouping them…");
  const url = chrome.runtime.getURL("/fixture.html");
  const tabs = await Promise.all([1, 2, 3].map(() => chrome.tabs.create({ url, active: false })));
  const ids = tabs.flatMap((t) => (t.id === undefined ? [] : [t.id]));
  const [first, ...others] = ids;
  if (first === undefined) throw new Error("Could not open test tabs");
  result.tabGroup = await attempt(async () => {
    const groupId = await chrome.tabs.group({ tabIds: [first, ...others] });
    await chrome.tabGroups.update(groupId, { title: "Nook test", color: "blue" });
    const visible = await ctx.askStep(
      'Look at the tab strip: is there a blue group named "Nook test" with three tabs? Press Done if yes, Skip if not.',
    );
    await chrome.tabs.ungroup([first, ...others]);
    return { grouped: true, userSawGroup: visible };
  });

  // Page language needs the page loaded.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  result.pageLanguage = await attempt(() => chrome.tabs.detectLanguage(first));

  ctx.log("Closing a tab and restoring it…");
  result.restore = await attempt(async () => {
    await chrome.tabs.remove(first);
    const closed = await chrome.sessions.getRecentlyClosed({ maxResults: 5 });
    const entry = closed.find((s) => s.tab && (s.tab.url === url || s.tab.title === "Nook Bench test tab"));
    if (!entry?.tab?.sessionId) return { found: false, entries: closed.length };
    const restored = await chrome.sessions.restore(entry.tab.sessionId);
    if (restored.tab?.id !== undefined) others.push(restored.tab.id);
    return { found: true, restored: Boolean(restored.tab), urlVisible: Boolean(entry.tab.url) };
  });
  await chrome.tabs.remove(others).catch(() => {});
  return result;
}
