// Builds bench/fixtures/flores.json: a fixed sample of FLORES-200 devtest
// sentences (CC BY-SA 4.0) with their translations, for the quality, marker
// and batching experiments. Run once; the output is committed so every
// benchmark run uses the same sentences. Source: a mirror of the official
// release in Helsinki-NLP/OPUS-MT-testsets.
import { writeFile } from "node:fs/promises";

const source =
  "https://raw.githubusercontent.com/Helsinki-NLP/OPUS-MT-testsets/master/datasets/facebook/flores/flores200_dataset/devtest/";
const languages = {
  eng: "eng_Latn",
  fra: "fra_Latn",
  deu: "deu_Latn",
  spa: "spa_Latn",
  jpn: "jpn_Jpan",
  zho: "zho_Hans",
  pol: "pol_Latn",
  ukr: "ukr_Cyrl",
  vie: "vie_Latn",
  swh: "swh_Latn",
  tgl: "tgl_Latn",
};
const count = 24;

const lines: Record<string, string[]> = {};
for (const [code, file] of Object.entries(languages)) {
  const response = await fetch(`${source}${file}.devtest`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  lines[code] = (await response.text()).split("\n");
}

// Medium-length English sentences keep runs short and comparable.
const english = lines.eng ?? [];
const picked: number[] = [];
for (let i = 0; i < english.length && picked.length < count; i++) {
  const length = english[i]?.length ?? 0;
  if (length >= 60 && length <= 180) picked.push(i);
}

const sentences = picked.map((line) => ({
  line: line + 1,
  text: Object.fromEntries(Object.keys(languages).map((code) => [code, lines[code]?.[line]?.trim() ?? ""])),
}));

const fixture = {
  source: "FLORES-200 devtest (NLLB Team et al., 2022), CC BY-SA 4.0",
  languages,
  sentences,
};
await writeFile(new URL("../bench/fixtures/flores.json", import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${sentences.length} sentences`);
