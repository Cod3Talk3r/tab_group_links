import { describe, expect, test } from "bun:test";
import {
  buildTabGroupList,
  buildUngroupedEntry,
  formatNumberedUrlList,
  getGroupDisplayName,
  getTabUrl,
  normalizeUrl,
  toNumberedUrlLines,
  UNGROUPED_GROUP_ID,
  UNGROUPED_TITLE,
} from "../src/groups.js";

function tab(overrides = {}) {
  return {
    id: 1,
    windowId: 1,
    groupId: 10,
    index: 0,
    url: "https://example.com/",
    title: "Example",
    ...overrides,
  };
}

function ungroupedTab(overrides = {}) {
  return tab({ groupId: -1, ...overrides });
}

describe("normalizeUrl", () => {
  test("accepts normal browser URLs", () => {
    expect(normalizeUrl("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(normalizeUrl("  http://example.com/  ")).toBe("http://example.com/");
    expect(normalizeUrl("chrome://settings")).toBe("chrome://settings");
    expect(normalizeUrl("file:///tmp/page.html")).toBe("file:///tmp/page.html");
  });

  test("rejects missing, blank and schemeless values", () => {
    expect(normalizeUrl(undefined)).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl("example.com")).toBeNull();
    expect(normalizeUrl(42)).toBeNull();
  });
});

describe("getTabUrl", () => {
  test("prefers url and falls back to pendingUrl", () => {
    expect(getTabUrl({ url: "https://a.test/", pendingUrl: "https://b.test/" })).toBe(
      "https://a.test/",
    );
    expect(getTabUrl({ url: "", pendingUrl: "https://b.test/" })).toBe("https://b.test/");
  });

  test("returns null when no accessible URL exists", () => {
    expect(getTabUrl({ url: undefined })).toBeNull();
    expect(getTabUrl({})).toBeNull();
    expect(getTabUrl(null)).toBeNull();
  });
});

describe("getGroupDisplayName", () => {
  test("uses the group title when present", () => {
    expect(getGroupDisplayName({ title: " Work ", color: "blue" })).toBe("Work");
  });

  test("falls back to the color, then to a generic name", () => {
    expect(getGroupDisplayName({ title: "", color: "purple" })).toBe(
      "Untitled group (purple)",
    );
    expect(getGroupDisplayName({})).toBe("Untitled group");
    expect(getGroupDisplayName(undefined)).toBe("Untitled group");
  });
});

/* ── real groups (buildTabGroupList) ── */

describe("buildTabGroupList", () => {
  test("orders groups by their first tab and tabs by original tab order", () => {
    const groups = [
      { id: 20, windowId: 1, title: "Later", color: "red", collapsed: false },
      { id: 10, windowId: 1, title: "Earlier", color: "blue", collapsed: true },
    ];
    const tabs = [
      tab({ id: 1, groupId: 20, index: 7, url: "https://later-1.test/" }),
      tab({ id: 2, groupId: 10, index: 4, url: "https://earlier-2.test/" }),
      tab({ id: 3, groupId: 10, index: 1, url: "https://earlier-1.test/" }),
      tab({ id: 4, groupId: 20, index: 9, url: "https://later-2.test/" }),
      ungroupedTab({ id: 5, index: 0, url: "https://ungrouped.test/" }),
    ];

    const result = buildTabGroupList(groups, tabs, 1);

    expect(result.map((group) => group.title)).toEqual(["Earlier", "Later"]);
    expect(result[0].urls).toEqual([
      "https://earlier-1.test/",
      "https://earlier-2.test/",
    ]);
    expect(result[1].urls).toEqual(["https://later-1.test/", "https://later-2.test/"]);
    expect(result[0].collapsed).toBe(true);
    expect(result[0].hasMetadata).toBe(true);
  });

  test("numbered payload preserves the original tab order", () => {
    const groups = [{ id: 1, windowId: 1, title: "Work" }];
    const tabs = [
      tab({ id: 3, groupId: 1, index: 5, url: "https://third.test/" }),
      tab({ id: 1, groupId: 1, index: 1, url: "https://first.test/" }),
      tab({ id: 2, groupId: 1, index: 3, url: "https://second.test/" }),
    ];

    const [group] = buildTabGroupList(groups, tabs, 1);

    expect(formatNumberedUrlList(group.urls)).toBe(
      "1. https://first.test/\n2. https://second.test/\n3. https://third.test/",
    );
  });

  test("numbering starts at 1 for each tab group", () => {
    const groups = [
      { id: 10, windowId: 1, title: "First group" },
      { id: 20, windowId: 1, title: "Second group" },
    ];
    const tabs = [
      tab({ id: 1, groupId: 10, index: 0, url: "https://a1.test/" }),
      tab({ id: 2, groupId: 10, index: 1, url: "https://a2.test/" }),
      tab({ id: 3, groupId: 20, index: 2, url: "https://b1.test/" }),
    ];

    const [first, second] = buildTabGroupList(groups, tabs, 1);

    expect(formatNumberedUrlList(first.urls)).toBe("1. https://a1.test/\n2. https://a2.test/");
    expect(formatNumberedUrlList(second.urls)).toBe("1. https://b1.test/");
  });

  test("ignores tabs and groups from other windows", () => {
    const groups = [
      { id: 10, windowId: 1, title: "Mine", color: "green" },
      { id: 30, windowId: 2, title: "Other window", color: "pink" },
    ];
    const tabs = [
      tab({ id: 1, windowId: 1, groupId: 10, index: 0, url: "https://mine.test/" }),
      tab({ id: 2, windowId: 2, groupId: 30, index: 0, url: "https://other.test/" }),
    ];

    const result = buildTabGroupList(groups, tabs, 1);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Mine");
    expect(result[0].urls).toEqual(["https://mine.test/"]);
  });

  test("includes empty groups and reports them as empty", () => {
    const groups = [
      { id: 10, windowId: 1, title: "Empty", color: "grey" },
      { id: 11, windowId: 1, title: "Full", color: "blue" },
    ];
    const tabs = [
      tab({ id: 1, groupId: 11, index: 0, url: "https://full.test/" }),
    ];

    const result = buildTabGroupList(groups, tabs, 1);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Full");
    expect(result[1].title).toBe("Empty");
    expect(result[1].tabCount).toBe(0);
    expect(result[1].urls).toEqual([]);
    expect(result[1].skippedCount).toBe(0);
  });

  test("skips tabs whose URL is inaccessible", () => {
    const groups = [{ id: 10, windowId: 1, title: "Mixed", color: "orange" }];
    const tabs = [
      tab({ id: 1, groupId: 10, index: 0, url: "https://ok.test/" }),
      tab({ id: 2, groupId: 10, index: 1, url: undefined, pendingUrl: undefined }),
      tab({ id: 3, groupId: 10, index: 2, url: "", title: "Blank" }),
      tab({ id: 4, groupId: 10, index: 3, url: undefined, pendingUrl: "https://loading.test/" }),
    ];

    const result = buildTabGroupList(groups, tabs, 1);

    expect(result[0].urls).toEqual(["https://ok.test/", "https://loading.test/"]);
    expect(formatNumberedUrlList(result[0].urls)).toBe(
      "1. https://ok.test/\n2. https://loading.test/",
    );
    expect(result[0].tabCount).toBe(4);
    expect(result[0].skippedCount).toBe(2);
    expect(result[0].entries.map((entry) => entry.index)).toEqual([0, 3]);
  });

  test("creates a fallback entry for tabs whose group metadata is missing", () => {
    const tabs = [tab({ id: 1, groupId: 99, index: 3, url: "https://orphan.test/" })];

    const result = buildTabGroupList([], tabs, 1);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(99);
    expect(result[0].title).toBe("Untitled group");
    expect(result[0].hasMetadata).toBe(false);
  });

  test("handles null or missing API results", () => {
    expect(buildTabGroupList(null, null, 1)).toEqual([]);
    expect(buildTabGroupList(undefined, undefined, undefined)).toEqual([]);
  });
});

/* ── virtual ungrouped entry (buildUngroupedEntry) ── */

describe("buildUngroupedEntry", () => {
  test("returns null when there are no ungrouped tabs", () => {
    const tabs = [
      tab({ id: 1, groupId: 10, index: 0, url: "https://grouped.test/" }),
    ];

    expect(buildUngroupedEntry(tabs, 1)).toBeNull();
    expect(buildUngroupedEntry([], 1)).toBeNull();
    expect(buildUngroupedEntry(null, 1)).toBeNull();
  });

  test("collects only tabs whose groupId is exactly -1", () => {
    const tabs = [
      ungroupedTab({ id: 1, index: 1, url: "https://u1.test/" }),
      tab({ id: 2, groupId: 10, index: 2, url: "https://g1.test/" }),
      ungroupedTab({ id: 3, index: 3, url: "https://u2.test/" }),
      tab({ id: 4, groupId: 5, index: 4, url: "https://g2.test/" }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry).not.toBeNull();
    expect(entry.id).toBe(UNGROUPED_GROUP_ID);
    expect(entry.title).toBe(UNGROUPED_TITLE);
    expect(entry.hasMetadata).toBe(false);
    expect(entry.color).toBeNull();
    expect(entry.tabCount).toBe(2);
    expect(entry.urls).toEqual(["https://u1.test/", "https://u2.test/"]);
  });

  test("preserves tab-strip order for ungrouped tabs", () => {
    const tabs = [
      ungroupedTab({ id: 3, index: 8, url: "https://third.test/" }),
      ungroupedTab({ id: 1, index: 2, url: "https://first.test/" }),
      ungroupedTab({ id: 2, index: 5, url: "https://second.test/" }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry.urls).toEqual([
      "https://first.test/",
      "https://second.test/",
      "https://third.test/",
    ]);
  });

  test("ignores ungrouped tabs from other windows", () => {
    const tabs = [
      ungroupedTab({ id: 1, windowId: 1, index: 0, url: "https://mine.test/" }),
      ungroupedTab({ id: 2, windowId: 2, index: 1, url: "https://other.test/" }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry.tabCount).toBe(1);
    expect(entry.urls).toEqual(["https://mine.test/"]);
  });

  test("skips ungrouped tabs without accessible URLs", () => {
    const tabs = [
      ungroupedTab({ id: 1, index: 0, url: "https://ok.test/" }),
      ungroupedTab({ id: 2, index: 1, url: undefined, pendingUrl: undefined }),
      ungroupedTab({ id: 3, index: 2, url: "", title: "Blank" }),
      ungroupedTab({ id: 4, index: 3, url: undefined, pendingUrl: "https://loading.test/" }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry.tabCount).toBe(4);
    expect(entry.skippedCount).toBe(2);
    expect(entry.urls).toEqual(["https://ok.test/", "https://loading.test/"]);
    expect(formatNumberedUrlList(entry.urls)).toBe(
      "1. https://ok.test/\n2. https://loading.test/",
    );
  });

  test("returns null when all ungrouped tabs lack URLs (and tabCount is > 0)", () => {
    // tabCount reflects the actual count, urls can still be empty
    const tabs = [
      ungroupedTab({ id: 1, index: 0, url: "", pendingUrl: undefined }),
      ungroupedTab({ id: 2, index: 1, url: undefined }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry).not.toBeNull(); // group still exists, just no URLs
    expect(entry.tabCount).toBe(2);
    expect(entry.urls).toEqual([]);
    expect(entry.skippedCount).toBe(2);
  });

  test("numbered output for the virtual group starts at 1", () => {
    const tabs = [
      ungroupedTab({ id: 1, index: 1, url: "https://a.test/" }),
      ungroupedTab({ id: 2, index: 2, url: "https://b.test/" }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(formatNumberedUrlList(entry.urls)).toBe(
      "1. https://a.test/\n2. https://b.test/",
    );
  });
});

/* ── constants ── */

describe("exported constants", () => {
  test("UNGROUPED_GROUP_ID matches the Chromium sentinel", () => {
    expect(UNGROUPED_GROUP_ID).toBe(-1);
  });

  test("UNGROUPED_TITLE is the expected display name", () => {
    expect(UNGROUPED_TITLE).toBe("Ungrouped Tabs");
  });
});

/* ── numbering helpers ── */

describe("toNumberedUrlLines", () => {
  test("prefixes each URL with a sequential number starting at 1", () => {
    expect(toNumberedUrlLines(["https://a.test/", "https://b.test/"])).toEqual([
      "1. https://a.test/",
      "2. https://b.test/",
    ]);
  });

  test("numbers only included URLs when empty values are skipped", () => {
    expect(toNumberedUrlLines(["https://a.test/", "", null, "https://b.test/"])).toEqual([
      "1. https://a.test/",
      "2. https://b.test/",
    ]);
  });

  test("returns an empty array for missing input", () => {
    expect(toNumberedUrlLines(null)).toEqual([]);
    expect(toNumberedUrlLines(undefined)).toEqual([]);
  });
});

describe("formatNumberedUrlList", () => {
  test("writes one numbered URL per line with no trailing newline", () => {
    expect(
      formatNumberedUrlList(["https://a.test/", "https://b.test/", "chrome://newtab"]),
    ).toBe("1. https://a.test/\n2. https://b.test/\n3. chrome://newtab");
  });

  test("ignores empty values and returns an empty string for no URLs", () => {
    expect(formatNumberedUrlList([])).toBe("");
    expect(formatNumberedUrlList(null)).toBe("");
    expect(formatNumberedUrlList(["https://a.test/", "", null, undefined])).toBe(
      "1. https://a.test/",
    );
  });
});