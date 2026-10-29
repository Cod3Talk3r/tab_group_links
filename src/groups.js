/**
 * Pure data helpers for the Tab Group Links extension.
 *
 * This module does not depend on the `chrome.*` APIs, so it can be unit
 * tested outside the browser. Inputs are plain objects shaped like the
 * results of `chrome.tabGroups.query()` and `chrome.tabs.query()`.
 */

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Sentinel group ID used to represent ungrouped tabs as a virtual group.
 * Chromium uses `-1` as the `tab.groupId` for tabs that are not in a group;
 * we reuse the same constant so callers never invent group IDs.
 */
export const UNGROUPED_GROUP_ID = -1;

/**
 * Title of the virtual "Ungrouped Tabs" entry.
 */
export const UNGROUPED_TITLE = "Ungrouped Tabs";

/**
 * Trim a URL string and reject values without a URL scheme.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeUrl(value) {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || !SCHEME_PATTERN.test(url)) return null;
  return url;
}

/**
 * Return the best available URL for a tab.
 *
 * `url` is normally present because the extension holds the `tabs`
 * permission. Tabs that are still loading may only expose `pendingUrl`,
 * and a few restricted tabs expose neither, in which case the tab is
 * treated as having an inaccessible URL.
 *
 * @param {{ url?: unknown, pendingUrl?: unknown } | null | undefined} tab
 * @returns {string | null}
 */
export function getTabUrl(tab) {
  if (!tab) return null;
  return normalizeUrl(tab.url) ?? normalizeUrl(tab.pendingUrl);
}

/**
 * Human readable name for a tab group.
 * @param {{ title?: unknown, color?: unknown } | null | undefined} group
 * @returns {string}
 */
export function getGroupDisplayName(group) {
  const title = typeof group?.title === "string" ? group.title.trim() : "";
  if (title) return title;
  const color = typeof group?.color === "string" ? group.color.trim() : "";
  return color ? `Untitled group (${color})` : "Untitled group";
}

/**
 * The group's explicitly set title, or null when the group has no real name.
 *
 * This is what either Copy/Export and the import parser use when a group has
 * an actual name. Synthetic display names such as "Untitled group (blue)"
 * and the virtual "Ungrouped Tabs" entry return null, so no header is
 * invented for them.
 *
 * @param {{ title?: unknown } | null | undefined} group
 * @returns {string | null}
 */
export function getExplicitGroupName(group) {
  const title = typeof group?.title === "string" ? group.title.trim() : "";
  return title ? title : null;
}

/**
 * The `Group name: <name>` header line used by Copy, Export, the preview
 * and the import parser (see `parseImportText` in `src/import.js`).
 * @param {unknown} groupName
 * @returns {string}
 */
export function formatGroupHeaderLine(groupName) {
  return `Group name: ${typeof groupName === "string" ? groupName : ""}`;
}

/**
 * Prepend `Group name: <name>` to joinable entry blocks.
 *
 * Callers join the returned array with `"\n\n"` (the same separator used
 * between entry blocks), which yields the header, exactly one blank line,
 * then the first block — so pasting the result back through the importer
 * restores the same named group. A group without a name returns the blocks
 * unchanged.
 *
 * @param {Array<string>} entryBlocks  2-line blocks (number+title, then URL)
 * @param {unknown} groupName
 * @returns {string[]}  header line + blocks, or just the blocks
 */
export function groupWithHeader(entryBlocks, groupName) {
  const blocks = Array.isArray(entryBlocks) ? entryBlocks : [];
  const name = typeof groupName === "string" ? groupName.trim() : "";
  return name && blocks.length > 0 ? [formatGroupHeaderLine(name), ...blocks] : blocks;
}

/**
 * Prepare a tab title for single-line display.
 *
 * Control characters (newlines, tabs, carriage returns, etc.) are replaced
 * with a space so that one tab always maps to exactly one output line. If
 * the title is empty after trimming, the URL is used as a fallback.
 *
 * @param {unknown} title
 * @param {string} url  the tab's URL (already validated), used as fallback
 * @returns {string}
 */
export function tabTitleFallback(title, url) {
  const raw = typeof title === "string" ? title : "";
  const clean = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\n\r\t]+/g, " ")
    .trim();
  return clean || url;
}

/**
 * Prefix placed in front of the URL line of an entry: three spaces, then `-> `.
 */
export const URL_LINE_PREFIX = "   -> ";

/**
 * Build one numbered output block for a tab entry.
 *
 * The block spans two lines: the number and title on the first line, the URL
 * on the second line indented with `URL_LINE_PREFIX`. The URL is never
 * truncated or rewritten, so long URLs stay complete on their own line.
 *
 * Blocks are separated by one blank line once they are joined into the full
 * text (see `buildGroupEntry`).
 *
 * @param {number} num   1-based position
 * @param {string} title already-sanitised single-line title
 * @param {string} url
 * @returns {string}  e.g. "1. Example page\n   -> https://example.com"
 */
export function formatEntryLine(num, title, url) {
  return `${num}. ${title}\n${URL_LINE_PREFIX}${url}`;
}

/**
 * Build a group entry object from a list of tabs.
 * This is the common codepath shared by real groups and the virtual one.
 *
 * @param {number} id
 * @param {string} title
 * @param {string | null} color
 * @param {boolean} hasMetadata
 * @param {Array<object>} groupTabs  pre-sorted tabs belonging to this group
 * @returns {{
 *   id: number,
 *   title: string,
 *   color: string | null,
 *   collapsed: boolean,
 *   tabCount: number,
 *   firstIndex: number,
 *   entries: Array<{ url: string, title: string, index: number, tabId: number | null }>,
 *   urls: string[],
 *   formattedLines: string[],
 *   formattedText: string,
 *   skippedCount: number,
 *   hasMetadata: boolean,
 *   hasTitle: boolean
 * }}
 */
function buildGroupEntry(id, title, color, hasMetadata, hasTitle, groupTabs) {
  /** @type {Array<{ url: string, title: string, index: number, tabId: number | null }>} */
  const entries = [];
  let skippedCount = 0;

  for (const tab of groupTabs) {
    const url = getTabUrl(tab);
    if (!url) {
      skippedCount += 1;
      continue;
    }
    entries.push({
      url,
      title: tabTitleFallback(tab.title, url),
      index: typeof tab.index === "number" ? tab.index : 0,
      tabId: typeof tab.id === "number" ? tab.id : null,
    });
  }

  // Each element is a two-line block (number+title, then the URL). Blocks are
  // joined with a blank line so long URLs never crowd the next entry.
  const formattedLines = entries.map((entry, idx) =>
    formatEntryLine(idx + 1, entry.title, entry.url),
  );

  return {
    id,
    title,
    color,
    collapsed: false,
    tabCount: groupTabs.length,
    firstIndex: groupTabs.length
      ? Math.min(...groupTabs.map((tab) => (typeof tab.index === "number" ? tab.index : 0)))
      : Number.POSITIVE_INFINITY,
    entries,
    urls: entries.map((entry) => entry.url),
    formattedLines,
    formattedText: formattedLines.length > 0
      ? groupWithHeader(formattedLines, hasTitle ? title : null).join("\n\n")
      : "",
    skippedCount,
    hasMetadata,
    hasTitle: Boolean(hasTitle),
  };
}

/**
 * Build the ordered list of **real** tab groups for one window.
 *
 * Real groups are those whose `tab.groupId` is non-negative (Chromium uses
 * -1 for ungrouped tabs; those are handled separately by
 * `buildUngroupedEntry()`).
 *
 * Groups are ordered by the position of their first tab in the tab strip.
 * Tabs inside a group keep their original tab order (`tab.index`).
 * Groups that exist but currently contain no tabs are included so the UI
 * can show them as empty instead of silently hiding them.
 *
 * @param {Array<object> | null | undefined} tabGroups – `chrome.tabGroups.query()` result
 * @param {Array<object> | null | undefined} tabs       – `chrome.tabs.query()` result
 * @param {number | null | undefined} windowId
 * @returns {Array<{
 *   id: number,
 *   title: string,
 *   color: string | null,
 *   collapsed: boolean,
 *   tabCount: number,
 *   firstIndex: number,
 *   entries: Array<{ url: string, title: string, index: number, tabId: number | null }>,
 *   urls: string[],
 *   formattedLines: string[],
 *   formattedText: string,
 *   skippedCount: number,
 *   hasMetadata: boolean
 * }>}
 */
export function buildTabGroupList(tabGroups, tabs, windowId) {
  const limitToWindow = typeof windowId === "number" && Number.isFinite(windowId);

  /** @type {Map<number, object>} */
  const metadataById = new Map();
  for (const group of Array.isArray(tabGroups) ? tabGroups : []) {
    if (!group || typeof group.id !== "number" || !Number.isFinite(group.id)) continue;
    if (limitToWindow && typeof group.windowId === "number" && group.windowId !== windowId) continue;
    metadataById.set(group.id, group);
  }

  /** @type {Map<number, object[]>} */
  const tabsByGroup = new Map();
  const relevantTabs = (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => tab && typeof tab.groupId === "number" && tab.groupId >= 0)
    .filter(
      (tab) =>
        !limitToWindow ||
        typeof tab.windowId !== "number" ||
        tab.windowId === windowId,
    )
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  for (const tab of relevantTabs) {
    if (!tabsByGroup.has(tab.groupId)) tabsByGroup.set(tab.groupId, []);
    tabsByGroup.get(tab.groupId).push(tab);
  }

  // Include groups that currently have no tabs.
  for (const id of metadataById.keys()) {
    if (!tabsByGroup.has(id)) tabsByGroup.set(id, []);
  }

  const result = [];
  for (const [id, groupTabs] of tabsByGroup) {
    const metadata = metadataById.get(id);
    const explicitName = getExplicitGroupName(metadata);
    const name = explicitName ?? getGroupDisplayName(metadata);
    const color = typeof metadata?.color === "string" ? metadata.color : null;
    const collapsed = metadata?.collapsed === true;
    const entry = buildGroupEntry(id, name, color, Boolean(metadata), Boolean(explicitName), groupTabs);
    entry.collapsed = collapsed;
    result.push(entry);
  }

  result.sort((a, b) => {
    if (a.firstIndex !== b.firstIndex) return a.firstIndex - b.firstIndex;
    return a.id - b.id;
  });

  return result;
}

/**
 * Build the virtual "Ungrouped Tabs" group entry.
 *
 * Only tabs whose `groupId === -1` (the Chromium sentinel for ungrouped
 * tabs) are included. Tabs are sorted by `tab.index` to preserve the
 * visible tab-strip order.
 *
 * When there are no ungrouped tabs in the window this returns `null`.
 *
 * @param {Array<object> | null | undefined} tabs
 * @param {number | null | undefined} windowId
 * @returns {object | null}  a group-entry shaped object (see `buildTabGroupList`), or null
 */
export function buildUngroupedEntry(tabs, windowId) {
  const limitToWindow = typeof windowId === "number" && Number.isFinite(windowId);

  const ungrouped = (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => tab && tab.groupId === UNGROUPED_GROUP_ID)
    .filter(
      (tab) =>
        !limitToWindow ||
        typeof tab.windowId !== "number" ||
        tab.windowId === windowId,
    )
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  if (ungrouped.length === 0) return null;

  return buildGroupEntry(UNGROUPED_GROUP_ID, UNGROUPED_TITLE, null, false, false, ungrouped);
}

/**
 * Format URLs as numbered lines ("1. <url>") in the given order.
 *
 * Kept for backward compatibility. New code should use the
 * `formattedLines` / `formattedText` properties on group entries instead,
 * which include both the tab title and URL in each line.
 *
 * @param {Array<string | null | undefined> | null | undefined} urls
 * @returns {string[]}
 */
export function toNumberedUrlLines(urls) {
  return (Array.isArray(urls) ? urls : [])
    .filter((url) => typeof url === "string" && url.length > 0)
    .map((url, index) => `${index + 1}. ${url}`);
}

/**
 * Join URLs into the clipboard/TXT payload: one numbered URL per line, no
 * trailing newline.
 *
 * Kept for backward compatibility. New code should use `group.formattedText`.
 *
 * @param {Array<string | null | undefined> | null | undefined} urls
 * @returns {string}
 */
export function formatNumberedUrlList(urls) {
  return toNumberedUrlLines(urls).join("\n");
}