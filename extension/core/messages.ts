// Typed message contracts between Nook's contexts. Each request names its
// reply type here, so sender and receiver can't drift apart.

/** The tab tools, as menus, shortcuts and messages name them. */
export const TAB_ACTIONS = ["group-tabs", "close-duplicates", "undo"] as const;
export type TabAction = (typeof TAB_ACTIONS)[number];

export function isTabAction(value: unknown): value is TabAction {
  return (TAB_ACTIONS as readonly unknown[]).includes(value);
}

/**
 * What a tab action did. `count` is the number of tabs grouped, closed or
 * restored; 0 means there was nothing to do. `error` is set when the action
 * could not run: "no-permission" when the user declined tab access.
 */
export interface TabActionResult {
  action: TabAction;
  count: number;
  error?: "no-permission" | (string & {});
}

/**
 * Asks the service worker to run a tab action in the sender's window, or the
 * last focused one. Send it straight from a click handler: the service worker
 * asks for tab access first, and needs the click to still count as a user
 * gesture. Reply: TabActionResult.
 */
export interface RunTabActionMessage {
  type: "tabs:run";
  action: TabAction;
}

export type NookMessage = RunTabActionMessage;
