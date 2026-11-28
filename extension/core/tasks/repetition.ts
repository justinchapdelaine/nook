// A guard against replies stuck in a loop, which small models fall into
// (Nook Bench E3: one word repeated until the token limit). It looks at the
// end of the text for one piece repeated back to back.

/** A loop must repeat at least this often... */
const MIN_REPEATS = 4;
/** ...and cover at least this many characters, so "ha ha ha" or "..." pass. */
const MIN_CHARS = 40;
/** Longest repeated piece looked for: about one sentence. */
const MAX_UNIT = 120;

/**
 * Where a repeating tail starts, keeping one copy of the repeated piece, or
 * -1 if the text doesn't end in a loop. A run the source text has too (dot
 * leaders, separator lines) is translated faithfully, not a loop.
 */
export function findRepetition(text: string, source = ""): number {
  for (let unit = 1; unit <= Math.min(MAX_UNIT, Math.floor(text.length / MIN_REPEATS)); unit++) {
    const piece = text.slice(text.length - unit);
    let repeats = 1;
    // startsWith treats a negative position as 0, so stop at the start of the text.
    while (unit * (repeats + 1) <= text.length && text.startsWith(piece, text.length - unit * (repeats + 1))) repeats++;
    if (repeats < MIN_REPEATS || repeats * unit < MIN_CHARS) continue;
    if (source.includes(piece.repeat(MIN_REPEATS))) continue;
    return text.length - (repeats - 1) * unit;
  }
  return -1;
}
