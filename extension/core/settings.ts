// Typed settings, kept in chrome.storage.local under one key. Readers get
// the defaults for anything not set yet.
import { DEFAULT_FAMILY, findFamily } from "./models";

export interface Settings {
  /** Language to translate into, as a primary language subtag such as "en". */
  targetLanguage: string;
  /** Model family from models/models.json. */
  model: string;
  /** Minutes without use before the model is unloaded to free GPU memory. */
  idleMinutes: number;
  /** Hostnames where Nook doesn't translate, such as "example.com" (which covers its subdomains). */
  excludedSites: string[];
}

export const SETTINGS_KEY = "settings";

/** The primary subtag of a language tag: "en-GB" gives "en". */
export const primaryLanguage = (tag: string) => tag.split(/[-_]/)[0]?.toLowerCase() ?? tag;

export function defaultSettings(): Settings {
  return {
    targetLanguage: primaryLanguage(chrome.i18n.getUILanguage()),
    model: DEFAULT_FAMILY,
    idleMinutes: 10,
    excludedSites: [],
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  const settings = { ...defaultSettings(), ...stored };
  // A model dropped from the list falls back to the default.
  if (!findFamily(settings.model)) settings.model = DEFAULT_FAMILY;
  return settings;
}

export async function updateSettings(change: Partial<Settings>): Promise<Settings> {
  const settings = { ...(await getSettings()), ...change };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

/** Whether `hostname` is one of the excluded sites or a subdomain of one. */
export function isExcluded(hostname: string, excludedSites: string[]): boolean {
  const host = hostname.toLowerCase();
  return excludedSites.some((site) => {
    const s = site.trim().toLowerCase();
    return s !== "" && (host === s || host.endsWith(`.${s}`));
  });
}
