// Prompts for the experiments. They are the candidates under test, not
// Nook's final prompts.
import type { Lang, Tab } from "./fixtures";
import { LANGUAGE_NAMES } from "./fixtures";
import type { ChatMessage } from "./protocol";

const name = (lang: Lang) => LANGUAGE_NAMES[lang];

export function translatePlain(text: string, from: Lang, to: Lang): ChatMessage[] {
  return [
    {
      role: "system",
      content: `Translate the user's text from ${name(from)} to ${name(to)}. Reply with the translation only, without notes, quotes or explanations.`,
    },
    { role: "user", content: text },
  ];
}

export function translateTagged(text: string, from: Lang, to: Lang, format: "xml" | "bracket"): ChatMessage[] {
  const example = format === "xml" ? "<b1>…</b1>" : "[1]…[/1]";
  return [
    {
      role: "system",
      content:
        `Translate the user's text from ${name(from)} to ${name(to)}. ` +
        `The text contains numbered markers such as ${example} around some words. ` +
        "Keep every marker exactly as written, around the translation of the words it surrounded. " +
        "Do not add, remove or renumber markers. Reply with the translation only.",
    },
    { role: "user", content: text },
  ];
}

export function translateRuns(runs: string[], from: Lang, to: Lang): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        `Translate from ${name(from)} to ${name(to)}. The user sends a JSON array of text pieces that form one sentence when joined. ` +
        `Reply with a JSON array of exactly ${runs.length} strings: the translation of each piece, in the same order, so that joined they form the translated sentence.`,
    },
    { role: "user", content: JSON.stringify(runs) },
  ];
}

export type BatchContext = { pageTitle: string; previous: string };

export function translateBatch(texts: string[], from: Lang, to: Lang, context?: BatchContext): ChatMessage[] {
  const reference = context
    ? ` For reference only (do not translate it), the page is titled "${context.pageTitle}" and the text just before is: "${context.previous}"`
    : "";
  return [
    {
      role: "system",
      content:
        `Translate from ${name(from)} to ${name(to)}. The user sends a JSON array of ${texts.length} separate texts from one web page. ` +
        `Reply with a JSON array of exactly ${texts.length} strings, the translation of each text in the same order.${reference}`,
    },
    { role: "user", content: JSON.stringify(texts) },
  ];
}

export const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"] as const;

export function groupTabs(tabs: Tab[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You sort browser tabs into groups by topic. Reply with JSON only, in this shape: " +
        '{"groups":[{"name":"Short name","color":"blue","tabs":[1,2]}]}. ' +
        `Names are one to three words. Colors are one of: ${GROUP_COLORS.join(", ")}. ` +
        "Each tab number appears in at most one group. Tabs that fit no group are left out.",
    },
    { role: "user", content: tabs.map((tab, i) => `${i + 1}. ${tab.title} (${tab.host})`).join("\n") },
  ];
}

export type GroupingCheck = { ok: boolean; reason?: string; fenced: boolean; groups?: number };

/** Checks a grouping reply. A reply wrapped in a Markdown code fence is accepted but counted. */
export function checkGrouping(reply: string, tabCount: number): GroupingCheck {
  const fence = reply.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const fenced = Boolean(fence);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fence?.[1] ?? reply);
  } catch {
    return { ok: false, reason: "not JSON", fenced };
  }
  const groups = (parsed as { groups?: unknown })?.groups;
  if (!Array.isArray(groups)) return { ok: false, reason: "no groups array", fenced };
  const used = new Set<number>();
  for (const group of groups) {
    if (typeof group?.name !== "string" || !group.name.trim())
      return { ok: false, reason: "group without name", fenced };
    if (!GROUP_COLORS.includes(group.color)) return { ok: false, reason: `bad color ${group.color}`, fenced };
    if (!Array.isArray(group.tabs)) return { ok: false, reason: "group without tabs", fenced };
    for (const tab of group.tabs) {
      if (!Number.isInteger(tab) || tab < 1 || tab > tabCount) return { ok: false, reason: `bad tab ${tab}`, fenced };
      if (used.has(tab)) return { ok: false, reason: `tab ${tab} twice`, fenced };
      used.add(tab);
    }
  }
  return { ok: true, fenced, groups: groups.length };
}

/** Signs that a reply contains reasoning instead of (or before) the answer. */
export function hasReasoning(reply: string): boolean {
  return (
    /<\/?think>/i.test(reply) ||
    /^(okay|ok,|alright|let me|let's|first,|the user|we need to|i need to)/i.test(reply.trim())
  );
}
