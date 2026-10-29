/**
 * Pure parser for the Import feature.
 *
 * Like `groups.js` and `export.js`, this module has no dependency on the
 * `chrome.*` APIs or the DOM, so it can be unit tested outside the browser.
 * The popup feeds pasted or file text into `parseImportText()` and renders
 * the returned groups; nothing here creates tabs or touches the network.
 *
 * Supported input formats (see README "Importing saved links"):
 *
 * 1. The extension's own export format — numbered title on one line, the URL
 *    on the next line prefixed with `   -> `, blocks separated by blank lines.
 * 2. The legacy numbered-URL format — `1. https://example.com/` on one line.
 * 3. Bare URL lines — `https://example.com/page` alone on a line.
 * 4. Optional explicit group headers — `Group: Name` or
 *    `Group name: Name` (case-insensitive, the rest of the line is the name).
 *
 * URLs are validated and only `http:` and `https:` are accepted. Dangerous
 * schemes (`javascript:`, `data:`, `file:`, `chrome:`, …) are rejected with
 * a warning. URL text is preserved verbatim (never rewritten or re-encoded).
 */

/** Longest accepted group name (extra characters are trimmed). */
export const MAX_GROUP_NAME_LENGTH = 100;

/** Hard cap on the total number of entries parsed from one import. */
export const MAX_IMPORT_ENTRIES = 2000;

/** `Group: Name` or `Group name: Name` header. Case-insensitive, name is the rest. */
const GROUP_HEADER_PATTERN = /^group(?:\s+name)?\s*:\s*(.*)$/i;

/** `1. Title` or `1) Title` — the number itself is ignored, order is line order. */
const NUMBERED_TITLE_PATTERN = /^\s*\d+\s*[.)]\s+(.*)$/;

/** `   -> URL` (the export format's URL line; leading whitespace is tolerated). */
const URL_LINE_PATTERN = /^\s*->\s*(.*)$/;

/** A line that is just a URL, with no `N.` title and no `->` prefix. */
const BARE_URL_PATTERN = /^https?:\/\//i;

/** Schemes accepted for imported links. Everything else is rejected. */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/** Longest fragment of a bad value shown inside a warning message. */
const MAX_MESSAGE_VALUE_LENGTH = 60;

function shortenForMessage(value) {
  const text = String(value);
  return text.length > MAX_MESSAGE_VALUE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_VALUE_LENGTH)}…`
    : text;
}

/**
 * Validate one candidate URL for import.
 *
 * The URL must parse with the `URL` constructor and use an allowed scheme.
 * The returned `url` is the trimmed input verbatim — it is never rewritten,
 * re-encoded or truncated, matching the extension's export behaviour.
 *
 * @param {unknown} value
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
export function validateImportUrl(value) {
  if (typeof value !== "string") {
    return { ok: false, reason: "the value is not text" };
  }
  const candidate = value.trim();
  if (!candidate) {
    return { ok: false, reason: "the URL is empty" };
  }
  if (/\s/.test(candidate)) {
    return { ok: false, reason: `“${shortenForMessage(candidate)}” contains spaces` };
  }
  let parsed = null;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      reason: `“${shortenForMessage(candidate)}” is not a valid URL`,
    };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      reason: `unsupported scheme “${parsed.protocol.replace(/:$/, "")}:” (only http: and https: are allowed)`,
    };
  }
  return { ok: true, url: candidate };
}

/**
 * Clean up a group name or title for single-line use.
 *
 * Control characters (including line breaks and tabs) collapse to spaces,
 * whitespace runs collapse, and the result is trimmed and length-limited.
 *
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string}
 */
export function sanitizeImportName(value, maxLength = MAX_GROUP_NAME_LENGTH) {
  const source = typeof value === "string" ? value : "";
  const clean = source
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const limit =
    typeof maxLength === "number" && Number.isFinite(maxLength) && maxLength > 0
      ? Math.floor(maxLength)
      : MAX_GROUP_NAME_LENGTH;
  return clean.slice(0, limit);
}

/**
 * Parse imported text into groups of links.
 *
 * @param {unknown} raw  pasted text or the contents of a `.txt` file
 * @returns {{
 *   groups: Array<{ name: string | null, entries: Array<{ title: string, url: string }> }>,
 *   warnings: string[]
 * }}
 *   `groups[].name` is `null` when the links had no explicit group header;
 *   the UI must then ask for a name before importing. `warnings` lists every
 *   skipped line or entry with its line number, so nothing disappears silently.
 */
export function parseImportText(raw) {
  if (typeof raw !== "string") {
    return { groups: [], warnings: ["Import input was not text."] };
  }
  // Strip a byte-order mark and normalise Windows (CRLF) and old-Mac (CR)
  // line endings so the rest of the parser only ever sees "\n".
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) {
    return { groups: [], warnings: [] };
  }

  const warnings = [];
  /** @type {Array<{ name: string | null, entries: Array<{ title: string, url: string }>, seen: Set<string>, explicit: boolean }>} */
  const buckets = [];
  let current = null;
  let pendingTitle = null;
  let pendingTitleLine = 0;
  let totalEntries = 0;
  let stoppedEarly = false;

  const flushPendingTitle = () => {
    if (pendingTitle === null) return;
    // The legacy export format put the URL on the numbered line itself
    // ("1. https://example.com/"); treat such a title as a URL entry.
    const asUrl = validateImportUrl(pendingTitle);
    if (asUrl.ok) {
      appendEntry(asUrl.url, asUrl.url);
    } else {
      warnings.push(
        `Line ${pendingTitleLine}: skipped “${shortenForMessage(pendingTitle)}” — no valid URL followed the title.`,
      );
    }
    pendingTitle = null;
  };

  const appendEntry = (title, url) => {
    if (stoppedEarly) return;
    if (!current) {
      current = { name: null, entries: [], seen: new Set(), explicit: false };
      buckets.push(current);
    }
    if (current.seen.has(url)) return; // repeated URL inside one group
    current.seen.add(url);
    current.entries.push({ title, url });
    totalEntries += 1;
    if (totalEntries >= MAX_IMPORT_ENTRIES) stoppedEarly = true;
  };

  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      // Blank line: a pending title can no longer get a URL line.
      flushPendingTitle();
      continue;
    }

    const header = GROUP_HEADER_PATTERN.exec(trimmed);
    if (header) {
      flushPendingTitle();
      const name = sanitizeImportName(header[1]);
      if (!name) {
        warnings.push(`Line ${lineNumber}: ignored a group header without a name.`);
        continue;
      }
      current = { name, entries: [], seen: new Set(), explicit: true };
      buckets.push(current);
      continue;
    }

    const urlLine = URL_LINE_PATTERN.exec(line);
    if (urlLine) {
      const candidate = urlLine[1].trim();
      const check = validateImportUrl(candidate);
      if (!check.ok) {
        warnings.push(`Line ${lineNumber}: skipped entry — ${check.reason}.`);
        pendingTitle = null;
        continue;
      }
      appendEntry(pendingTitle ?? check.url, check.url);
      pendingTitle = null;
      continue;
    }

    if (BARE_URL_PATTERN.test(trimmed)) {
      const check = validateImportUrl(trimmed);
      if (!check.ok) {
        warnings.push(`Line ${lineNumber}: skipped entry — ${check.reason}.`);
        continue;
      }
      flushPendingTitle();
      appendEntry(check.url, check.url);
      continue;
    }

    const numbered = NUMBERED_TITLE_PATTERN.exec(line);
    if (numbered) {
      flushPendingTitle();
      const title = sanitizeImportName(numbered[1]);
      if (!title) {
        warnings.push(`Line ${lineNumber}: skipped an entry number without a title.`);
        continue;
      }
      pendingTitle = title;
      pendingTitleLine = lineNumber;
      continue;
    }

    flushPendingTitle();
    // A scheme-shaped single token (e.g. "javascript:alert(1)", "data:text/html…")
    // is a rejected URL, so report the real reason instead of "unrecognised".
    if (!/\s/.test(trimmed) && /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      const check = validateImportUrl(trimmed);
      warnings.push(`Line ${lineNumber}: skipped entry — ${check.reason}.`);
      continue;
    }
    warnings.push(
      `Line ${lineNumber}: skipped unrecognised text “${shortenForMessage(trimmed)}”.`,
    );
  }
  flushPendingTitle();

  if (stoppedEarly) {
    warnings.push(
      `Stopped after ${MAX_IMPORT_ENTRIES} entries; the rest of the input was ignored.`,
    );
  }

  // Merge duplicate group names inside the input (case-insensitive), keeping
  // first-seen order and per-group URL de-duplication.
  /** @type {Array<{ key: string, name: string | null, entries: Array<{ title: string, url: string }>, seen: Set<string>, explicit: boolean }>} */
  const merged = [];
  for (const bucket of buckets) {
    const key = bucket.name === null ? "\u0000anonymous" : bucket.name.toLowerCase();
    const existing = merged.find((group) => group.key === key);
    if (!existing) {
      merged.push({ key, name: bucket.name, entries: [...bucket.entries], seen: new Set(bucket.seen), explicit: bucket.explicit });
      continue;
    }
    if (bucket.name !== null) {
      warnings.push(`Merged duplicate group “${bucket.name}” from the input.`);
    }
    for (const entry of bucket.entries) {
      if (existing.seen.has(entry.url)) continue;
      existing.seen.add(entry.url);
      existing.entries.push(entry);
    }
    existing.explicit = existing.explicit || bucket.explicit;
  }

  const groups = [];
  for (const group of merged) {
    if (group.entries.length === 0) {
      if (group.explicit && group.name !== null) {
        warnings.push(`Group “${group.name}” has no links and was skipped.`);
      }
      continue;
    }
    groups.push({ name: group.name, entries: group.entries });
  }

  return { groups, warnings };
}

/**
 * Total number of parsed entries across all groups (for UI summaries).
 * @param {Array<{ entries?: unknown[] }>} groups
 * @returns {number}
 */
export function countImportEntries(groups) {
  return (Array.isArray(groups) ? groups : []).reduce(
    (sum, group) => sum + (Array.isArray(group?.entries) ? group.entries.length : 0),
    0,
  );
}
