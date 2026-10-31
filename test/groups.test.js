import { describe, expect, test } from "bun:test";
import {
  buildTabGroupList,
  buildUngroupedEntry,
  formatEntryLine,
  formatGroupHeaderLine,
  formatNumberedUrlList,
  getExplicitGroupName,
  getGroupDisplayName,
  getTabUrl,
  groupColor,
  GROUP_COLORS,
  groupWithHeader,
  normalizeUrl,
  tabTitleFallback,
  toNumberedUrlLines,
  UNGROUPED_GROUP_ID,
  UNGROUPED_TITLE,
  URL_LINE_PREFIX,
} from "../src/groups.js";

/**
 * One entry in the exported text: the numbered title on its own line, then the
 * URL indented by exactly three spaces and `-> ` on the next line.
 *
 * The prefix is spelled out literally on purpose, so the tests pin the
 * contract instead of trusting the constant they are meant to verify.
 */
function block(num, title, url) {
  return `${num}. ${title}\n   -> ${url}`;
}

/** Join entry blocks the way the extension does: one blank line between them. */
function text(...blocks) {
  return blocks.join("\n\n");
}

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

/* ── URL helpers ── */

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

/* ── title helpers ── */

describe("tabTitleFallback", () => {
  test("strips newlines and control characters", () => {
    expect(tabTitleFallback("Line 1\nLine 2", "https://a.test/")).toBe("Line 1 Line 2");
    expect(tabTitleFallback("Tab\there\rCR", "https://a.test/")).toBe("Tab here CR");
    expect(tabTitleFallback("a\u0000b", "https://a.test/")).toBe("a b");
  });

  test("falls back to the URL when the title is empty", () => {
    expect(tabTitleFallback("", "https://a.test/")).toBe("https://a.test/");
    expect(tabTitleFallback("   ", "https://b.test/")).toBe("https://b.test/");
    expect(tabTitleFallback(null, "https://c.test/")).toBe("https://c.test/");
  });

  test("handles titles containing '->' literally", () => {
    expect(tabTitleFallback("a -> b", "https://a.test/")).toBe("a -> b");
  });
});

describe("formatEntryLine", () => {
  test("puts the numbered title on one line and the URL on the next", () => {
    expect(formatEntryLine(1, "Page title", "https://example.com/a/very/long/url")).toBe(
      "1. Page title\n   -> https://example.com/a/very/long/url",
    );
    expect(formatEntryLine(3, "Docs", "https://docs.test/")).toBe(
      "3. Docs\n   -> https://docs.test/",
    );
  });

  test("uses exactly three spaces before the arrow", () => {
    expect(URL_LINE_PREFIX).toBe("   -> ");
    const [, urlLine] = formatEntryLine(2, "Title", "https://a.test/").split("\n");
    expect(urlLine).toBe("   -> https://a.test/");
    expect(urlLine.startsWith("   -> ")).toBe(true);
    expect(urlLine.startsWith("    -> ")).toBe(false);
  });

  test("never truncates or rewrites a long URL", () => {
    const longUrl =
      "https://example.com/a/very/long/path/that/keeps/going/and/going/and/going?token=abcdefghijklmnopqrstuvwxyz0123456789&page=42#section-7";
    const line = formatEntryLine(1, "Long page", longUrl);

    expect(line).toBe(`1. Long page\n   -> ${longUrl}`);
    expect(line.split("\n")).toHaveLength(2);
    expect(line).not.toContain("…");
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
      tab({ id: 1, groupId: 20, index: 7, url: "https://later-1.test/", title: "L1" }),
      tab({ id: 2, groupId: 10, index: 4, url: "https://earlier-2.test/", title: "E2" }),
      tab({ id: 3, groupId: 10, index: 1, url: "https://earlier-1.test/", title: "E1" }),
      tab({ id: 4, groupId: 20, index: 9, url: "https://later-2.test/", title: "L2" }),
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

  test("produces title+URL entry blocks preserving tab order", () => {
    const groups = [{ id: 1, windowId: 1, title: "Work" }];
    const tabs = [
      tab({ id: 3, groupId: 1, index: 5, url: "https://third.test/", title: "Three" }),
      tab({ id: 1, groupId: 1, index: 1, url: "https://first.test/", title: "One" }),
      tab({ id: 2, groupId: 1, index: 3, url: "https://second.test/", title: "Two" }),
    ];

    const [group] = buildTabGroupList(groups, tabs, 1);

    expect(group.formattedLines).toEqual([
      block(1, "One", "https://first.test/"),
      block(2, "Two", "https://second.test/"),
      block(3, "Three", "https://third.test/"),
    ]);
    // formattedLines stay header-free; formattedText gains the group header
    // for a named group: header line, one blank line, then the entry blocks.
    expect(group.formattedText).toBe(
      `Group name: Work\n\n${text(
        block(1, "One", "https://first.test/"),
        block(2, "Two", "https://second.test/"),
        block(3, "Three", "https://third.test/"),
      )}`,
    );
    // Exactly one blank line between each part (header + entries), and no
    // trailing newline.
    expect(group.formattedText.split("\n\n")).toHaveLength(4);
    expect(group.formattedText.endsWith("\n")).toBe(false);
  });

  test("numbering starts at 1 for each tab group", () => {
    const groups = [
      { id: 10, windowId: 1, title: "First group" },
      { id: 20, windowId: 1, title: "Second group" },
    ];
    const tabs = [
      tab({ id: 1, groupId: 10, index: 0, url: "https://a1.test/", title: "A1" }),
      tab({ id: 2, groupId: 10, index: 1, url: "https://a2.test/", title: "A2" }),
      tab({ id: 3, groupId: 20, index: 2, url: "https://b1.test/", title: "B1" }),
    ];

    const [first, second] = buildTabGroupList(groups, tabs, 1);

    expect(first.formattedText).toBe(
      `Group name: First group\n\n${text(
        block(1, "A1", "https://a1.test/"),
        block(2, "A2", "https://a2.test/"),
      )}`,
    );
    expect(second.formattedText).toBe(
      `Group name: Second group\n\n${block(1, "B1", "https://b1.test/")}`,
    );
  });

  test("uses the URL as fallback when a tab has no title", () => {
    const groups = [{ id: 10, windowId: 1, title: "Work" }];
    const tabs = [
      tab({ id: 1, groupId: 10, index: 0, url: "https://a.test/", title: "Titled" }),
      tab({ id: 2, groupId: 10, index: 1, url: "https://b.test/", title: "" }),
      tab({ id: 3, groupId: 10, index: 2, url: "https://c.test/", title: undefined }),
    ];

    const [group] = buildTabGroupList(groups, tabs, 1);

    expect(group.formattedLines).toEqual([
      block(1, "Titled", "https://a.test/"),
      block(2, "https://b.test/", "https://b.test/"),
      block(3, "https://c.test/", "https://c.test/"),
    ]);
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
      tab({ id: 1, groupId: 11, index: 0, url: "https://full.test/", title: "F" }),
    ];

    const result = buildTabGroupList(groups, tabs, 1);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Full");
    expect(result[1].title).toBe("Empty");
    expect(result[1].tabCount).toBe(0);
    expect(result[1].urls).toEqual([]);
    expect(result[1].formattedLines).toEqual([]);
    expect(result[1].formattedText).toBe("");
  });

  test("skips tabs whose URL is inaccessible", () => {
    const groups = [{ id: 10, windowId: 1, title: "Mixed", color: "orange" }];
    const tabs = [
      tab({ id: 1, groupId: 10, index: 0, url: "https://ok.test/", title: "OK" }),
      tab({ id: 2, groupId: 10, index: 1, url: undefined, pendingUrl: undefined, title: "Skipped" }),
      tab({ id: 3, groupId: 10, index: 2, url: "", title: "Blank" }),
      tab({ id: 4, groupId: 10, index: 3, url: undefined, pendingUrl: "https://loading.test/", title: "Loading" }),
    ];

    const result = buildTabGroupList(groups, tabs, 1);

    expect(result[0].urls).toEqual(["https://ok.test/", "https://loading.test/"]);
    expect(result[0].tabCount).toBe(4);
    expect(result[0].skippedCount).toBe(2);
    expect(result[0].entries.map((entry) => entry.index)).toEqual([0, 3]);
    expect(result[0].formattedLines).toEqual([
      block(1, "OK", "https://ok.test/"),
      block(2, "Loading", "https://loading.test/"),
    ]);
    // Skipped tabs leave no gap: entry 1 and 2 are adjacent blocks.
    expect(result[0].formattedText).toBe(
      `Group name: Mixed\n\n${text(
        block(1, "OK", "https://ok.test/"),
        block(2, "Loading", "https://loading.test/"),
      )}`,
    );
  });

  test("keeps long URLs complete on a single logical line", () => {
    const longUrl =
      "https://example.com/a/very/long/url/with/lots/of/segments/and/a/query?token=abcdefghijklmnopqrstuvwxyz0123456789&page=42#section-7";
    const groups = [{ id: 10, windowId: 1, title: "Long" }];
    const tabs = [
      tab({ id: 1, groupId: 10, index: 0, url: longUrl, title: "Page title" }),
      tab({ id: 2, groupId: 10, index: 1, url: "https://example.com/another/long/url", title: "Another page" }),
    ];

    const [group] = buildTabGroupList(groups, tabs, 1);

    expect(group.urls).toEqual([longUrl, "https://example.com/another/long/url"]);
    expect(group.formattedText).toBe(
      `Group name: Long\n\n1. Page title\n   -> ` +
        longUrl +
        "\n\n2. Another page\n   -> https://example.com/another/long/url",
    );
    // The long URL is one line of text, not wrapped or cut.
    expect(group.formattedText.split("\n")).toContain(`   -> ${longUrl}`);
  });

  test("collapses control characters in titles so each entry stays two lines", () => {
    const groups = [{ id: 10, windowId: 1, title: "Work" }];
    const tabs = [
      tab({ id: 1, groupId: 10, index: 0, url: "https://a.test/", title: "Line\nOne\tTabbed" }),
      tab({ id: 2, groupId: 10, index: 1, url: "https://b.test/", title: "Two" }),
    ];

    const [group] = buildTabGroupList(groups, tabs, 1);

    expect(group.formattedText).toBe(
      `Group name: Work\n\n${text(
        block(1, "Line One Tabbed", "https://a.test/"),
        block(2, "Two", "https://b.test/"),
      )}`,
    );
    // header (1 line) + blank line + 2 entries x 2 lines + 1 blank line
    // between entries = 7 lines total.
    expect(group.formattedText.split("\n")).toHaveLength(7);
  });

  test("creates a fallback entry for tabs whose group metadata is missing", () => {
    const tabs = [tab({ id: 1, groupId: 99, index: 3, url: "https://orphan.test/", title: "Orphan" })];

    const result = buildTabGroupList([], tabs, 1);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(99);
    expect(result[0].title).toBe("Untitled group");
    expect(result[0].hasMetadata).toBe(false);
    expect(result[0].formattedLines).toEqual([
      block(1, "Orphan", "https://orphan.test/"),
    ]);
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
      ungroupedTab({ id: 1, index: 1, url: "https://u1.test/", title: "U1" }),
      tab({ id: 2, groupId: 10, index: 2, url: "https://g1.test/" }),
      ungroupedTab({ id: 3, index: 3, url: "https://u2.test/", title: "U2" }),
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
    expect(entry.formattedLines).toEqual([
      block(1, "U1", "https://u1.test/"),
      block(2, "U2", "https://u2.test/"),
    ]);
  });

  test("preserves tab-strip order for ungrouped tabs", () => {
    const tabs = [
      ungroupedTab({ id: 3, index: 8, url: "https://third.test/", title: "Z" }),
      ungroupedTab({ id: 1, index: 2, url: "https://first.test/", title: "A" }),
      ungroupedTab({ id: 2, index: 5, url: "https://second.test/", title: "M" }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry.urls).toEqual([
      "https://first.test/",
      "https://second.test/",
      "https://third.test/",
    ]);
    expect(entry.formattedLines).toEqual([
      block(1, "A", "https://first.test/"),
      block(2, "M", "https://second.test/"),
      block(3, "Z", "https://third.test/"),
    ]);
  });

  test("ignores ungrouped tabs from other windows", () => {
    const tabs = [
      ungroupedTab({ id: 1, windowId: 1, index: 0, url: "https://mine.test/", title: "Mine" }),
      ungroupedTab({ id: 2, windowId: 2, index: 1, url: "https://other.test/" }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry.tabCount).toBe(1);
    expect(entry.urls).toEqual(["https://mine.test/"]);
    expect(entry.formattedLines).toEqual([block(1, "Mine", "https://mine.test/")]);
  });

  test("skips ungrouped tabs without accessible URLs and numbers correctly", () => {
    const tabs = [
      ungroupedTab({ id: 1, index: 0, url: "https://ok.test/", title: "OK" }),
      ungroupedTab({ id: 2, index: 1, url: undefined, pendingUrl: undefined, title: "Skipped" }),
      ungroupedTab({ id: 3, index: 2, url: "", title: "Blank" }),
      ungroupedTab({ id: 4, index: 3, url: undefined, pendingUrl: "https://loading.test/", title: "Load" }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry.tabCount).toBe(4);
    expect(entry.skippedCount).toBe(2);
    expect(entry.urls).toEqual(["https://ok.test/", "https://loading.test/"]);
    expect(entry.formattedLines).toEqual([
      block(1, "OK", "https://ok.test/"),
      block(2, "Load", "https://loading.test/"),
    ]);
  });

  test("handles newlines in tab titles for ungrouped tabs", () => {
    const tabs = [
      ungroupedTab({ id: 1, index: 1, url: "https://a.test/", title: "Line\nOne" }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry.formattedLines).toEqual([
      block(1, "Line One", "https://a.test/"),
    ]);
  });

  test("returns real entry even when all ungrouped tabs lack URLs", () => {
    const tabs = [
      ungroupedTab({ id: 1, index: 0, url: "", pendingUrl: undefined, title: "Blank" }),
      ungroupedTab({ id: 2, index: 1, url: undefined }),
    ];

    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry).not.toBeNull();
    expect(entry.tabCount).toBe(2);
    expect(entry.urls).toEqual([]);
    expect(entry.formattedLines).toEqual([]);
    expect(entry.formattedText).toBe("");
  });
});

/* ── group-name headers in the copy/export payload ── */

describe("group-name headers in the copy/export payload", () => {
  test("header helpers produce the exact `Group name: <name>` spelling", () => {
    expect(formatGroupHeaderLine("games")).toBe("Group name: games");
    expect(formatGroupHeaderLine("Work / Q3, project (urgent!)")).toBe(
      "Group name: Work / Q3, project (urgent!)",
    );
  });

  test("groupWithHeader prepends the header; the join separator adds the blank line", () => {
    const blocks = [
      block(1, "One", "https://a.test/"),
      block(2, "Two", "https://b.test/"),
    ];
    const lines = groupWithHeader(blocks, "games");
    expect(lines[0]).toBe("Group name: games");
    expect(lines.join("\n\n")).toBe(
      "Group name: games\n\n1. One\n   -> https://a.test/\n\n2. Two\n   -> https://b.test/",
    );
  });

  test("groupWithHeader returns blocks unchanged for empty or missing names", () => {
    const blocks = [block(1, "One", "https://a.test/")];
    expect(groupWithHeader(blocks, "")).toBe(blocks);
    expect(groupWithHeader(blocks, "   ")).toBe(blocks);
    expect(groupWithHeader(blocks, null)).toBe(blocks);
    expect(groupWithHeader([], "Named")).toEqual([]);
  });

  test("getExplicitGroupName returns only real titles, not synthetic names", () => {
    expect(getExplicitGroupName({ title: "Work", color: "blue" })).toBe("Work");
    expect(getExplicitGroupName({ title: "  Work  ", color: "blue" })).toBe("Work");
    expect(getExplicitGroupName({ title: "", color: "blue" })).toBeNull();
    expect(getExplicitGroupName({})).toBeNull();
    expect(getExplicitGroupName(null)).toBeNull();
  });

  test("real group without a title exports without a header (no invented name)", () => {
    const groups = [{ id: 10, windowId: 1, title: "", color: "blue" }];
    const tabs = [tab({ id: 1, groupId: 10, index: 0, url: "https://a.test/", title: "One" })];
    const [group] = buildTabGroupList(groups, tabs, 1);

    expect(group.hasTitle).toBe(false);
    expect(group.title).toBe("Untitled group (blue)");
    expect(group.formattedText).toBe("1. One\n   -> https://a.test/");
    expect(group.formattedText).not.toContain("Group name:");
  });

  test("orphan group without metadata exports without a header", () => {
    const tabs = [tab({ id: 1, groupId: 99, index: 3, url: "https://orphan.test/", title: "Orphan" })];
    const [group] = buildTabGroupList([], tabs, 1);

    expect(group.hasMetadata).toBe(false);
    expect(group.hasTitle).toBe(false);
    expect(group.formattedText).toBe("1. Orphan\n   -> https://orphan.test/");
  });

  test("virtual Ungrouped Tabs exports without a header", () => {
    const tabs = [ungroupedTab({ id: 1, index: 0, url: "https://u.test/", title: "U" })];
    const entry = buildUngroupedEntry(tabs, 1);

    expect(entry.hasTitle).toBe(false);
    expect(entry.formattedText).toBe("1. U\n   -> https://u.test/");
    expect(entry.formattedText).not.toContain("Group name:");
  });

  test("named group with punctuation in its title keeps the name verbatim in the header", () => {
    const groups = [{ id: 10, windowId: 1, title: "Work / Q3, project (urgent!)" }];
    const tabs = [tab({ id: 1, groupId: 10, index: 0, url: "https://a.test/", title: "One" })];
    const [group] = buildTabGroupList(groups, tabs, 1);

    expect(group.formattedText).toBe(
      "Group name: Work / Q3, project (urgent!)\n\n1. One\n   -> https://a.test/",
    );
  });

  test("exported named text round-trips through the import parser", async () => {
    const groups = [{ id: 10, windowId: 1, title: "games" }];
    const tabs = [
      tab({ id: 1, groupId: 10, index: 0, url: "https://example.com/", title: "Game Website" }),
      tab({ id: 2, groupId: 10, index: 1, url: "https://example.org/", title: "Another Game Website" }),
    ];
    const [group] = buildTabGroupList(groups, tabs, 1);

    const { parseImportText } = await import("../src/import.js");
    const parsed = parseImportText(group.formattedText);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].name).toBe("games");
    expect(parsed.groups[0].entries).toEqual([
      { title: "Game Website", url: "https://example.com/" },
      { title: "Another Game Website", url: "https://example.org/" },
    ]);
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

/* ── group colours ── */

describe("GROUP_COLORS", () => {
  test("covers exactly the nine standard Chromium tab-group colours", () => {
    expect(Object.keys(GROUP_COLORS).sort()).toEqual([
      "blue",
      "cyan",
      "green",
      "grey",
      "orange",
      "pink",
      "purple",
      "red",
      "yellow",
    ]);
  });

  test("every colour resolves to a distinct non-empty CSS colour", () => {
    const values = Object.values(GROUP_COLORS);
    expect(values.every((c) => typeof c === "string" && c.startsWith("#") && c.length >= 4)).toBe(
      true,
    );
    expect(new Set(values).size).toBe(values.length);
  });

  test("grey is the fallback used when no colour is set", () => {
    expect(GROUP_COLORS.grey).toBe("#8a94a6");
  });
});

describe("groupColor", () => {
  test("maps each of the nine supported colours to its CSS value", () => {
    for (const [name, css] of Object.entries(GROUP_COLORS)) {
      expect(groupColor(name)).toBe(css);
    }
  });

  test("falls back to grey for unknown colour names", () => {
    expect(groupColor("teal")).toBe(GROUP_COLORS.grey);
    expect(groupColor("magenta")).toBe(GROUP_COLORS.grey);
    expect(groupColor("cobalt")).toBe(GROUP_COLORS.grey);
  });

  test("falls back to grey for missing, empty and non-string values", () => {
    expect(groupColor(undefined)).toBe(GROUP_COLORS.grey);
    expect(groupColor(null)).toBe(GROUP_COLORS.grey);
    expect(groupColor("")).toBe(GROUP_COLORS.grey);
    expect(groupColor(0)).toBe(GROUP_COLORS.grey);
  });
});

/* ── backward-compat numbering helpers ── */

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