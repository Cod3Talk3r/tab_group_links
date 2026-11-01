/**
 * The ONLY place in the extension that turns stored links into browser tabs.
 *
 * Every function here must be called from an explicit user action (an
 * "Open" button in the popup). Importing (src/import.js, src/storage.js)
 * never imports or calls this module, so importing cannot load websites.
 *
 * Opened pages load like any normal tab — that is the point of an explicit
 * open action — but the user has asked for it.
 *
 * Tab grouping:
 *   - Grouping only ever touches tabs created by the current operation; it
 *     never modifies existing tabs or existing native tab groups.
 *   - Each call that creates a group always creates a NEW native group
 *     (chrome.tabs.group() with a fresh tab list), even when another group
 *     with the same title already exists. Existing groups are never reused
 *     or modified.
 *   - Browsers without the Tab Groups API fall back to plain background
 *     opening, preserving the pre-grouping behaviour.
 *   - Firefox 139+ exposes `tabs.group()` and `tabGroups.update()`, so the
 *     same feature-detection path supports it; older Firefox falls back.
 */

/**
 * Return the `chrome.tabs` API, or null when unavailable.
 * @returns {{ create: Function, group?: Function } | null}
 */
export function tabsApi() {
  return globalThis.browser?.tabs ?? globalThis.chrome?.tabs ?? null;
}

/**
 * Return the `chrome.tabGroups` API, or null when unavailable.
 * @returns {{ update: Function } | null}
 */
export function tabGroupsApi() {
  return globalThis.browser?.tabGroups ?? globalThis.chrome?.tabGroups ?? null;
}

/**
 * Whether the browser exposes the Tab Groups API needed to group tabs
 * (`chrome.tabs.group`) and name the group (`chrome.tabGroups.update`).
 *
 * This is intentionally a capability check, not a browser sniff: any
 * environment that exposes both functions is treated as supported, and any
 * that does not (e.g. Firefox) falls back to ungrouped opening.
 *
 * @returns {boolean}
 */
export function supportsTabGroups() {
  const tabs = tabsApi();
  const tabGroups = tabGroupsApi();
  return Boolean(
    tabs &&
      typeof tabs.group === "function" &&
      tabGroups &&
      typeof tabGroups.update === "function",
  );
}

/**
 * Open one URL as a background tab (the tab starts loading).
 * @param {string} url  a previously validated http/https URL
 * @returns {Promise<object>} the created tab
 */
export async function openLinkInBackground(url) {
  const tabs = tabsApi();
  if (!tabs || typeof tabs.create !== "function") {
    throw new Error("This browser does not expose the tabs API.");
  }
  return tabs.create({ url, active: false });
}

/**
 * Open several URLs as background tabs, in order.
 * @param {string[]} urls
 * @returns {Promise<number>} how many tabs were opened
 */
export async function openLinksInBackground(urls) {
  const list = Array.isArray(urls) ? urls : [];
  let opened = 0;
  for (const url of list) {
    try {
      await openLinkInBackground(url);
      opened += 1;
    } catch {
      // One bad/failed tab should not stop the rest; callers report the count.
    }
  }
  return opened;
}

/**
 * Open a saved group's links as background tabs and group exactly the tabs
 * created by this operation into one new native tab group.
 *
 * - Only tabs created here are grouped; existing tabs and groups are untouched.
 * - An empty group creates no tab and no group.
 * - A failed URL does not stop the remaining URLs.
 * - If the browser lacks the Tab Groups API, links open ungrouped.
 * - If grouping fails after tabs were opened, the tabs are left intact and
 *   the failure is reported through the returned `groupError`.
 *
 * @param {{ name: string, entries: Array<{ url: string }> }} group
 * @returns {Promise<{
 *   opened: number,
 *   failed: number,
 *   groupId: number | null,
 *   grouped: boolean,
 *   groupError: string | null,
 * }>}
 */
export async function openSavedGroupInTabGroup(group) {
  const entries = Array.isArray(group?.entries) ? group.entries : [];
  const name = typeof group?.name === "string" ? group.name : "";
  if (entries.length === 0) {
    return { opened: 0, failed: 0, groupId: null, grouped: false, groupError: null };
  }

  // Open every URL in order, collecting only the tabs we actually created.
  const createdTabIds = [];
  let opened = 0;
  let failed = 0;
  for (const entry of entries) {
    const url = typeof entry?.url === "string" ? entry.url : "";
    if (!url) {
      failed += 1;
      continue;
    }
    try {
      const tab = await openLinkInBackground(url);
      if (tab && Number.isInteger(tab.id)) createdTabIds.push(tab.id);
      opened += 1;
    } catch {
      failed += 1;
    }
  }

  if (opened === 0 || createdTabIds.length === 0) {
    return { opened, failed, groupId: null, grouped: false, groupError: null };
  }

  if (!supportsTabGroups()) {
    return { opened, failed, groupId: null, grouped: false, groupError: null };
  }

  // Create a brand-new native group containing only our new tabs, then name
  // it exactly after the saved group. We never pass an existing group id, so
  // an identical name elsewhere is never reused or modified.
  try {
    const groupId = await tabsApi().group({ tabIds: createdTabIds });
    await tabGroupsApi().update(groupId, { title: name });
    return { opened, failed, groupId, grouped: true, groupError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { opened, failed, groupId: null, grouped: false, groupError: message };
  }
}

/**
 * Open several saved groups via {@link openSavedGroupInTabGroup}, one native
 * tab group per non-empty saved group, in order.
 *
 * Empty saved groups are skipped entirely (no tab, no group). The result
 * aggregates per-group results so callers can render one status line.
 *
 * @param {Array<{ name: string, entries: Array<{ url: string }> }>} groups
 * @returns {Promise<{
 *   opened: number,
 *   failed: number,
 *   groupsCreated: number,
 *   groupErrors: Array<string>,
 * }>}
 */
export async function openSavedGroupsInTabGroups(groups) {
  const list = Array.isArray(groups) ? groups : [];
  let opened = 0;
  let failed = 0;
  let groupsCreated = 0;
  const groupErrors = [];
  for (const group of list) {
    if (!Array.isArray(group?.entries) || group.entries.length === 0) continue;
    const result = await openSavedGroupInTabGroup(group);
    opened += result.opened;
    failed += result.failed;
    if (result.grouped) groupsCreated += 1;
    if (result.groupError) groupErrors.push(result.groupError);
  }
  return { opened, failed, groupsCreated, groupErrors };
}
