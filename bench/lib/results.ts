// The results block: one JSON document holding the environment and the
// latest run of each experiment. Kept in chrome.storage.local so a long
// session survives a page reload.
import { KEYS } from "./storage-keys";

export const RESULTS_SCHEMA = "nook-bench/1";

export type Results = { schema: string; [section: string]: unknown };

export async function loadResults(): Promise<Results> {
  const stored = (await chrome.storage.local.get(KEYS.results))[KEYS.results] as Results | undefined;
  return stored?.schema === RESULTS_SCHEMA ? stored : { schema: RESULTS_SCHEMA };
}

export async function saveSection(section: string, value: unknown): Promise<Results> {
  const results = await loadResults();
  results[section] = value;
  await chrome.storage.local.set({ [KEYS.results]: results });
  return results;
}

export async function clearResults(): Promise<void> {
  await chrome.storage.local.remove(KEYS.results);
}

/** Rounds numbers so the block stays short enough to paste. */
export function formatResults(results: Results): string {
  return JSON.stringify(
    results,
    (_key, value) => (typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value),
    1,
  );
}
