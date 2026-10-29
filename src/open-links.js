/**
 * The ONLY place in the extension that turns stored links into browser tabs.
 *
 * Every function here must be called from an explicit user action (an
 * "Open" button in the popup). Importing (src/import.js, src/storage.js)
 * never imports or calls this module, so importing cannot load websites.
 *
 * Opened pages load like any normal tab — that is the point of an explicit
 * open action — but the user has asked for it.
 */

/**
 * Return the `chrome.tabs` API, or null when unavailable.
 * @returns {{ create: Function } | null}
 */
export function tabsApi() {
  return globalThis.chrome?.tabs ?? null;
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
