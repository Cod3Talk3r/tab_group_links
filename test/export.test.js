import { describe, expect, test } from "bun:test";
import {
  buildTxtExport,
  buildTxtFilename,
  formatDateStamp,
  sanitizeFilenamePart,
} from "../src/export.js";
import { buildTabGroupList } from "../src/groups.js";

const sampleDate = new Date(2026, 9, 29, 12, 0, 0);

/** One entry block: numbered title, then the URL indented by three spaces. */
function block(num, title, url) {
  return `${num}. ${title}\n   -> ${url}`;
}

/** Join entry blocks the way the extension does: one blank line between them. */
function text(...blocks) {
  return blocks.join("\n\n");
}

describe("sanitizeFilenamePart", () => {
  test("replaces invalid filename characters", () => {
    expect(sanitizeFilenamePart('a<b>c:d"e/f\\g|h?i*j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  test("converts whitespace runs and trims leading/trailing separators", () => {
    expect(sanitizeFilenamePart("  My   Work  ")).toBe("My-Work");
    expect(sanitizeFilenamePart("...hidden...")).toBe("hidden");
  });

  test("removes control characters", () => {
    expect(sanitizeFilenamePart("a\u0000b\nc\t d")).toBe("a-b-c-d");
  });

  test("handles empty and non-string names safely", () => {
    expect(sanitizeFilenamePart("")).toBe("");
    expect(sanitizeFilenamePart("   ")).toBe("");
    expect(sanitizeFilenamePart(null)).toBe("");
    expect(sanitizeFilenamePart(undefined)).toBe("");
    expect(sanitizeFilenamePart(42)).toBe("");
  });

  test("avoids Windows reserved device names", () => {
    expect(sanitizeFilenamePart("CON")).toBe("CON-group");
    expect(sanitizeFilenamePart("lpt9")).toBe("lpt9-group");
    expect(sanitizeFilenamePart("CONXYZ", 3)).toBe("CON-group");
  });

  test("limits length and trims separators left by truncation", () => {
    expect(sanitizeFilenamePart("abcdefghij", 4)).toBe("abcd");
    expect(sanitizeFilenamePart("abcd-efgh", 5)).toBe("abcd");
  });

  test("keeps Unicode letters and removes path separators", () => {
    expect(sanitizeFilenamePart("Arbeit / Privat")).toBe("Arbeit-Privat");
    expect(sanitizeFilenamePart("Über")).toBe("Über");
  });
});

describe("formatDateStamp", () => {
  test("formats local dates as YYYY-MM-DD", () => {
    expect(formatDateStamp(new Date(2026, 9, 29))).toBe("2026-10-29");
    expect(formatDateStamp(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  test("falls back to today for an invalid date", () => {
    expect(formatDateStamp(new Date("not a date"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("buildTxtFilename", () => {
  test("uses a descriptive group name and date", () => {
    expect(buildTxtFilename("Work", sampleDate)).toBe(
      "tab-group-Work-2026-10-29.txt",
    );
  });

  test("sanitizes group names for use in the filename", () => {
    expect(buildTxtFilename("My Work/Q3", sampleDate)).toBe(
      "tab-group-My-Work-Q3-2026-10-29.txt",
    );
    expect(buildTxtFilename('Bad<>:"/\\|?*Name', sampleDate)).toBe(
      "tab-group-Bad-Name-2026-10-29.txt",
    );
  });

  test("falls back to 'untitled' for empty group names", () => {
    expect(buildTxtFilename("", sampleDate)).toBe(
      "tab-group-untitled-2026-10-29.txt",
    );
    expect(buildTxtFilename(undefined, sampleDate)).toBe(
      "tab-group-untitled-2026-10-29.txt",
    );
  });
});

describe("buildTxtExport", () => {
  test("builds a TXT payload from pre-formatted content", () => {
    const content = text(
      block(1, "First page", "https://first.test/"),
      block(2, "Second page", "https://second.test/"),
    );
    const exported = buildTxtExport("Work", content, sampleDate);

    expect(exported).toEqual({
      filename: "tab-group-Work-2026-10-29.txt",
      content,
    });
  });

  test("preserves whatever content is passed in", () => {
    const content = block(1, "Only one", "https://a.test/");
    const exported = buildTxtExport("Group", content, sampleDate);

    expect(exported.content).toBe(content);
  });

  test("produces empty content when passed an empty string", () => {
    const exported = buildTxtExport("Empty", "", sampleDate);

    expect(exported.filename).toBe("tab-group-Empty-2026-10-29.txt");
    expect(exported.content).toBe("");
  });

  test("keeps long URLs complete inside the exported content", () => {
    const longUrl =
      "https://example.com/a/very/long/path/with/many/segments/and/a/query?token=abcdefghijklmnopqrstuvwxyz0123456789&page=42#section-7";
    const content = text(
      block(1, "Long page", longUrl),
      block(2, "Short page", "https://example.org/"),
    );
    const exported = buildTxtExport("Long", content, sampleDate);

    expect(exported.content).toBe(content);
    expect(exported.content).toContain(longUrl);
    expect(exported.content.split("\n")).toContain(`   -> ${longUrl}`);
  });
});

describe("preview / clipboard / TXT export parity", () => {
  function tabsForGroup() {
    return [
      {
        id: 1,
        windowId: 1,
        groupId: 7,
        index: 0,
        url: "https://example.com/a/very/long/url/that/keeps/going/and/going?q=1",
        title: "Page title",
      },
      {
        id: 2,
        windowId: 1,
        groupId: 7,
        index: 1,
        url: "https://example.com/skipped",
        title: "No URL",
      },
      {
        id: 3,
        windowId: 1,
        groupId: 7,
        index: 2,
        url: "https://example.com/another/long/url",
        title: "Another page",
      },
    ];
  }

  test("all three surfaces produce byte-identical text", () => {
    const groups = [{ id: 7, windowId: 1, title: "Work", color: "blue" }];
    const tabs = tabsForGroup();
    // Drop the URL of the middle tab so it is skipped like an inaccessible tab.
    tabs[1].url = undefined;
    tabs[1].pendingUrl = undefined;

    const [group] = buildTabGroupList(groups, tabs, 1);

    // Preview joins the per-entry blocks the same way the shared text does.
    const previewText = group.formattedLines.join("\n\n");
    // The clipboard gets `group.formattedText` verbatim.
    const clipboardText = group.formattedText;
    // The TXT export wraps that same string in a Blob.
    const { content: exportText } = buildTxtExport("Work", group.formattedText, sampleDate);

    expect(previewText).toBe(clipboardText);
    expect(clipboardText).toBe(exportText);
    expect(group.skippedCount).toBe(1);
    expect(group.formattedText).toBe(
      text(
        block(
          1,
          "Page title",
          "https://example.com/a/very/long/url/that/keeps/going/and/going?q=1",
        ),
        block(2, "Another page", "https://example.com/another/long/url"),
      ),
    );
  });

  test("formatted text uses one blank line between entries and no trailing newline", () => {
    const groups = [{ id: 7, windowId: 1, title: "Work", color: "blue" }];
    const [group] = buildTabGroupList(groups, tabsForGroup(), 1);

    expect(group.formattedText.endsWith("\n")).toBe(false);
    expect(group.formattedText).not.toContain("\n\n\n");
    expect(group.formattedText.split("\n\n")).toHaveLength(3);
  });
});