import { describe, expect, test } from "bun:test";
import {
  MAX_GROUP_NAME_LENGTH,
  MAX_IMPORT_ENTRIES,
  buildImportSummary,
  countImportEntries,
  parseImportText,
  sanitizeImportName,
  validateImportUrl,
} from "../src/import.js";

/** One entry block exactly as the extension exports it. */
function block(num, title, url) {
  return `${num}. ${title}\n   -> ${url}`;
}

function text(...blocks) {
  return blocks.join("\n\n");
}

describe("validateImportUrl", () => {
  test("accepts http and https URLs and returns them trimmed and verbatim", () => {
    expect(validateImportUrl("https://example.com/")).toEqual({
      ok: true,
      url: "https://example.com/",
    });
    expect(
      validateImportUrl("  http://example.com/a?query=1&x=%20#frag  "),
    ).toEqual({
      ok: true,
      url: "http://example.com/a?query=1&x=%20#frag",
    });
  });

  test("preserves query strings, fragments and unusual-but-valid characters", () => {
    const url =
      "https://example.com/path?a=1&b=á#cáfé";
    expect(validateImportUrl(url).ok).toBe(true);
    expect(validateImportUrl(url).url).toBe(url);
  });

  test("rejects dangerous and unsupported schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html;base64,PGI+",
      "file:///etc/passwd",
      "chrome://settings",
      "ftp://example.com/",
      "vbscript:msgbox",
    ]) {
      const result = validateImportUrl(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("unsupported scheme");
    }
  });

  test("rejects malformed and schemeless values with useful reasons", () => {
    expect(validateImportUrl("example.com").ok).toBe(false);
    expect(validateImportUrl("https://").ok).toBe(false);
    expect(validateImportUrl("https://exa mple.com/").ok).toBe(false);
    expect(validateImportUrl("not a url").ok).toBe(false);
    expect(validateImportUrl("").ok).toBe(false);
    expect(validateImportUrl("   ").ok).toBe(false);
    expect(validateImportUrl(42).ok).toBe(false);
    expect(validateImportUrl(null).ok).toBe(false);
    expect(validateImportUrl(undefined).ok).toBe(false);
  });
});

describe("sanitizeImportName", () => {
  test("trims whitespace and collapses runs", () => {
    expect(sanitizeImportName("  My   Work  ")).toBe("My Work");
    expect(sanitizeImportName("\t\t")).toBe("");
  });

  test("strips control characters and line breaks", () => {
    expect(sanitizeImportName("A\nB\rC\tD\u0000E")).toBe("A B C D E");
  });

  test("limits the length", () => {
    expect(sanitizeImportName("a".repeat(500)).length).toBe(MAX_GROUP_NAME_LENGTH);
    expect(sanitizeImportName("ab", 2)).toBe("ab");
  });

  test("handles non-string input", () => {
    expect(sanitizeImportName(null)).toBe("");
    expect(sanitizeImportName(undefined)).toBe("");
    expect(sanitizeImportName(42)).toBe("");
  });
});

describe("parseImportText — the extension's own export format", () => {
  test("parses the title + indented URL format from the README example", () => {
    const input = text(
      block(1, "Python Documentation", "https://docs.python.org/3/"),
      block(2, "FastAPI", "https://fastapi.tiangolo.com/"),
    );
    const { groups, warnings } = parseImportText(input);

    expect(warnings).toEqual([]);
    expect(groups).toEqual([
      {
        name: null,
        entries: [
          { title: "Python Documentation", url: "https://docs.python.org/3/" },
          { title: "FastAPI", url: "https://fastapi.tiangolo.com/" },
        ],
      },
    ]);
  });

  test("returns name null when there is no group header (name-entry flow)", () => {
    const { groups } = parseImportText(block(1, "A", "https://a.test/"));
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBeNull();
  });

  test("tolerates `N)` numbering and missing blank lines", () => {
    const input = "1) One\n   -> https://a.test/\n2) Two\n   -> https://b.test/";
    const { groups, warnings } = parseImportText(input);
    expect(warnings).toEqual([]);
    expect(groups[0].entries.map((entry) => entry.url)).toEqual([
      "https://a.test/",
      "https://b.test/",
    ]);
  });

  test("ignores the written numbers and keeps line order", () => {
    const input = text(
      block(7, "Seven", "https://seven.test/"),
      block(2, "Two", "https://two.test/"),
    );
    const { groups } = parseImportText(input);
    expect(groups[0].entries.map((entry) => entry.title)).toEqual([
      "Seven",
      "Two",
    ]);
  });
});

describe("parseImportText — legacy numbered-URL format", () => {
  test("parses `1. https://…` lines as title=URL entries", () => {
    const { groups, warnings } = parseImportText(
      "1. https://a.test/\n2. https://b.test/",
    );
    expect(warnings).toEqual([]);
    expect(groups[0].name).toBeNull();
    expect(groups[0].entries).toEqual([
      { title: "https://a.test/", url: "https://a.test/" },
      { title: "https://b.test/", url: "https://b.test/" },
    ]);
  });

  test("does not confuse a legacy URL line followed by a normal block", () => {
    const { groups } = parseImportText(
      text(
        block(1, "Title first", "https://first.test/"),
        block(2, "https://legacy.test/", "https://legacy.test/").replace(
          "   -> ",
          "",
        ),
      ),
    );
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[0].entries[1].url).toBe("https://legacy.test/");
  });
});

describe("parseImportText — bare URL lines", () => {
  test("accepts a bare URL per line", () => {
    const { groups, warnings } = parseImportText(
      "https://a.test/one\nhttps://b.test/two?x=1#top",
    );
    expect(warnings).toEqual([]);
    expect(groups[0].entries.map((entry) => entry.url)).toEqual([
      "https://a.test/one",
      "https://b.test/two?x=1#top",
    ]);
  });
});

describe("parseImportText — explicit group headers", () => {
  test("parses multiple `Group:` sections and keeps links with the right group", () => {
    const input = [
      "Group: Programming",
      "",
      block(1, "Python Documentation", "https://docs.python.org/3/"),
      "",
      block(2, "FastAPI", "https://fastapi.tiangolo.com/"),
      "",
      "Group: Engineering",
      "",
      block(1, "COMSOL", "https://www.comsol.com/"),
    ].join("\n");

    const { groups, warnings } = parseImportText(input);

    expect(warnings).toEqual([]);
    expect(groups.map((group) => group.name)).toEqual([
      "Programming",
      "Engineering",
    ]);
    expect(groups[0].entries).toEqual([
      { title: "Python Documentation", url: "https://docs.python.org/3/" },
      { title: "FastAPI", url: "https://fastapi.tiangolo.com/" },
    ]);
    expect(groups[1].entries).toEqual([
      { title: "COMSOL", url: "https://www.comsol.com/" },
    ]);
  });

  test("matches headers case-insensitively and trims the name", () => {
    const { groups } = parseImportText(
      "group:  Work  \n   -> https://a.test/",
    );
    expect(groups[0].name).toBe("Work");
  });

  test("keeps links that appear before the first header as a separate unnamed group", () => {
    const input = [
      block(1, "Early", "https://early.test/"),
      "",
      "Group: Named",
      "",
      block(1, "Later", "https://later.test/"),
    ].join("\n");

    const { groups } = parseImportText(input);

    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBeNull();
    expect(groups[0].entries.map((entry) => entry.url)).toEqual([
      "https://early.test/",
    ]);
    expect(groups[1].name).toBe("Named");
  });

  test("warns about a header without a name and keeps parsing", () => {
    const input = ["Group:", block(1, "A", "https://a.test/")].join("\n");
    const { groups, warnings } = parseImportText(input);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("group header without a name");
    expect(groups[0].name).toBeNull();
  });
  test("warns about and drops empty explicit groups", () => {
    const input = [
      "Group: Empty",
      "",
      "Group: Full",
      "",
      block(1, "A", "https://a.test/"),
    ].join("\n");
    const { groups, warnings } = parseImportText(input);
    expect(groups.map((group) => group.name)).toEqual(["Full"]);
    expect(warnings.join("\n")).toContain('Group “Empty” has no links');
  });
});

describe("parseImportText — `Group name:` headers (copy/export round-trip)", () => {
  test("parses the `Group name:` spelling used by Copy/Export", () => {
    const input = [
      "Group name: games",
      "",
      block(1, "Game Website", "https://example.com/"),
      "",
      block(2, "Another Game Website", "https://example.org/"),
    ].join("\n");
    const { groups, warnings } = parseImportText(input);
    expect(warnings).toEqual([]);
    expect(groups).toEqual([
      {
        name: "games",
        entries: [
          { title: "Game Website", url: "https://example.com/" },
          { title: "Another Game Website", url: "https://example.org/" },
        ],
      },
    ]);
  });

  test("round-trips the exact text produced by Export (named group)", () => {
    const exported = [
      "Group name: games",
      "",
      block(1, "Game Website", "https://example.com/"),
      "",
      block(2, "Another Game Website", "https://example.org/"),
    ].join("\n");
    const { groups, warnings } = parseImportText(exported);
    expect(warnings).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("games");
    expect(groups[0].entries).toEqual([
      { title: "Game Website", url: "https://example.com/" },
      { title: "Another Game Website", url: "https://example.org/" },
    ]);
  });

  test("matches `Group name:` case-insensitively and trims the name", () => {
    const { groups } = parseImportText("GROUP NAME:  Work  \n   -> https://a.test/");
    expect(groups[0].name).toBe("Work");
  });

  test("keeps spaces and punctuation inside group names", () => {
    const { groups } = parseImportText(
      ["Group name: Work / Q3, project (urgent!)", block(1, "A", "https://a.test/")].join("\n"),
    );
    expect(groups[0].name).toBe("Work / Q3, project (urgent!)");
  });

  test("keeps multiple `Group name:` groups separate and correct", () => {
    const input = [
      "Group name: games",
      "",
      block(1, "One", "https://one.test/"),
      "",
      "Group name: Reading list",
      "",
      block(1, "Docs", "https://docs.test/"),
      "",
      block(2, "Article", "https://article.test/"),
    ].join("\n");
    const { groups, warnings } = parseImportText(input);
    expect(warnings).toEqual([]);
    expect(groups.map((group) => group.name)).toEqual(["games", "Reading list"]);
    expect(groups[0].entries.map((entry) => entry.url)).toEqual(["https://one.test/"]);
    expect(groups[1].entries.map((entry) => entry.url)).toEqual([
      "https://docs.test/",
      "https://article.test/",
    ]);
  });
});

describe("parseImportText — line endings, BOM and blank lines", () => {
  const entries = text(
    block(1, "One", "https://a.test/"),
    block(2, "Two", "https://b.test/"),
  );

  test("handles Windows CRLF line endings", () => {
    const crlf = entries.split("\n").join("\r\n") + "\r\n";
    const { groups, warnings } = parseImportText(crlf);
    expect(warnings).toEqual([]);
    expect(groups[0].entries).toHaveLength(2);
  });

  test("handles lone CR line endings", () => {
    const { groups, warnings } = parseImportText(entries.split("\n").join("\r"));
    expect(warnings).toEqual([]);
    expect(groups[0].entries).toHaveLength(2);
  });

  test("strips a leading BOM", () => {
    const { groups, warnings } = parseImportText(`\uFEFF${entries}`);
    expect(warnings).toEqual([]);
    expect(groups[0].entries).toHaveLength(2);
  });

  test("ignores extra blank lines everywhere", () => {
    const padded = `\n\n\n${entries.split("\n\n").join("\n\n\n\n")}\n\n\n`;
    const { groups, warnings } = parseImportText(padded);
    expect(warnings).toEqual([]);
    expect(groups[0].entries).toHaveLength(2);
  });

  test("handles empty input shapes", () => {
    for (const empty of ["", "   \n  \n", "\r\n\r\n", "\uFEFF", 42, null, undefined]) {
      const result = parseImportText(empty);
      expect(result.groups).toEqual([]);
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });
});

describe("parseImportText — duplicates", () => {
  test("de-duplicates repeated URLs inside one group and keeps first position", () => {
    const input = text(
      block(1, "First", "https://a.test/"),
      block(2, "Again", "https://a.test/"),
      block(3, "Other", "https://b.test/"),
    );
    const { groups, warnings } = parseImportText(input);
    expect(groups[0].entries).toEqual([
      { title: "First", url: "https://a.test/" },
      { title: "Other", url: "https://b.test/" },
    ]);
    expect(warnings).toEqual([]);
  });

  test("allows the same URL in different groups", () => {
    const input = [
      "Group: A",
      "",
      block(1, "One", "https://shared.test/"),
      "",
      "Group: B",
      "",
      block(1, "Two", "https://shared.test/"),
    ].join("\n");
    const { groups } = parseImportText(input);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.entries[0].url === "https://shared.test/")).toBe(true);
  });

  test("merges duplicate group names inside the input and warns", () => {
    const input = [
      "Group: Work",
      "",
      block(1, "One", "https://a.test/"),
      "",
      "Group: work",
      "",
      block(1, "Two", "https://b.test/"),
    ].join("\n");
    const { groups, warnings } = parseImportText(input);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Work");
    expect(groups[0].entries.map((entry) => entry.url)).toEqual([
      "https://a.test/",
      "https://b.test/",
    ]);
    expect(warnings.join("\n")).toContain('Merged duplicate group “work”');
  });
});

describe("parseImportText — malformed entries and unsafe lines", () => {
  test("warns about a title without a URL line", () => {
    const input = [block(1, "Good", "https://a.test/"), "2. Lost title", ""].join("\n");
    const { groups, warnings } = parseImportText(input);
    expect(groups[0].entries).toHaveLength(1);
    expect(warnings.join("\n")).toContain("no valid URL followed the title");
  });

  test("warns about a malformed URL after -> and keeps parsing", () => {
    const input = [
      block(1, "Good", "https://a.test/"),
      block(2, "Bad", "not-a-url"),
      block(3, "Also good", "https://b.test/"),
    ].join("\n");
    const { groups, warnings } = parseImportText(input);
    expect(groups[0].entries.map((entry) => entry.url)).toEqual([
      "https://a.test/",
      "https://b.test/",
    ]);
    expect(warnings.join("\n")).toContain("is not a valid URL");
  });

  test("reports unsupported schemes on -> lines", () => {
    const { warnings } = parseImportText(
      block(1, "XSS", "javascript:alert(document.domain)"),
    );
    expect(warnings.join("\n")).toContain("unsupported scheme “javascript:”");
  });

  test("reports unsupported schemes on bare scheme lines", () => {
    const { warnings } = parseImportText("data:text/html,hello");
    expect(warnings.join("\n")).toContain("unsupported scheme");
  });

  test("warns about unrecognised text and does not invent entries", () => {
    const { groups, warnings } = parseImportText("hello world\nGroup - Work");
    expect(groups).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  test("warns about an entry number without a title", () => {
    const { warnings } = parseImportText("1.    \n   -> https://a.test/");
    expect(warnings.join("\n")).toContain("entry number without a title");
  });

  test("a URL line without a preceding title becomes a title=URL entry", () => {
    const { groups } = parseImportText("   -> https://orphan.test/");
    expect(groups[0].entries).toEqual([
      { title: "https://orphan.test/", url: "https://orphan.test/" },
    ]);
  });
});

describe("parseImportText — titles and long URLs", () => {
  test("preserves long URLs, query parameters and fragments verbatim", () => {
    const longUrl =
      "https://example.com/a/very/long/path/with/many/segments/and/a/query?token=abcdefghijklmnopqrstuvwxyz0123456789&page=42#section-7";
    const { groups, warnings } = parseImportText(block(1, "Long page", longUrl));
    expect(warnings).toEqual([]);
    expect(groups[0].entries[0].url).toBe(longUrl);
    expect(groups[0].entries[0].url.split("\n")).toHaveLength(1);
  });

  test("keeps titles containing '->' and unicode", () => {
    const { groups } = parseImportText(block(1, "A -> B — Über", "https://a.test/"));
    expect(groups[0].entries[0].title).toBe("A -> B — Über");
  });

  test("collapses control characters inside titles", () => {
    // A real \n splits the line; tabs and other control characters collapse.
    const { groups, warnings } = parseImportText(block(1, "A\tB\u000bC", "https://a.test/"));
    expect(warnings).toEqual([]);
    expect(groups[0].entries[0].title).toBe("A B C");
  });

  test("treats a literal newline inside a title as a line break", () => {
    const { groups, warnings } = parseImportText(block(1, "A\nC", "https://a.test/"));
    expect(groups[0].entries[0].url).toBe("https://a.test/");
    expect(warnings.join("\n")).toContain("no valid URL followed the title");
    expect(warnings.join("\n")).toContain("skipped unrecognised text");
  });
});

describe("parseImportText — large inputs", () => {
  test("caps the total number of entries and warns", () => {
    const many = Array.from(
      { length: MAX_IMPORT_ENTRIES + 5 },
      (_, index) => block(index + 1, `Page ${index + 1}`, `https://page-${index}.test/`),
    );
    const { groups, warnings } = parseImportText(many.join("\n\n"));
    expect(countImportEntries(groups)).toBe(MAX_IMPORT_ENTRIES);
    expect(warnings.join("\n")).toContain(`Stopped after ${MAX_IMPORT_ENTRIES} entries`);
  });
});

describe("buildImportSummary", () => {
  test("reports success for a single new group", () => {
    expect(
      buildImportSummary({ added: [{ name: "Work", importedCount: 12 }], merged: [], skipped: [] }),
    ).toEqual({ kind: "success", text: "Imported 12 links to “Work”." });
  });

  test("uses singular link for one imported link", () => {
    expect(
      buildImportSummary({ added: [{ name: "Work", importedCount: 1 }], merged: [], skipped: [] }),
    ).toEqual({ kind: "success", text: "Imported 1 link to “Work”." });
  });

  test("reports multiple new groups without per-group noise", () => {
    expect(
      buildImportSummary({
        added: [
          { name: "Work", importedCount: 10 },
          { name: "Reading", importedCount: 5 },
        ],
        merged: [],
        skipped: [],
      }),
    ).toEqual({ kind: "success", text: "Imported 15 links across 2 groups." });
  });

  test("reports a merge into an existing group distinctly", () => {
    expect(
      buildImportSummary({ added: [], merged: [{ name: "Shop", addedCount: 3 }], skipped: [] }),
    ).toEqual({ kind: "success", text: "Added 3 new links to “Shop”." });
  });

  test("combines new groups and merges", () => {
    expect(
      buildImportSummary({
        added: [{ name: "Work", importedCount: 12 }],
        merged: [{ name: "Shop", addedCount: 3 }],
        skipped: [],
      }),
    ).toEqual({
      kind: "success",
      text: "Imported 12 links to “Work”. Added 3 new links to “Shop”.",
    });
  });

  test("never reports success for zero imported links (all duplicates)", () => {
    expect(
      buildImportSummary({ added: [], merged: [{ name: "Shop", addedCount: 0 }], skipped: [] }),
    ).toEqual({ kind: "info", text: "Nothing new to import — those links are already saved." });
  });

  test("handles empty results and empty inputs without claiming success", () => {
    expect(buildImportSummary({ added: [], merged: [], skipped: [] })).toEqual({
      kind: "info",
      text: "Nothing to import — this text has no links.",
    });
    expect(buildImportSummary(null)).toEqual({ kind: "info", text: "Nothing to import — this text has no links." });
  });

  test("surfaces empty imported groups as a non-success outcome", () => {
    expect(
      buildImportSummary({ added: [{ name: "Work", importedCount: 0 }], merged: [], skipped: [] }),
    ).toEqual({ kind: "info", text: "Imported groups were empty and nothing was saved." });
  });

  test("supports the Save-to-Saved-Links verb without changing import wording", () => {
    expect(
      buildImportSummary({ added: [{ name: "Work", importedCount: 12 }], merged: [], skipped: [] }, { newVerb: "Saved" }),
    ).toEqual({ kind: "success", text: "Saved 12 links to “Work”." });
    expect(
      buildImportSummary({ added: [], merged: [{ name: "Shop", addedCount: 0 }], skipped: [] }, { newVerb: "Saved" }),
    ).toEqual({ kind: "info", text: "No new links to add — all links are already saved." });
    // Default verb stays "Imported" for the import flow.
    expect(
      buildImportSummary({ added: [{ name: "Work", importedCount: 1 }], merged: [], skipped: [] }),
    ).toEqual({ kind: "success", text: "Imported 1 link to “Work”." });
  });
});
