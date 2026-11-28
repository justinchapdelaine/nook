// groupTabs(): asks the model to sort tabs into named groups by topic, with
// the reply held to a JSON schema, and checks the answer. Features call this
// and never see the model, the prompt or the host.
import type { ChatMessage } from "../runtime/protocol";
import { hostClient, TaskError, toTaskError } from "./host";

/** One line of the prompt: a single tab, or several tabs from one site that stay together. */
export interface TabItem {
  /** Page titles, one per tab. */
  titles: string[];
  /** Where the tabs are, such as "github.com". */
  site: string;
}

/** A group the model made: its name and the indexes (from 0) of the items in it. */
export interface TopicGroup {
  name: string;
  items: number[];
}

/**
 * Most items one request takes. At about 25 tokens a line, the prompt and
 * the longest reply stay far inside the 8K context window.
 */
export const MAX_ITEMS = 100;
const MAX_TITLE_CHARS = 80;
/** Titles shown for a site's tabs that stay together; the rest are counted. */
const TITLES_PER_SITE = 3;
export const MAX_NAME_CHARS = 40;

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * A group name as the prompt shows it and a reply's names come back: on one
 * line, cut to MAX_NAME_CHARS. Compare an existing group's title in this form,
 * since a long one reaches the model, and comes back, cut short.
 */
export const shortName = (name: string) => oneLine(name, MAX_NAME_CHARS);

function itemLine(item: TabItem, n: number): string {
  const titles = item.titles.map((title) => oneLine(title, MAX_TITLE_CHARS) || "Untitled");
  if (titles.length === 1) return `${n}. ${titles[0]} (${item.site})`;
  const shown = titles.slice(0, TITLES_PER_SITE).join("; ");
  const more = titles.length > TITLES_PER_SITE ? "; …" : "";
  return `${n}. ${item.site}, ${titles.length} tabs: ${shown}${more}`;
}

export function groupingPrompt(items: readonly TabItem[], existing: readonly string[]): ChatMessage[] {
  const lines = items.map((item, i) => itemLine(item, i + 1));
  const names = existing.map(shortName).filter(Boolean);
  return [
    {
      role: "system",
      content:
        "You sort browser tabs into groups by topic, such as a trip, a project or a subject. " +
        "Each numbered line is one tab, or several tabs from one site that belong together. " +
        "Put every number in exactly one group. Name each group in one to three words that say what its tabs are about. " +
        "To add tabs to an existing group, use its name exactly. A tab that fits nothing else gets a group of its own. " +
        'Reply with JSON only, in this shape: {"groups":[{"name":"Short name","tabs":[1,2]}]}',
    },
    {
      role: "user",
      content: `${names.length > 0 ? `Existing groups: ${names.join(", ")}\n\n` : ""}Tabs:\n${lines.join("\n")}`,
    },
  ];
}

/** The reply's JSON schema: groups with a name and line numbers from 1 to `count`. */
export function groupingSchema(count: number): string {
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  return JSON.stringify({
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            tabs: { type: "array", items: { type: "integer", enum: numbers } },
          },
          required: ["name", "tabs"],
          additionalProperties: false,
        },
      },
    },
    required: ["groups"],
    additionalProperties: false,
  });
}

/** Enough tokens for every item in a group of its own, which is the longest sensible reply. */
export const maxTokensForGrouping = (count: number) => Math.min(2048, 32 + count * 20);

/**
 * Checks a reply and turns it into groups, or returns why it doesn't check
 * out. Every name must be non-empty and every number known and used at most
 * once. A number the reply leaves out is fine: that item stays where it was.
 */
export function parseGrouping(reply: string, count: number): TopicGroup[] | { problem: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { problem: "not JSON" };
  }
  const groups = (parsed as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return { problem: "no groups" };
  const used = new Set<number>();
  const result: TopicGroup[] = [];
  for (const group of groups as { name?: unknown; tabs?: unknown }[]) {
    const name = typeof group?.name === "string" ? shortName(group.name) : "";
    if (!name) return { problem: "a group without a name" };
    if (!Array.isArray(group.tabs)) return { problem: `${name} has no tabs` };
    const items: number[] = [];
    for (const n of group.tabs) {
      if (!Number.isInteger(n) || n < 1 || n > count) return { problem: `unknown tab ${String(n)}` };
      if (used.has(n)) return { problem: `tab ${n} in two groups` };
      used.add(n);
      items.push(n - 1);
    }
    if (items.length > 0) result.push({ name, items });
  }
  return result;
}

export interface GroupTabsOptions {
  family: string;
}

/**
 * Groups `items` (at most MAX_ITEMS) by topic. `existing` names the groups
 * already in the window, which the model may add to. A reply that doesn't
 * check out is asked for once more, with some randomness so it can differ;
 * a second failure throws TaskError, as does any host failure.
 */
export async function groupTabs(
  items: readonly TabItem[],
  existing: readonly string[],
  options: GroupTabsOptions,
): Promise<TopicGroup[]> {
  if (items.length > MAX_ITEMS) throw new TaskError(`Can't group more than ${MAX_ITEMS} items at once`);
  const messages = groupingPrompt(items, existing);
  const jsonSchema = groupingSchema(items.length);
  let problem = "";
  for (const temperature of [0, 0.7]) {
    let reply = "";
    const request = hostClient().request(
      {
        type: "generate",
        request: {
          family: options.family,
          priority: "user",
          messages,
          maxTokens: maxTokensForGrouping(items.length),
          temperature,
          jsonSchema,
        },
      },
      {
        onDelta: (delta) => {
          reply += delta;
        },
        onRestart: () => {
          reply = "";
        },
      },
    );
    let finishReason: string | null;
    try {
      ({ finishReason } = await request.result);
    } catch (error) {
      throw toTaskError(error);
    }
    const result =
      finishReason === "length" ? { problem: "cut off at the length limit" } : parseGrouping(reply, items.length);
    if (Array.isArray(result)) return result;
    problem = result.problem;
    console.warn(`Nook: the model's tab grouping didn't check out (${problem})`, reply);
  }
  throw new TaskError(`The model's grouping didn't check out (${problem})`);
}
