import { describe, expect, it } from "vitest";
import { findRepetition } from "./repetition";

describe("findRepetition", () => {
  it("finds a repeated word and keeps one copy", () => {
    const text = `Habari ya asubuhi ${"sana ".repeat(12)}`;
    expect(text.slice(0, findRepetition(text))).toBe("Habari ya asubuhi sana ");
  });

  it("finds a repeated character run", () => {
    const text = `答案是${"的".repeat(45)}`;
    expect(text.slice(0, findRepetition(text))).toBe("答案是的");
  });

  it("finds a repeated sentence", () => {
    const sentence = "The cat sat on the mat and looked out of the window. ";
    const text = `Intro. ${sentence.repeat(4)}`;
    expect(text.slice(0, findRepetition(text))).toBe(`Intro. ${sentence}`);
  });

  it("finds a loop that fills the whole text", () => {
    expect(findRepetition("la ".repeat(20))).toBe(3);
  });

  it("leaves a run that the source has too", () => {
    const leader = `Introduction ${".".repeat(44)}`;
    expect(findRepetition(leader, `Einleitung ${".".repeat(44)} 3`)).toBe(-1);
    expect(findRepetition(leader)).toBe(14);
  });

  it("leaves ordinary text and short repeats alone", () => {
    expect(findRepetition("Ha ha ha, that was funny... Very, very good.")).toBe(-1);
    expect(findRepetition("Bonjour le monde")).toBe(-1);
    expect(findRepetition("")).toBe(-1);
  });
});
