/**
 * Storage model for imported/saved link groups.
 *
 * Imported links are stored in `chrome.storage.local` under one key as an
 * ordered array of saved groups. They are plain extension data: nothing here
 * creates tabs, navigates pages or issues network requests, so importing can
 * never load a website. Only a later, explicit user action in the popup
 * (opening one URL) touches `chrome.tabs`, and that code lives in `popup.js`.
 *
 * Like the other `src/` modules this file avoids hard `chrome.*` calls where
 * practical: the storage API is read lazily from `globalThis.chrome` so unit
 * tests can inject a fake. Pure helpers (conflict detection, merge/rename)
 * are exported separately for tests.
 */

export const SAVED_GROUPS_KEY = "savedGroups";

/** Schema version, stored with the data so future migrations can be added. */
export const SAVED_GROUPS_VERSION = 1;

/** Upper bound of saved groups accepted by `saveSavedGroups`. */
export const MAX_SAVED_GROUPS = 500;

/** Upper bound of entries across all groups accepted by `saveSavedGroups`. */
export const MAX_SAVED_ENTRIES = 5000;

/**
 * Build a fresh saved-group id. Prefers `crypto.randomUUID` and falls back to
 * a timestamp+counter string so it also works in tests.
 * @param {{ randomUUID?: () => string }} [cryptoLike]
 * @returns {string}
 */
export function makeGroupId(cryptoLike = globalThis.crypto) {
  if (cryptoLike && typeof cryptoLike.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }
  makeGroupId.__counter = (makeGroupId.__counter ?? 0) + 1;
  return `group-${Date.now()}-${makeGroupId.__counter}`;
}

/**
 * Normalize a group name for storage/display: collapse control characters and
 * whitespace runs, trim, and clamp the length. Returns the empty string when
 * nothing usable remains.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeSavedGroupName(value) {
  const source = typeof value === "string" ? value : "";
  return source
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Case-insensitive comparison key for group names.
 * @param {unknown} name
 * @returns {string}
 */
export function nameKey(name) {
  return sanitizeSavedGroupName(name).toLowerCase();
}

/**
 * Build one saved-group record.
 * @param {string} name
 * @param {Array<{ title: string, url: string }>} entries
 * @param {string} [id]
 * @returns {{ id: string, name: string, entries: Array<{ title: string, url: string }>, savedAt: number }}
 */
export function buildSavedGroup(name, entries, id = makeGroupId()) {
  return {
    id: typeof id === "string" && id ? id : makeGroupId(),
    name: sanitizeSavedGroupName(name),
    entries: (Array.isArray(entries) ? entries : []).map((entry) => ({
      title: typeof entry?.title === "string" ? entry.title : "",
      url: typeof entry?.url === "string" ? entry.url : "",
    })),
    savedAt: Date.now(),
  };
}

/**
 * Return the saved group whose name matches `name` (case-insensitive), or null.
 * @param {Array<object>} savedGroups
 * @param {unknown} name
 * @returns {object | null}
 */
export function findSavedGroupByName(savedGroups, name) {
  const key = nameKey(name);
  if (!key) return null;
  return (
    (Array.isArray(savedGroups) ? savedGroups : []).find(
      (group) => nameKey(group?.name) === key,
    ) ?? null
  );
}

/**
 * Names of imported groups that collide with already-saved groups.
 * @param {Array<{ name: unknown }>} importedGroups
 * @param {Array<object>} savedGroups
 * @returns {string[]}  conflicting names, in import order
 */
export function findNameConflicts(importedGroups, savedGroups) {
  const conflicts = [];
  const seen = new Set();
  for (const group of Array.isArray(importedGroups) ? importedGroups : []) {
    const name = sanitizeSavedGroupName(group?.name);
    if (!name) continue;
    const key = nameKey(name);
    if (seen.has(key)) continue;
    if (findSavedGroupByName(savedGroups, name)) {
      seen.add(key);
      conflicts.push(name);
    }
  }
  return conflicts;
}

/**
 * Build a variant of `name` that does not collide with any saved group or with
 * the other imported names, e.g. "Work" -> "Work (imported)" -> "Work (imported 2)".
 * @param {unknown} name
 * @param {Array<object>} savedGroups
 * @param {Set<string>} takenKeys  keys already claimed by earlier renames
 * @returns {string}
 */
export function buildUniqueGroupName(name, savedGroups, takenKeys = new Set()) {
  const base = sanitizeSavedGroupName(name) || "Imported";
  const candidates = [base, `${base} (imported)`];
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    candidates.push(`${base} (imported ${suffix})`);
  }
  for (const candidate of candidates) {
    const key = nameKey(candidate);
    if (!findSavedGroupByName(savedGroups, candidate) && !takenKeys.has(key)) {
      takenKeys.add(key);
      return candidate;
    }
  }
  return `${base} (imported ${Date.now()})`;
}

/**
 * Add entries to a saved group without introducing duplicate URLs.
 * Mutates `group` and returns the number of added entries.
 * @param {object} group
 * @param {Array<{ title: string, url: string }>} entries
 * @returns {number}
 */
export function mergeEntriesIntoGroup(group, entries) {
  const seen = new Set((group.entries ?? []).map((entry) => entry.url));
  let added = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.url !== "string" || !entry.url || seen.has(entry.url)) {
      continue;
    }
    seen.add(entry.url);
    group.entries.push({
      title: typeof entry.title === "string" ? entry.title : "",
      url: entry.url,
    });
    added += 1;
  }
  return added;
}

/**
 * Compute the next saved-groups array for a confirmed import.
 *
 * This is the single decision point for name conflicts:
 * - `policy: "merge"`   — links are appended to the existing group (URLs are
 *   de-duplicated); the existing group keeps its name.
 * - `policy: "rename"`  — the imported group is stored under a fresh,
 *   non-colliding name ("Work (imported)").
 * - `policy: "cancel"`  — conflicting groups are skipped entirely.
 * Groups without a conflict are always imported.
 *
 * @param {Array<object>} savedGroups           current saved groups
 * @param {Array<{ name: unknown, entries: Array<{ title: string, url: string }> }>} importGroups
 * @param {{ policy: "merge" | "rename" | "cancel" }} options
 * @returns {{ groups: Array<object>, added: Array<{ name: string, id: string, importedCount: number }>, merged: Array<{ name: string, id: string, addedCount: number }>, skipped: string[] }}
 */
export function applyImportToSavedGroups(
  savedGroups,
  importGroups,
  { policy },
) {
  const groups = Array.isArray(savedGroups)
    ? savedGroups.map((group) => ({ ...group, entries: [...(group.entries ?? [])] }))
    : [];
  const added = [];
  const mergedReport = [];
  const skipped = [];
  const takenKeys = new Set();

  for (const importGroup of Array.isArray(importGroups) ? importGroups : []) {
    const name = sanitizeSavedGroupName(importGroup?.name);
    const entries = Array.isArray(importGroup?.entries) ? importGroup.entries : [];
    if (entries.length === 0) continue;

    if (!name) {
      // Defensive: callers should have collected a name in the UI first.
      skipped.push("Unnamed group (no name was provided)");
      continue;
    }

    const existing = findSavedGroupByName(groups, name);
    if (!existing) {
      const group = buildSavedGroup(name, entries);
      groups.push(group);
      added.push({ name: group.name, id: group.id, importedCount: group.entries.length });
      continue;
    }

    if (policy === "merge") {
      const addedCount = mergeEntriesIntoGroup(existing, entries);
      mergedReport.push({ name: existing.name, id: existing.id, addedCount });
      continue;
    }
    if (policy === "rename") {
      const newName = buildUniqueGroupName(name, groups, takenKeys);
      const group = buildSavedGroup(newName, entries);
      groups.push(group);
      added.push({ name: group.name, id: group.id, importedCount: group.entries.length });
      continue;
    }
    skipped.push(name);
  }

  return { groups, added, merged: mergedReport, skipped };
}

/**
 * Return the `chrome.storage.local` API, or null when unavailable.
 * @returns {{ get: Function, set: Function } | null}
 */
function storageLocal() {
  return globalThis.chrome?.storage?.local ?? null;
}

/**
 * Load saved groups from `chrome.storage.local`.
 *
 * Missing data yields `[]`. Malformed records are dropped instead of thrown
 * away wholesale, so one bad group cannot hide the rest.
 *
 * @returns {Promise<Array<object>>}
 */
export async function loadSavedGroups() {
  const storage = storageLocal();
  if (!storage) {
    throw new Error("chrome.storage.local is unavailable in this context.");
  }
  const bag = await storage.get(SAVED_GROUPS_KEY);
  const raw = bag?.[SAVED_GROUPS_KEY];
  const list = raw?.version === SAVED_GROUPS_VERSION ? raw.groups : raw;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (group) =>
      group &&
      typeof group === "object" &&
      typeof group.id === "string" &&
      typeof group.name === "string" &&
      Array.isArray(group.entries) &&
      group.entries.every(
        (entry) =>
          entry && typeof entry === "object" && typeof entry.url === "string",
      ),
  );
}

/**
 * Persist saved groups to `chrome.storage.local`.
 *
 * Storage failures (quota exceeded, corrupted storage) are re-thrown as
 * `Error`s with a readable message; callers must show them instead of
 * claiming success.
 *
 * @param {Array<object>} groups
 * @returns {Promise<void>}
 */
export async function saveSavedGroups(groups) {
  const storage = storageLocal();
  if (!storage) {
    throw new Error("chrome.storage.local is unavailable in this context.");
  }
  if (!Array.isArray(groups)) {
    throw new Error("Saved groups must be an array.");
  }
  const totalEntries = groups.reduce(
    (sum, group) => sum + (Array.isArray(group?.entries) ? group.entries.length : 0),
    0,
  );
  if (groups.length > MAX_SAVED_GROUPS || totalEntries > MAX_SAVED_ENTRIES) {
    throw new Error(
      `Storage limit reached (max ${MAX_SAVED_GROUPS} groups / ${MAX_SAVED_ENTRIES} links).`,
    );
  }
  try {
    await storage.set({ [SAVED_GROUPS_KEY]: { version: SAVED_GROUPS_VERSION, groups } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not save the imported groups: ${detail}`);
  }
}
