// Downloads the WebLLM model libraries listed in bench/models.json into
// bench/public/model-libs/, so they ship inside the extension package (no
// remotely hosted code). Each file is checked against its pinned sha256.
// Run before building: `npm run fetch:libs`. Existing good files are kept.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Config = { libSource: string; models: { lib: string; sha256: string }[] };

const root = new URL("..", import.meta.url).pathname;
const config: Config = JSON.parse(await readFile(join(root, "bench/models.json"), "utf8"));
const outDir = join(root, "bench/public/model-libs");
await mkdir(outDir, { recursive: true });

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

for (const { lib, sha256: expected } of config.models) {
  const path = join(outDir, lib);
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
