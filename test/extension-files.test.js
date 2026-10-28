import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));

describe("manifest.json", () => {
  test("is a Manifest V3 extension with basic metadata", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(typeof manifest.name).toBe("string");
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof manifest.description).toBe("string");
  });

  test("requests only the permissions the extension uses", () => {
    expect(manifest.permissions).toEqual(["tabGroups", "tabs", "clipboardWrite"]);
    expect(manifest.permissions).not.toContain("downloads");
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.background).toBeUndefined();
  });

  test("declares the popup and does not reference missing icons", () => {
    expect(manifest.action?.default_popup).toBe("popup.html");
    expect(existsSync(join(root, "popup.html"))).toBe(true);
    expect(manifest.icons).toBeUndefined();
    expect(manifest.action?.default_icon).toBeUndefined();
  });
});

describe("extension files", () => {
  test("popup.html only references local files that exist and has compact header", () => {
    const html = read("popup.html");
    expect(html).toContain('href="popup.css"');
    expect(html).toContain('src="popup.js"');
    expect(html).toContain('type="module"');
    expect(html).toContain('id="export-txt"');
    expect(html).toContain("Export TXT");
    expect(html).toContain('id="refresh"');
    expect(html).toContain('aria-label="Reload groups and tabs"');
    expect(existsSync(join(root, "popup.css"))).toBe(true);
    expect(existsSync(join(root, "popup.js"))).toBe(true);
    expect(html).not.toMatch(/<script[^>]+https?:/i);
    expect(html).not.toMatch(/<link[^>]+https?:/i);
    // The old subtitle "Current window" should be gone.
    expect(html).not.toContain("Current window");
  });

  test("popup.js imports its local helper modules and the virtual group helpers", () => {
    const source = read("popup.js");
    expect(source).toContain('from "./src/groups.js"');
    expect(source).toContain('from "./src/export.js"');
    expect(source).toContain("buildUngroupedEntry");
    expect(source).toContain("UNGROUPED_GROUP_ID");
    expect(source).toContain("UNGROUPED_TITLE");
    // Should use formattedLines / formattedText, not the old toNumberedUrlLines.
    expect(source).toContain("group.formattedLines");
    expect(source).toContain("group.formattedText");
    expect(source).not.toContain("toNumberedUrlLines");
    expect(existsSync(join(root, "src/groups.js"))).toBe(true);
    expect(existsSync(join(root, "src/export.js"))).toBe(true);
    expect(source).not.toMatch(/from\s+["']https?:/);
  });

  test("src/groups.js exports the ungrouped sentinel, title, and title+URL formatting helpers", () => {
    const source = read("src/groups.js");
    expect(source).toContain("export const UNGROUPED_GROUP_ID");
    expect(source).toContain("export const UNGROUPED_TITLE");
    expect(source).toContain("export function buildUngroupedEntry");
    expect(source).toContain("export function tabTitleFallback");
    expect(source).toContain("export function formatEntryLine");
    expect(source).toContain("formattedLines");
    expect(source).toContain("formattedText");
    // Must not call chrome.tabGroups APIs (as opposed to mentioning them in comments).
    const codeOnly = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("chrome.tabGroups");
  });

  test("TXT export uses a Blob object URL without the downloads API", () => {
    const source = read("popup.js");
    expect(source).toContain("new Blob(");
    expect(source).toContain("URL.createObjectURL(");
    expect(source).toContain("URL.revokeObjectURL(");
    expect(source).toContain("buildTxtExport(");
    expect(source).not.toContain("chrome.downloads");
  });

  test("every element id used by popup.js exists in popup.html", () => {
    const html = read("popup.html");
    const source = read("popup.js");
    const ids = [...source.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test("runtime sources do not use remote services", () => {
    const sources = [
      "popup.html",
      "popup.js",
      "popup.css",
      "src/groups.js",
      "src/export.js",
    ].map(read);
    for (const source of sources) {
      // Ignore JSDoc/line comments: they may mention example URLs.
      const codeOnly = source
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(codeOnly).not.toMatch(/https?:\/\//);
    }
  });
});