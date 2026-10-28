import { describe, expect, test } from "bun:test";
import {
  buildTxtExport,
  buildTxtFilename,
  formatDateStamp,
  sanitizeFilenamePart,
} from "../src/export.js";

const sampleDate = new Date(2026, 9, 29, 12, 0, 0);

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
    const content =
      "1. First page -> https://first.test/\n2. Second page -> https://second.test/";
    const exported = buildTxtExport("Work", content, sampleDate);

    expect(exported).toEqual({
      filename: "tab-group-Work-2026-10-29.txt",
      content,
    });
  });

  test("preserves whatever content is passed in", () => {
    const content = "1. Only one -> https://a.test/";
    const exported = buildTxtExport("Group", content, sampleDate);

    expect(exported.content).toBe(content);
  });

  test("produces empty content when passed an empty string", () => {
    const exported = buildTxtExport("Empty", "", sampleDate);

    expect(exported.filename).toBe("tab-group-Empty-2026-10-29.txt");
    expect(exported.content).toBe("");
  });
});