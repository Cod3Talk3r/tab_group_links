# Tab Group Links

A small Manifest V3 browser extension that lists the tab groups in the current window (plus a virtual **Ungrouped Tabs** entry), previews their numbered tab titles and URLs, and copies or exports every tab in a group as a numbered plain-text list in the original tab order.

## Browser compatibility

- **Brave:** Primary target; tested and working.
- **Google Chrome:** Tested and working.
- **Microsoft Edge:** Tested and working.
- **Mozilla Firefox (desktop):** Tested and working when loaded temporarily. Permanent installation has not been verified.
- **Opera (desktop):** Partially compatible. Opera's Tab Islands are not fully supported; their names and colors are not reliably detected.
- **Vivaldi (desktop):** Partially compatible. A popup issue occurs after deleting a saved group; see [Known limitations](#known-limitations).

The extension uses browser extension APIs, including `tabs`, `tabGroups`, and `storage`.

No external dependencies, no remote services, no icons.

## How it works

1. The toolbar popup lists the current window's native tab groups, ordered by the position of their first tab.
2. A virtual **Ungrouped Tabs** entry lists tabs that are not part of a native group.
3. Selecting a group displays a numbered preview of its tab titles and URLs.
4. **Copy URLs** copies the formatted list to the clipboard.
5. **Export TXT** downloads the same formatted list as a `.txt` file.
6. **Save to Saved Links** stores the selected group's links in the extension's local storage, without opening any websites.

<details>
<summary>Implementation details</summary>

1. The toolbar popup asks for the current window.
2. It reads the window's tab groups (`tabGroups`) and tabs (`tabs`).
3. Real groups appear first, ordered by the position of their first tab in the tab strip. Tabs inside a group keep their original tab order.
4. A virtual **Ungrouped Tabs** entry follows the real groups. It contains every tab whose `groupId` is `-1` (the Chromium sentinel for ungrouped tabs), sorted by `tab.index`. This entry is purely a UI convenience; it never calls `tabGroups` or modifies the browser's actual tab groups.
5. Selecting a real or virtual group shows a preview of its numbered title + URL entries. The preview is collapsed by default to keep the popup compact; its keyboard-operable toggle expands/collapses the links, and the Copy, Save and Export buttons stay visible and usable while collapsed.
6. **Copy URLs** writes the numbered list to the clipboard. It uses `navigator.clipboard.writeText()` and falls back to a hidden `<textarea>` plus `document.execCommand("copy")` if the async clipboard API is unavailable or rejected.
7. **Export TXT** downloads the same numbered list as a `.txt` file using a `Blob` and a temporary object URL, so no extra permission or third-party code is needed.
8. **Save to Saved Links** stores the selected group's links in the extension's Saved Links storage (the same local storage data the Importer writes to) — no copy or file needed. An explicit group title becomes the group name; unnamed groups use the same display name the list shows (for example "Untitled group (blue)"), never an invented one. If a group with that name already exists you can **Merge into existing group** (duplicate URLs are skipped), **Save as a separate group** (under the next free numeric name such as "Work (2)" — "Work (3)" if that is taken), or **Cancel** — cancelling never modifies stored data, and saving never opens any website.

</details>

## Copy and export format

The preview, clipboard output, and TXT export all use the **exact same** format: a numbered title on its own line, the URL on the next line prefixed with ` -> ` (three spaces and an arrow), and one blank line between consecutive entries.

When the selected links belong to a **named** browser tab group, the text starts with that group's name on a `Group name: <name>` line, followed by one blank line:

```text
Group name: Work

1. Example page title
   -> https://example.com/page1

2. Documentation
   -> https://example.com/docs
```

All three surfaces are produced by one shared formatting path, so they cannot drift apart. Numbering starts at 1 for each group (real or virtual) and counts only URLs that are actually included, so skipped tabs never leave number gaps.

The group header is added only when the tab group has a real, explicit title. Synthetic names such as "Untitled group (blue)", orphan groups without metadata, and the virtual "Ungrouped Tabs" entry are exported without a header, exactly as before — no name is ever invented. A name is included as written, including spaces and punctuation, and the exact `Group name: <name>` line is recognised again by the importer (see "Importing saved links"), so copied/exported text round-trips back into the same group name.

<details>
<summary>Formatting rules and edge cases</summary>

- The title is the actual `tab.title` reported by the browser (trimmed) and is kept — titles are never dropped from the output.
- The URL follows on its own line, prefixed with exactly three spaces and `->`. URLs are never truncated, shortened, escaped, or otherwise modified, so a long URL stays complete and occupies a single logical line (the popup preview may visually wrap it, but the generated text does not).
- Exactly one blank line separates consecutive entries. There is no leading or trailing blank line, so the output has no trailing newline.
- If a tab title is missing or empty, its URL is used as the fallback title, so no title line is left blank.
- Newlines and other control characters inside a title are collapsed to a single space, so one tab always produces exactly two output lines (title, then URL).
- Titles that themselves contain `->` are passed through unchanged; only the literal ` -> ` prefix inserted in front of the URL is significant.

**Export filename**

The export filename is descriptive and date-stamped, e.g. `tab-group-Work-2026-10-29.txt` or `tab-group-Ungrouped-Tabs-2026-10-29.txt`. The group name is sanitized (invalid path characters, control characters, Windows-reserved device names, leading/trailing separators, and excessive length); an empty name becomes `untitled`.

**Popup header**

The popup header is compact: a single row with the extension title and a small, circular refresh icon button that is vertically centred with the title, keeps its focus ring, and has an accessible `aria-label`.

**Additional edge cases**

- A window with no tab groups and no ungrouped tabs shows an empty state.
- A window with no real groups but ungrouped tabs still shows the virtual "Ungrouped Tabs" entry.
- A group with no tabs still appears, with copying and exporting disabled.
- Tabs without an accessible URL (neither `url` nor `pendingUrl`) are skipped, counted, and called out in the preview and in the copy/export success message.
- Clipboard failures show an error instead of pretending to succeed.
- Export errors are reported if the Blob download cannot be initiated.

</details>

## Permissions

| Permission | Why |
|---|---|
| `tabGroups` | Read tab group titles, colors, and membership. |
| `tabs` | Read tab URLs. |
| `clipboardWrite` | Write the URL list to the clipboard (including the fallback). |
| `storage` | Keep imported/saved link groups in local extension storage. |

TXT export uses an `<a download>` link with a Blob object URL, which needs no additional permission. In particular, the extension does **not** request the `downloads` permission. The virtual "Ungrouped Tabs" feature needs no extra permissions because it only reads tabs that are already returned by `tabs.query()`.

No host permissions, no content scripts, no background worker.

## Importing saved links

> Importing never opens a website: parsed links are only previewed and then stored as extension data in local storage. Opening a saved link is always an explicit, separate action.

The popup has an **Import saved links** panel (collapsed by default). Paste text or choose a `.txt` file, review the parsed groups and links in the preview, optionally edit group names, then press **Import**. Cancel discards the preview without saving anything.

Two input sources are supported:

- **Paste text** — paste (Ctrl+V or the context menu) directly into the text area. The clipboard is only ever read by you, never by the extension.
- **.txt file** — a **Choose .txt…** button opens a file picker (`accept=".txt,text/plain"`). The file is read with `File.text()`, capped at 5&nbsp;MB. No library is used.

<details>
<summary>Supported import formats</summary>

Format 1 below is the extension's own export format and the primary compatibility target; formats 2–4 are accepted as conveniences, and any subset can be mixed in one input.

**1. Title + indented URL (the export format).** A numbered title on one line and its URL on the next line prefixed with ` -> ` (three spaces and an arrow), blocks separated by blank lines. The written numbers are ignored; line order is kept:

```text
1. Python Documentation
   -> https://docs.python.org/3/

2. FastAPI
   -> https://fastapi.tiangolo.com/
```

**2. Numbered URLs only (legacy export format).** Each line is a number and a URL; the URL becomes both the title and the target:

```text
1. https://example.com/docs
2. https://example.com/dashboard
```

**3. Bare URLs.** One URL per line (`https://example.com/page`); the URL is also used as the title.

**4. Explicit `Group:` headers.** A header line `Group: Name` (case insensitive) — or the `Group name: Name` spelling used by this extension's Copy/Export — starts a new group, and every link after it belongs to that group until the next header line. Headers can be combined with any of formats 1–3:

```text
Group: Programming

1. Python Documentation
   -> https://docs.python.org/3/

Group: Engineering

1. COMSOL
   -> https://www.comsol.com/
```

Titles and URLs are kept exactly as written: long URLs, query strings, fragments and unusual characters are preserved verbatim; titles never have to match real page titles.

</details>

<details>
<summary>How group names are detected</summary>

- Group names come **only** from explicit `Group:`/`Group name:` headers (or group names you type in the preview). The importer never guesses a group name from a URL host, a page title, or arbitrary text.
- Multiple `Group:` headers produce one parsed group each, and each link is associated with the header it appears under. Links before the first header form an unnamed group.
- If the input has links but no recognisable name, the preview shows the links under an empty name field and **Import stays disabled until you type a name**; every detected name is always shown in an editable field.

</details>

<details>
<summary>Import behaviour and edge cases</summary>

- Nothing is opened or requested during import. Parsing and storage are pure data operations; the only code that can create a tab is `src/open-links.js`, invoked solely from explicit **Open** buttons and the **Open all** action — never from import.
- Repeated URLs inside one group are collapsed to the first occurrence.
- Empty groups are skipped with a warning; a header without a name is ignored with a warning; malformed lines and titles without a following URL are skipped with a per-line warning.
- Blank lines and Windows (`CRLF`) / old-Mac (`CR`) line endings are tolerated; a leading UTF-8 BOM is stripped.
- Only `http:` and `https:` URLs are accepted. `javascript:`, `data:`, `file:` and other schemes are rejected with a warning, as are malformed or spaced URLs. Long inputs are capped (2,000 links per import; 5,000 links / 500 groups stored), and storage quota failures surface as an error instead of silently losing data.
- Duplicate group names inside one input are merged (first name wins, links appended and de-duplicated) with a warning.

</details>

### Name conflicts with existing saved groups

If any imported group name already exists among saved links, the popup shows **Merge into existing**, **Import as new**, and **Cancel**:

- **Merge into existing** appends the new links to the existing group, de-duplicated by URL; the saved group keeps its name and nothing is overwritten.
- **Import as new** stores the imported group under the next free numeric name: `Work (2)`, then `Work (3)` while those names are taken; existing names that already carry a numeric suffix count as taken, and an unused name is always kept unchanged. The existing group is untouched.
- **Cancel** skips only the conflicting groups.

An existing group is never silently overwritten.

### Saved links panel

Confirmed imports appear under **Saved links** as expandable groups with per-link **Open** and **Remove** buttons, an **Open all** icon button on each saved group (opens that group's links in background tabs, in order), and a group-level **Remove** button that deletes the entire saved group after a confirmation dialog.

These are saved links stored in this extension's data, **not** open browser tabs; the panel says so explicitly. They persist across popup closures and browser restarts, and are never auto-restored into tabs.

### Import-related permissions

`storage` is used for local extension storage. No `clipboardRead`, `activeTab`, `downloads`, or host permissions are requested — `clipboardRead` would display Chrome's warning **"Read data you copy and paste"**. Pasting is done by the user directly into the Import text area, and the file picker needs no permission.

## Install in Brave (developer mode)

1. Open `brave://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the folder where you cloned this repository.
5. Pin **Tab Group Links** from the extensions (puzzle piece) menu.
6. Open the popup on a window that has tab groups.

After editing files, press the reload button on the extension card in `brave://extensions` and reopen the popup.

## Install in Google Chrome (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the cloned project folder.
5. Pin **Tab Group Links** from the Extensions menu.
6. Open the popup on a window containing tab groups.

After editing files, click the Reload button on the extension card and reopen the popup.

## Install in Microsoft Edge (developer mode)

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the cloned project folder.
5. Pin Tab Group Links from the Extensions menu.
6. Open the extension popup in a window containing tab groups.

After editing files, click the Reload button on the extension card and reopen the popup.

## Firefox (temporary desktop testing)

Firefox desktop was tested by loading the extension temporarily. A temporary installation is intended for testing and does not establish that the extension is ready for permanent Firefox installation or distribution.

To load it temporarily, open `about:debugging`, select **This Firefox**, choose **Load Temporary Add-on…**, and select the extension's `manifest.json` file.

## Development / tests

The extension itself loads the plain files in this folder. Bun and Node are only used for the dev tests; they are not required at runtime.

```sh
bun test          # unit + file/manifest checks
node --check popup.js
node --check src/groups.js
node --check src/export.js
node --check src/import.js
node --check src/storage.js
node --check src/open-links.js
```

<details>
<summary>Test coverage</summary>

- `test/groups.test.js` covers grouping, ordering, URL skipping, the exact two-line entry format (title, then ` -> ` + URL), blank-line separation, long URLs, control-character handling in titles, and the virtual "Ungrouped Tabs" entry.
- `test/import.test.js` covers parsing the extension's own export format, the legacy numbered-URL format, bare URLs, explicit `Group:` headers, unnamed-group flows, name editing inputs, blank lines, CRLF/CR endings, a BOM, empty/duplicate groups, repeated URLs, long URLs with queries and fragments, malformed entries, unsafe schemes, and the entry cap.
- `test/storage.test.js` covers the saved-group model, conflict detection, merge/rename/cancel policies, duplicate names, and local storage round-trips, malformed data and quota/IO failures.
- `test/export.test.js` covers filename sanitization, date stamps, TXT export content, and that preview, clipboard, and export text are identical.
- `test/extension-files.test.js` checks the manifest, permissions, local file references, virtual group exports from `src/groups.js`, that the runtime sources contain no remote URLs, and crucially that the import and storage modules never touch `tabs` — only `src/open-links.js` can create tabs, and only from explicit user actions.

</details>

## Known limitations

- The popup only shows the window it was opened in; there is no all-windows view.
- Groups with no tabs have no tab-strip position, so they are listed last (before the virtual "Ungrouped Tabs" entry).
- Very restricted pages may expose no URL at all; those tabs are skipped.
- Copying relies on the popup staying open until the clipboard write resolves (normally immediate). The fallback requires the popup to be focused.
- The browser initiates the TXT download via a standard download link; the extension does not receive a completion event, so it reports that the download has started, not that the file was saved. Browser settings or policies may still block or ask where to save the download.
- **Opera:** Tab Islands are not fully supported. In testing, island tabs were not consistently represented as named/color-coded groups; some appeared as ungrouped tabs with an unreliable generated color label.
- **Vivaldi desktop:** In testing, after deleting a saved group, the extension popup may stop reopening until another extension is clicked. This issue has not yet been diagnosed or fixed.
- **Vivaldi mobile and other mobile browsers are not currently targeted or supported.**
- **Firefox:** Only temporary desktop loading has been tested; permanent installation and distribution have not been verified.
- No automated browser UI test is included; popup logic is verified by unit tests and code review, not by driving every supported browser.
- Imported text is pasted by the user directly into the Import text area (Ctrl+V or the context menu); the extension never reads the clipboard.

## License

Copyright (C) 2026 Mohammad Reza Asadi

This project is licensed under the **GNU General Public License v3.0 only (GPL-3.0-only)**.

You are free to use, study, modify, and redistribute this software under the terms of the license. If you distribute this software or modified versions of it, you must comply with the applicable requirements of the GPL-3.0 license.

See the [LICENSE](LICENSE) file for the full license text.
