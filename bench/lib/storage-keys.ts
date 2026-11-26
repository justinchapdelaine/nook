// chrome.storage.local keys shared by the service worker, the benchmark
// page and the probe content script.
export const KEYS = {
  results: "results",
  menus: "e7.menus",
  tabMenu: "e7.tabMenu",
  tabsPermission: "e7.tabsPermission",
  probe: "e7.probe",
} as const;
