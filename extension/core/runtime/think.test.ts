import { describe, expect, it } from "vitest";
import { createThinkFilter } from "./think";

const run = (chunks: string[]) => {
  const filter = createThinkFilter();
  return chunks.map(filter).join("");
};

describe("createThinkFilter", () => {
  it("drops a leading empty think block split across chunks", () => {
    expect(run(["<th", "ink>\n\n</thi", "nk>\n\n", "Bonjour", " le monde"])).toBe("Bonjour le monde");
  });

  it("drops a think block with reasoning in it", () => {
    expect(run(["<think>Let me see</think>", "Hallo"])).toBe("Hallo");
  });

  it("passes a reply without a think block unchanged", () => {
    expect(run(["Hello", " <think> later is kept"])).toBe("Hello <think> later is kept");
  });

  it("passes a reply that starts like a tag but isn't one", () => {
    expect(run(["<", "b>bold"])).toBe("<b>bold");
  });
});
