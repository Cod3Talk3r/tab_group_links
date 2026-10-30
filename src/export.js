/**
 * Pure helpers for building the TXT export.
 *
 * Like `groups.js`, this module has no dependency on the `chrome.*` APIs or
 * the DOM so it can be unit tested outside the browser. The popup uses
 * `buildTxtExport()` and turns the result into a Blob download.
 */

import {
  formatNumberedUrlList,
  getExplicitGroupName,
  getGroupDisplayName,
} from "./groups.js";

/**
 * `formatNumberedUrlList` is re-exported for callers that still format raw
 * URL arrays themselves. Group entries normally use their own
 * `formattedText` (title + URL) instead.
 */
export { formatNumberedUrlList };

/**
 * The name a group is stored under in Saved Links.
 *
 * Mirrors the extension's existing naming convention (see `groups.js`): an
 * explicitly set browser-group title wins; otherwise the same display name
 * the group list already shows is used (`"Untitled group (blue)"`,
 * `"Ungrouped Tabs"`, ...) so no misleading name is invented.
 *
 * @param {{ title?: unknown, color?: unknown } | null | undefined} group
 * @returns {string}
 */
export function savedGroupNameFor(group) {
  return getExplicitGroupName(group) ?? getGroupDisplayName(group);
}

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_FILENAME_PART_LENGTH = 50;

/**
 * Make a group name safe to use inside a downloaded file name.
 *
 * Invalid path characters, control characters and Windows-reserved device
 * names are handled. Whitespace runs become single hyphens, leading and
 * trailing dots/hyphens are removed, and long names are truncated.
 *
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string} sanitized name, possibly an empty string
 */
export function sanitizeFilenamePart(value, maxLength = MAX_FILENAME_PART_LENGTH) {
  const source = typeof value === "string" ? value : "";
  let part = source
    .replace(INVALID_FILENAME_CHARS, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-\s]+|[.\-\s]+$/g, "");

  const limit =
    typeof maxLength === "number" && Number.isFinite(maxLength) && maxLength > 0
      ? Math.floor(maxLength)
      : MAX_FILENAME_PART_LENGTH;

  if (part.length > limit) {
    part = part.slice(0, limit).replace(/[.\-\s]+$/g, "");
  }

  // Check after truncation too, so a truncated name cannot end up reserved.
  if (WINDOWS_RESERVED_NAME.test(part)) {
    part = `${part}-group`;
  }

  return part;
}

/**
 * Format a date as YYYY-MM-DD using local time.
 * @param {Date} [date]
 * @returns {string}
 */
export function formatDateStamp(date = new Date()) {
  const value =
    date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Build a descriptive TXT filename, e.g. `tab-group-Work-2026-10-29.txt`.
 * @param {unknown} groupName
 * @param {Date} [date]
 * @returns {string}
 */
export function buildTxtFilename(groupName, date = new Date()) {
  const safeName = sanitizeFilenamePart(groupName) || "untitled";
  return `tab-group-${safeName}-${formatDateStamp(date)}.txt`;
}

/**
 * Build the filename and content for a group's TXT export.
 *
 * The content is the pre-formatted text (numbered title + indented URL blocks
 * separated by one blank line), which is the same string shown in the preview
 * and written to the clipboard. It is passed through unchanged.
 *
 * @param {unknown} groupName
 * @param {string} content  pre-formatted text block (title + URL numbered lines)
 * @param {Date} [date]
 * @returns {{ filename: string, content: string }}
 */
export function buildTxtExport(groupName, content, date = new Date()) {
  return {
    filename: buildTxtFilename(groupName, date),
    content,
  };
}