// Downloads the WebLLM model libraries named in one or more model lists into
// an output folder, so they ship inside a package (no remotely hosted code).
// Each file is checked against its pinned sha256; existing good files are kept.
//
//   node scripts/fetch-model-libs.ts <output folder> <models.json> [<models.json> ...]
//
// The extension packages models/models.json only; the bench adds bench/models.json.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Config = { libSource: string; models: { lib: string; sha256: string }[] };

const [outArg, ...lists] = process.argv.slice(2);
if (!outArg || lists.length === 0) throw new Error("Usage: fetch-model-libs.ts <output folder> <models.json>...");
const outDir = resolve(outArg);
await mkdir(outDir, { recursive: true });

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

for (const list of lists) {
  const config: Config = JSON.parse(await readFile(resolve(list), "utf8"));
  for (const { lib, sha256: expected } of config.models) {
    const path = resolve(outDir, lib);
    const existing = await readFile(path).catch(() => null);
    if (existing && sha256(existing) === expected) {
      console.log(`ok     ${lib}`);
      continue;
    }
    const response = await fetch(config.libSource + lib);
    if (!response.ok) throw new Error(`${lib}: HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    const actual = sha256(data);
    if (actual !== expected) throw new Error(`${lib}: sha256 ${actual}, expected ${expected}`);
    await writeFile(path, data);
    console.log(`fetched ${lib} (${(data.length / 1e6).toFixed(1)} MB)`);
  }
}
