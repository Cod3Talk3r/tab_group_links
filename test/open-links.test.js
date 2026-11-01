import { describe, expect, test } from "bun:test";
import {
  openLinkInBackground,
  openSavedGroupInTabGroup,
  openSavedGroupsInTabGroups,
  supportsTabGroups,
} from "../src/open-links.js";

/**
 * In-memory fake of the `chrome.tabs` + `chrome.tabGroups` surface used by the
 * opening helpers. Tracks every call so tests can assert exactly which tabs
 * were created and which groups were made (and that nothing else was touched).
 */
function fakeChrome({ failCreate = [], groupError = null, updateError = null } = {}) {
  let nextTabId = 1;
  let nextGroupId = 100;
  const calls = {
    created: [], // { url, active }
    tabIds: [], // created tab ids, in order
    group: [], // each args passed to chrome.tabs.group
    update: [], // each { groupId, title } passed to chrome.tabGroups.update
  };
  const tabs = {
    create: async (options) => {
      calls.created.push({ url: options.url, active: options.active });
      if (failCreate.includes(options.url)) {
        throw new Error(`create failed for ${options.url}`);
      }
      const tab = { id: nextTabId, url: options.url, active: options.active ?? false };
      calls.tabIds.push(tab.id);
      nextTabId += 1;
      return tab;
    },
    group: async (options) => {
      calls.group.push(options);
      if (groupError) throw new Error(groupError);
      const groupId = nextGroupId;
      nextGroupId += 1;
      return groupId;
    },
  };
  const tabGroups = {
    update: async (groupId, patch) => {
      calls.update.push({ groupId, title: patch.title });
      if (updateError) throw new Error(updateError);
    },
  };
  return { chrome: { tabs, tabGroups }, calls };
}

function withChrome(chrome, body) {
  globalThis.chrome = chrome;
  return Promise.resolve(body()).finally(() => {
    delete globalThis.chrome;
  });
}

const group = (name, urls) => ({ id: `g-${name}`, name, entries: urls.map((url) => ({ title: url, url })) });

describe("openSavedGroupInTabGroup", () => {
  test("opens every URL as an inactive background tab, in order", async () => {
    const { chrome, calls } = fakeChrome();
    await withChrome(chrome, async () => {
      const result = await openSavedGroupInTabGroup(group("Work", ["https://a.test/", "https://b.test/"]));
      expect(result.opened).toBe(2);
      expect(result.failed).toBe(0);
      expect(calls.created.map((c) => c.url)).toEqual(["https://a.test/", "https://b.test/"]);
      expect(calls.created.every((c) => c.active === false)).toBe(true);
    });
  });

  test("groups exactly the created tabs into one new native group with the saved name", async () => {
    const { chrome, calls } = fakeChrome();
    await withChrome(chrome, async () => {
      const result = await openSavedGroupInTabGroup(group("Work", ["https://a.test/", "https://b.test/"]));
      expect(result.grouped).toBe(true);
      expect(result.groupError).toBeNull();
      expect(calls.group).toEqual([{ tabIds: [1, 2] }]);
      expect(calls.update).toEqual([{ groupId: 100, title: "Work" }]);
    });
  });

  test("group title is exactly the saved group's name", async () => {
    const { chrome, calls } = fakeChrome();
    await withChrome(chrome, async () => {
      await openSavedGroupInTabGroup(group("Named  (x)  ", ["https://a.test/"]));
      expect(calls.update).toEqual([{ groupId: 100, title: "Named  (x)  " }]);
    });
  });

  test("empty saved group opens nothing and creates no group", async () => {
    const { chrome, calls } = fakeChrome();
    await withChrome(chrome, async () => {
      const result = await openSavedGroupInTabGroup(group("Empty", []));
      expect(result.opened).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.grouped).toBe(false);
      expect(calls.created).toEqual([]);
      expect(calls.group).toEqual([]);
      expect(calls.update).toEqual([]);
    });
  });

  test("a failed URL does not stop the remaining URLs", async () => {
    const { chrome, calls } = fakeChrome({ failCreate: ["https://b.test/"] });
    await withChrome(chrome, async () => {
      const result = await openSavedGroupInTabGroup(
        group("Work", ["https://a.test/", "https://b.test/", "https://c.test/"]),
      );
      expect(result.opened).toBe(2);
      expect(result.failed).toBe(1);
      // Only the two successfully created tabs are grouped.
      expect(calls.group).toEqual([{ tabIds: [1, 2] }]);
    });
  });

  test("group creation failure leaves opened tabs intact and reports the error", async () => {
    const { chrome, calls } = fakeChrome({ groupError: "group boom" });
    await withChrome(chrome, async () => {
      const result = await openSavedGroupInTabGroup(group("Work", ["https://a.test/", "https://b.test/"]));
      expect(result.opened).toBe(2);
      expect(result.grouped).toBe(false);
      expect(result.groupError).toBe("group boom");
      // Tabs were still opened; only the grouping step failed.
      expect(calls.created.length).toBe(2);
      expect(calls.group.length).toBe(1);
      expect(calls.update).toEqual([]);
    });
  });

  test("title update failure is reported as a group error but tabs remain open", async () => {
    const { chrome, calls } = fakeChrome({ updateError: "name boom" });
    await withChrome(chrome, async () => {
      const result = await openSavedGroupInTabGroup(group("Work", ["https://a.test/"]));
      expect(result.opened).toBe(1);
      expect(result.grouped).toBe(false);
      expect(result.groupError).toBe("name boom");
      expect(calls.created.length).toBe(1);
      expect(calls.group.length).toBe(1);
    });
  });

  test("existing browser groups with an identical name are never reused or modified", async () => {
    const { chrome, calls } = fakeChrome();
    await withChrome(chrome, async () => {
      // Simulate an existing group already named "Work" in the browser.
      await openSavedGroupInTabGroup(group("Work", ["https://a.test/", "https://b.test/"]));
      await openSavedGroupInTabGroup(group("Work", ["https://c.test/"]));
      // Two separate groups were created; the second never reuses the first.
      expect(calls.group).toEqual([{ tabIds: [1, 2] }, { tabIds: [3] }]);
      expect(calls.update).toEqual([
        { groupId: 100, title: "Work" },
        { groupId: 101, title: "Work" },
      ]);
    });
  });

  test("browser without the Tab Groups API falls back to ungrouped opening", async () => {
    const { chrome, calls } = fakeChrome();
    const { tabs } = chrome;
    await withChrome({ tabs }, async () => {
      expect(supportsTabGroups()).toBe(false);
      const result = await openSavedGroupInTabGroup(group("Work", ["https://a.test/", "https://b.test/"]));
      expect(result.opened).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.grouped).toBe(false);
      expect(result.groupError).toBeNull();
      // No group API call was attempted.
      expect(calls.group).toEqual([]);
      expect(calls.update).toEqual([]);
    });
  });

  test("browser with tabGroups but without tabs.group falls back to ungrouped opening", async () => {
    const { chrome, calls } = fakeChrome();
    const { tabGroups } = chrome;
    await withChrome({ tabGroups }, async () => {
      expect(supportsTabGroups()).toBe(false);
      const result = await openSavedGroupInTabGroup(group("Work", ["https://a.test/"]));
      expect(result.grouped).toBe(false);
      expect(calls.group).toEqual([]);
    });
  });

  test("no tabs outside the current operation are included in the created group", async () => {
    const { chrome, calls } = fakeChrome();
    await withChrome(chrome, async () => {
      // A pre-existing tab id 9000 exists in the browser but must never be
      // grouped; only the freshly created tab (id 1) is grouped.
      await openSavedGroupInTabGroup(group("Work", ["https://a.test/"]));
      expect(calls.group).toEqual([{ tabIds: [1] }]);
    });
  });
});

describe("openSavedGroupsInTabGroups (global Open all)", () => {
  test("creates one separate native group per non-empty saved group, in order", async () => {
    const { chrome, calls } = fakeChrome();
    await withChrome(chrome, async () => {
      const result = await openSavedGroupsInTabGroups([
        group("Alpha", ["https://a1.test/", "https://a2.test/"]),
        group("Beta", ["https://b1.test/"]),
        group("Empty", []),
      ]);
      expect(result.opened).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.groupsCreated).toBe(2);
      expect(result.groupErrors).toEqual([]);
      // Alpha's tabs in their own group, Beta's tab in its own group; the
      // empty group produced nothing.
      expect(calls.group).toEqual([{ tabIds: [1, 2] }, { tabIds: [3] }]);
      expect(calls.update).toEqual([
        { groupId: 100, title: "Alpha" },
        { groupId: 101, title: "Beta" },
      ]);
    });
  });

  test("skips empty saved groups entirely (no tab, no group)", async () => {
    const { chrome, calls } = fakeChrome();
    await withChrome(chrome, async () => {
      const result = await openSavedGroupsInTabGroups([group("Empty", []), group("Also empty", [])]);
      expect(result.opened).toBe(0);
      expect(result.groupsCreated).toBe(0);
      expect(calls.created).toEqual([]);
      expect(calls.group).toEqual([]);
    });
  });

  test("a failed URL in one group does not stop other groups or its own remaining links", async () => {
    const { chrome, calls } = fakeChrome({ failCreate: ["https://b1.test/"] });
    await withChrome(chrome, async () => {
      const result = await openSavedGroupsInTabGroups([
        group("Alpha", ["https://a1.test/", "https://a2.test/"]),
        group("Beta", ["https://b1.test/", "https://b2.test/"]),
      ]);
      expect(result.opened).toBe(3);
      expect(result.failed).toBe(1);
      expect(result.groupsCreated).toBe(2);
      expect(calls.group).toEqual([{ tabIds: [1, 2] }, { tabIds: [3] }]);
    });
  });

  test("a group that fails to create is reported without losing its opened tabs", async () => {
    const { chrome, calls } = fakeChrome({ groupError: "boom" });
    await withChrome(chrome, async () => {
      const result = await openSavedGroupsInTabGroups([
        group("Alpha", ["https://a1.test/"]),
        group("Beta", ["https://b1.test/"]),
      ]);
      expect(result.opened).toBe(2);
      expect(result.groupsCreated).toBe(0);
      expect(result.groupErrors.length).toBe(2);
      expect(calls.created.length).toBe(2);
    });
  });

  test("without the Tab Groups API all groups open ungrouped", async () => {
    const { chrome, calls } = fakeChrome();
    const { tabs } = chrome;
    await withChrome({ tabs }, async () => {
      const result = await openSavedGroupsInTabGroups([
        group("Alpha", ["https://a1.test/"]),
        group("Beta", ["https://b1.test/"]),
      ]);
      expect(result.opened).toBe(2);
      expect(result.groupsCreated).toBe(0);
      expect(result.groupErrors).toEqual([]);
      expect(calls.group).toEqual([]);
    });
  });
});

describe("openLinkInBackground", () => {
  test("throws a readable error when the tabs API is unavailable", async () => {
    delete globalThis.chrome;
    await expect(openLinkInBackground("https://a.test/")).rejects.toThrow(
      "does not expose the tabs API",
    );
  });
});
