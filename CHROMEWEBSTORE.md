# Chrome Web Store listing: Nook

Last updated: 2026-11-27

What the Chrome Developer Dashboard asks for, kept beside the code so the listing never has to catch up. Every PR that adds or widens a permission adds its justification here. The listing text, privacy policy and graphics are finished in phase 6 of [docs/plan.md](docs/plan.md); until then those sections are drafts or placeholders.

## Store listing (draft)

**Name:** Nook (must match the manifest)

**Single purpose:** Organize your tabs and translate text with tools that run entirely on your device.

**Short description (132 characters at most):** to write in phase 6, once translation ships.

**Category:** Productivity

**Primary language:** English

## Permissions justification

The manifest asks for no host permissions. Nook reads a web page only when the user picks *Translate selection* on it, through `activeTab`, and then only the selected text.

| Permission | Type | Justification |
| --- | --- | --- |
| `contextMenus` | permissions | Adds Nook's commands to right-click menus: Group tabs, Close duplicates, Undo last change and Settings on its toolbar icon and the browser's tabs, and Translate selection on web pages when text is selected. These menus are the main way to use Nook. |
| `storage` | permissions | Keeps Nook's settings (the language to translate into, the model, sites where translation is off) and a record of the last tab change (which tabs were grouped or closed, and where they were) for the current browser session, so Undo last change can put them back. Nothing stored leaves the device, and the undo record is cleared when the browser closes. |
| `tabGroups` | permissions | Group tabs creates tab groups named after each site, adds tabs to an existing group for that site, and removes them again on undo. |
| `sessions` | permissions | Undo last change reopens tabs that Close duplicates closed from the browser's recently closed list, so they come back with their back and forward history. |
| `publicSuffix` | permissions | Group tabs puts tabs from the same site together, for example news.bbc.co.uk and www.bbc.co.uk, by asking the browser for each address's registrable domain. |
| `tabs` | optional_permissions | Not granted at install. Asked for the first time the user runs a tab tool. Nook reads the addresses of the tabs in the current window to find tabs showing the same page and to group tabs by site. Addresses are compared on the device and never sent anywhere. |
| `activeTab` | permissions | When the user picks Translate selection from the page's right-click menu or presses its shortcut, Nook gets access to that one tab for that moment, to read the selected text and show its translation under it. Nook has no access to pages otherwise. |
| `scripting` | permissions | Translate selection adds Nook's translator to the page the user is on, only after the user picks Translate selection there. Nothing is added to pages in advance. |
| `offscreen` | permissions | The translation model runs in a hidden extension page, which keeps it loaded between translations. Nook closes that page after a period without use (10 minutes by default) to free the graphics card's memory. |
| `unlimitedStorage` | permissions | The translation model is a file of about 1.1 GB (0.45 GB for the lighter model), downloaded once when the user agrees on the settings page. This keeps the browser from deleting it to make room, which would mean downloading it again. The user can delete it from the settings page. |

## Privacy and data use (draft)

**Does the extension collect user data?** No. Tab addresses are read on the device only to run the tab tool the user picked, and are kept, for undo, only until the browser closes. Text the user selects to translate is read only after they pick Translate selection, is translated on the device by a model running on its graphics card, and is never stored or sent anywhere. There is no analytics or remote code.

**Network use.** The only network request Nook makes is downloading the translation model's weights from Hugging Face (huggingface.co), once, after the user presses Download on the settings page, which states the size. The model's code ships inside the extension package; only its weights are downloaded. No page text, address or setting is ever sent.

The privacy policy URL is to be added in phase 6.

## Graphics and assets

Not made yet: store icon (128 by 128), at least one screenshot (1280 by 800), small promo tile (440 by 280). The extension has no icon of its own yet, so the browser shows a default one.

## Version history

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
| 0.1.0 | 2026-11-27 | Tab tools: group by site, close duplicates, undo. | Draft, not submitted |
| 0.2.0 | 2026-11-27 | Translate selection, on the device, with a one-time model download from the settings page. | Draft, not submitted |

## Review notes

- The keyboard shortcuts (Alt+Shift+L, Alt+Shift+G, Alt+Shift+D, Alt+Shift+U) need no permission.
- The extension page content security policy allows `'wasm-unsafe-eval'` because the on-device model's code is WebAssembly, compiled at run time. Those files ship inside the package (`model-libs/`); none is fetched from the network.
- To test translation: open Settings, download the model, then select text on any page and pick Translate selection.
