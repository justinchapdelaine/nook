// chrF (character n-gram F-score), matching sacreBLEU's default chrF2:
// character orders 1 to 6, beta 2, whitespace removed, no word n-grams.
// Corpus scores sum the n-gram statistics over all sentences first, as
// sacreBLEU does, so they are not the mean of sentence scores.

const ORDER = 6;
const BETA = 2;

type Stats = number[]; // [hyp, ref, match] for each order

function ngramCounts(text: string): Map<string, number>[] {
  const chars = Array.from(text.replace(/\s+/gu, ""));
  const counts: Map<string, number>[] = [];
  for (let n = 1; n <= ORDER; n++) {
    const map = new Map<string, number>();
    for (let i = 0; i + n <= chars.length; i++) {
      const gram = chars.slice(i, i + n).join("");
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    counts.push(map);
  }
  return counts;
}

function sum(map: Map<string, number>): number {
  let total = 0;
  for (const count of map.values()) total += count;
  return total;
}

function sentenceStats(hypothesis: string, reference: string): Stats {
  const hyp = ngramCounts(hypothesis);
  const ref = ngramCounts(reference);
  const stats: Stats = [];
  hyp.forEach((hypGrams, n) => {
    const refGrams = ref[n] ?? new Map<string, number>();
    let match = 0;
    for (const [gram, count] of hypGrams) match += Math.min(count, refGrams.get(gram) ?? 0);
    stats.push(sum(hypGrams), sum(refGrams), match);
  });
  return stats;
}

function score(stats: Stats): number {
  const factor = BETA ** 2;
  let precision = 0;
  let recall = 0;
  let effectiveOrder = 0;
  for (let n = 0; n < ORDER; n++) {
    const [hyp = 0, ref = 0, match = 0] = stats.slice(n * 3, n * 3 + 3);
    if (hyp > 0 && ref > 0) {
      precision += match / hyp;
      recall += match / ref;
      effectiveOrder++;
    }
  }
  if (effectiveOrder === 0) return 0;
  precision /= effectiveOrder;
  recall /= effectiveOrder;
  if (precision + recall === 0) return 0;
  return (100 * (1 + factor) * precision * recall) / (factor * precision + recall);
}

export function sentenceChrf(hypothesis: string, reference: string): number {
  return score(sentenceStats(hypothesis, reference));
}

export function corpusChrf(hypotheses: string[], references: string[]): number {
  if (hypotheses.length !== references.length) throw new Error("chrF: length mismatch");
  const total: Stats = new Array(ORDER * 3).fill(0);
  hypotheses.forEach((hypothesis, i) => {
    sentenceStats(hypothesis, references[i] ?? "").forEach((value, j) => {
      total[j] = (total[j] ?? 0) + value;
    });
  });
  return score(total);
}
