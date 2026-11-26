// Inline markup for translation: a block of text with marked spans (bold,
// links) is sent to the model in one of three formats, and the reply is
// checked to have every marker back, correctly nested (experiment E6).

export type MarkerFormat = "xml" | "bracket" | "runs";

export type Span = { id: number; kind: "b" | "a"; start: number; end: number };

/** A block of plain text plus spans given as character offsets. Spans may nest but not overlap. */
export type MarkedBlock = { text: string; spans: Span[] };

type Boundary = { at: number; open: boolean; span: Span };

function boundaries(block: MarkedBlock): Boundary[] {
  const list: Boundary[] = [];
  for (const span of block.spans) {
    list.push({ at: span.start, open: true, span }, { at: span.end, open: false, span });
  }
  // At the same offset, close before open; outer spans open first and close last.
  return list.sort(
    (a, b) =>
      a.at - b.at ||
      Number(a.open) - Number(b.open) ||
      (a.open ? b.span.end - a.span.end : b.span.start - a.span.start),
  );
}

function tag(format: "xml" | "bracket", span: Span, open: boolean): string {
  if (format === "xml") return open ? `<${span.kind}${span.id}>` : `</${span.kind}${span.id}>`;
  return open ? `[${span.id}]` : `[/${span.id}]`;
}

/** Renders a block with inline tags, such as `<b1>bold</b1>` or `[1]bold[/1]`. */
export function renderTagged(block: MarkedBlock, format: "xml" | "bracket"): string {
  let out = "";
  let cursor = 0;
  for (const boundary of boundaries(block)) {
    out += block.text.slice(cursor, boundary.at) + tag(format, boundary.span, boundary.open);
    cursor = boundary.at;
  }
  return out + block.text.slice(cursor);
}

/** Splits a block into flat runs at every span boundary, for the JSON format. */
export function renderRuns(block: MarkedBlock): string[] {
  const cuts = [...new Set([0, ...block.spans.flatMap((s) => [s.start, s.end]), block.text.length])].sort(
    (a, b) => a - b,
  );
  const runs: string[] = [];
  for (let i = 0; i < cuts.length - 1; i++) runs.push(block.text.slice(cuts[i], cuts[i + 1]));
  return runs.filter((run) => run.length > 0);
}

export type MarkerCheck = { ok: true; plain: string } | { ok: false; reason: string; plain: string };

const TAG_PATTERN = {
  xml: /<(\/?)([a-z])(\d+)>/g,
  bracket: /\[(\/?)()(\d+)\]/g,
};

/** Checks a tagged reply: the same markers as the block, each once, correctly nested. */
export function checkTagged(reply: string, block: MarkedBlock, format: "xml" | "bracket"): MarkerCheck {
  const plain = reply.replace(TAG_PATTERN[format], "").trim();
  const expected = new Map(block.spans.map((s) => [s.id, s]));
  const seen = new Set<number>();
  const stack: number[] = [];
  for (const match of reply.matchAll(TAG_PATTERN[format])) {
    const [, slash, kind, digits] = match;
    const id = Number(digits);
    const span = expected.get(id);
    if (!span || (format === "xml" && kind !== span.kind))
      return { ok: false, reason: `unknown marker ${match[0]}`, plain };
    if (slash) {
      if (stack.pop() !== id) return { ok: false, reason: `misnested ${match[0]}`, plain };
    } else {
      if (seen.has(id)) return { ok: false, reason: `repeated ${match[0]}`, plain };
      seen.add(id);
      stack.push(id);
    }
  }
  if (stack.length > 0) return { ok: false, reason: "unclosed marker", plain };
  if (seen.size !== expected.size) return { ok: false, reason: "missing marker", plain };
  return { ok: true, plain };
}

/** Checks a JSON runs reply: an array of exactly as many strings as the block has runs. */
export function checkRuns(reply: string, runCount: number): MarkerCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { ok: false, reason: "not JSON", plain: reply.trim() };
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    return { ok: false, reason: "not an array of strings", plain: reply.trim() };
  }
  const plain = parsed.join("").trim();
  if (parsed.length !== runCount) return { ok: false, reason: `${parsed.length} runs, expected ${runCount}`, plain };
  return { ok: true, plain };
}

/** JSON schema for a reply of exactly `count` strings, for WebLLM's constrained output. */
export function stringArraySchema(count: number): string {
  return JSON.stringify({ type: "array", items: { type: "string" }, minItems: count, maxItems: count });
}
