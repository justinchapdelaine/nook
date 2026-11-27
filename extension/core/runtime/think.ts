// With thinking turned off, Qwen3.5 still starts its reply with an empty
// <think></think> block, which WebLLM passes on as text. This filter drops a
// leading think block from a stream, holding back text only while it could
// still be the start of one.

const OPEN = "<think>";
const CLOSE = "</think>";

/** Returns a function that takes each streamed chunk and returns the text to pass on. */
export function createThinkFilter(): (chunk: string) => string {
  let held = "";
  let passing = false;
  return (chunk) => {
    if (passing) return chunk;
    held += chunk;
    const start = held.trimStart();
    if (start.startsWith(OPEN)) {
      const end = start.indexOf(CLOSE);
      if (end < 0) return "";
      const rest = start.slice(end + CLOSE.length).trimStart();
      if (!rest) {
        // The block is closed but the answer hasn't started; keep dropping whitespace.
        held = start.slice(0, end + CLOSE.length);
        return "";
      }
      passing = true;
      return rest;
    }
    if (OPEN.startsWith(start)) return "";
    passing = true;
    return held;
  };
}
