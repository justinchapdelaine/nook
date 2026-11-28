// The models Nook ships, read from models/models.json. A model "family"
// (Qwen3.5-2B) is what the user picks; the runtime loads the family's
// q4f16 build when the GPU has shader-f16 and its q4f32 build otherwise.
// Changing model is a change to that file, not to code.
import config from "../../models/models.json";

export type ModelBuild = (typeof config.models)[number];

export interface ModelFamily {
  /** For example "Qwen3.5-2B". Settings store this. */
  id: string;
  /** Shown on the settings page. */
  label: string;
  /** Size of the weights to download, in MB. */
  downloadMB: number;
  /** Shown beside the label: when to pick this model. */
  note: string;
  builds: ModelBuild[];
}

/** One context window for every task; changing it means reloading the model. */
export const CONTEXT_WINDOW: number = config.contextWindow;

export const FAMILIES: ModelFamily[] = Object.values(
  Object.groupBy(config.models, (m) => m.family) as Record<string, ModelBuild[]>,
).map((builds) => {
  const first = builds[0] as ModelBuild;
  return {
    id: first.family,
    label: first.label.replace(/ \(.*\)$/, ""),
    downloadMB: first.downloadMB,
    note: first.note,
    builds,
  };
});

/** The default model: the first in the list. */
export const DEFAULT_FAMILY = (FAMILIES[0] as ModelFamily).id;

export function findFamily(id: string): ModelFamily | undefined {
  return FAMILIES.find((f) => f.id === id);
}

/** The build to load on a GPU with or without shader-f16. */
export function pickBuild(family: ModelFamily, hasF16: boolean): ModelBuild {
  const build = family.builds.find((b) => b.needsF16 === hasF16) ?? family.builds.find((b) => !b.needsF16);
  if (!build) throw new Error(`${family.id} has no build for this GPU`);
  return build;
}

/** Where a packaged model library is served from, inside the extension. */
export const libUrl = (origin: string, lib: string) => `${origin}/model-libs/${lib}`;
