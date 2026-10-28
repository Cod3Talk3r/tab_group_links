# Tab Group Links

A small Manifest V3 browser extension that lists the tab groups in the current
window (plus a virtual **Ungrouped Tabs** entry), previews their numbered tab
URLs, and copies or exports every URL in a group as a numbered plain-text list,
in the original tab order.

**Primary target:** Brave. **Expected-compatible:** Chrome, Edge (both support
Manifest V3, the `chrome.tabGroups` API, and `navigator.clipboard` / Blob
downloads). Compatibility with Chrome and Edge has **not** been verified through
real-browser testing.

No external dependencies, no remote services, no icons.

## How it works

1. The toolbar popup asks for the current window.
2. It reads the window's tab groups (`chrome.tabGroups`) and tabs
   (`chrome.tabs`).
3. Real groups appear first, ordered by the position of their first tab in the
   tab strip. Tabs inside a group keep their original tab order.
4. A virtual **Ungrouped Tabs** entry follows the real groups. It contains
   every tab whose `groupId` is `-1` (the Chromium sentinel for ungrouped
   tabs), sorted by `tab.index`. This entry is purely a UI convenience; it
   never calls `chrome.tabGroups` or modifies the browser's actual tab groups.
5. Selecting a real or virtual group shows a preview of its tab titles and
   numbered URLs.
6. **Copy URLs** writes the numbered list to the clipboard. It uses
   `navigator.clipboard.writeText()` and falls back to a hidden `<textarea>`
   plus `document.execCommand("copy")` if the async clipboard API is
   unavailable or rejected.
7. **Export TXT** downloads the same numbered list as a `.txt` file using a
   `Blob` and a temporary object URL, so no extra permission or third-party
   code is needed.
8. Success and error feedback is shown in a live status region.

Both outputs use exactly the same format:

```text
1. https://example.com/page1
2. https://example.com/page2
3. https://example.com/page3
```

Numbering starts at 1 for each group (real or virtual) and counts only URLs
that are actually included. The preview shows the same numbered lines before
you copy or export.

The export filename is descriptive and date-stamped, e.g.
`tab-group-Work-2026-10-29.txt` or `tab-group-Ungrouped-Tabs-2026-10-29.txt`.
The group name is sanitized (invalid path characters, control characters,
Windows-reserved device names, leading/trailing separators, and excessive
length); an empty name becomes `untitled`.

The popup header is compact: a single row with the extension title and a
Refresh icon button.

Edge cases:

- A window with no tab groups and no ungrouped tabs shows an empty state.
- A window with no real groups but ungrouped tabs still shows the virtual
  "Ungrouped Tabs" entry.
- A group with no tabs still appears, with copying and exporting disabled.
- Tabs without an accessible URL (neither `url` nor `pendingUrl`) are skipped,
  counted, and called out in the preview and in the copy/export success message.
- Clipboard failures show an error instead of pretending to succeed.
- Export errors are reported if the Blob download cannot be initiated.

## Permissions

| Permission       | Why                                                         |
| ---------------- | ----------------------------------------------------------- |
| `tabGroups`      | Read tab group titles, colors, and membership.              |
| `tabs`           | Read tab URLs (Chrome/Brave hide URLs without it).           |
| `clipboardWrite` | Write the URL list to the clipboard (including the fallback). |

TXT export uses an `<a download>` link with a Blob object URL, which needs no
additional permission. In particular, the extension does **not** request the
`downloads` permission. The virtual "Ungrouped Tabs" feature needs no extra
permissions because it only reads tabs that are already returned by
`chrome.tabs.query()`.

No host permissions, no content scripts, no background worker, no storage.

## Install in Brave (developer mode)

1. Open `brave://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this project folder
   (`/mnt/g/Cources/JScript/brave-tab-group-links`).
5. Pin **Tab Group Links** from the extensions (puzzle piece) menu.
6. Open the popup on a window that has tab groups.

After editing files, press the reload button on the extension card in
`brave://extensions` and reopen the popup.

## Development / tests

The extension itself loads the plain files in this folder. Bun and Node are
only used for the dev tests; they are not required at runtime.

```sh
bun test          # unit + file/manifest checks
node --check popup.js
node --check src/groups.js
node --check src/export.js
```

- `test/groups.test.js` covers grouping, ordering, URL skipping, numbered
  output, and the virtual "Ungrouped Tabs" entry.
- `test/export.test.js` covers filename sanitization, date stamps, and TXT
  export content.
- `test/extension-files.test.js` checks the manifest, permissions, local file
  references, virtual group exports from `src/groups.js`, and that the runtime
  sources contain no remote URLs.

## Known limitations

- The popup only shows the window it was opened in; there is no all-windows view.
- Groups with no tabs have no tab-strip position, so they are listed last
  (before the virtual "Ungrouped Tabs" entry).
- Very restricted pages may expose no URL at all; those tabs are skipped.
- Copying relies on the popup staying open until the clipboard write resolves
  (normally immediate). The fallback requires the popup to be focused.
- The browser initiates the TXT download via a standard download link; the
  extension does not receive a completion event, so it reports that the download
  has started, not that the file was saved. Browser settings or policies may
  still block or ask where to save the download.
- Compatibility with Chrome and Edge is expected but has not been verified
  through actual testing. Only Brave has been used as the primary target.
- No automated browser UI test is included; popup logic is verified by reading
  and reviewing `popup.js`, not by driving Brave.