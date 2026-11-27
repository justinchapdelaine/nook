# Chrome Web Store listing: Nook

Last updated: 2026-11-27

What the Chrome Developer Dashboard asks for, kept beside the code so the listing never has to catch up. Every PR that adds or widens a permission adds its justification here. The listing text, privacy policy and graphics are finished in phase 6 of [docs/plan.md](docs/plan.md); until then those sections are drafts or placeholders.

## Store listing (draft)

**Name:** Nook (must match the manifest)

**Single purpose:** Organize your tabs and translate pages with tools that run entirely on your device.

**Short description (132 characters at most):** to write in phase 6, once translation ships.

**Category:** Productivity

**Primary language:** English

## Permissions justification

The manifest asks for no host permissions. Nook never reads or changes the content of web pages in this version.

| Permission | Type | Justification |
| --- | --- | --- |
| `contextMenus` | permissions | Adds Nook's commands (Group tabs, Close duplicates, Undo last change, Settings) to the right-click menu of its toolbar icon and of the browser's tabs. These menus are the main way to use Nook. |
| `storage` | permissions | Keeps a record of the last tab change (which tabs were grouped or closed, and where they were) for the current browser session, so Undo last change can put them back. The record never leaves the device and is cleared when the browser closes. |
| `tabGroups` | permissions | Group tabs creates tab groups named after each site, adds tabs to an existing group for that site, and removes them again on undo. |
| `sessions` | permissions | Undo last change reopens tabs that Close duplicates closed from the browser's recently closed list, so they come back with their back and forward history. |
| `publicSuffix` | permissions | Group tabs puts tabs from the same site together, for example news.bbc.co.uk and www.bbc.co.uk, by asking the browser for each address's registrable domain. |
| `tabs` | optional_permissions | Not granted at install. Asked for the first time the user runs a tab tool. Nook reads the addresses of the tabs in the current window to find tabs showing the same page and to group tabs by site. Addresses are compared on the device and never sent anywhere. |

## Privacy and data use (draft)

**Does the extension collect user data?** No. Tab addresses are read on the device only to run the tab tool the user picked, and are kept, for undo, only until the browser closes. Nothing is sent off the device, and there is no analytics or remote code.

The privacy policy URL is to be added in phase 6.

## Graphics and assets

Not made yet: store icon (128 by 128), at least one screenshot (1280 by 800), small promo tile (440 by 280). The extension has no icon of its own yet, so the browser shows a default one.

## Version history

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
| 0.1.0 | 2026-11-27 | Tab tools: group by site, close duplicates, undo. | Draft, not submitted |

## Review notes

- The keyboard shortcuts (Alt+Shift+G, Alt+Shift+D, Alt+Shift+U) need no permission.
- The extension page content security policy allows `'wasm-unsafe-eval'` for the on-device model that arrives in a later version. No WebAssembly ships in 0.1.0.
