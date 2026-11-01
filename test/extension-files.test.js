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
    expect(manifest.permissions).toEqual([
      "tabGroups",
      "tabs",
      "clipboardWrite",
      "storage",
    ]);
    expect(manifest.permissions).not.toContain("downloads");
    expect(manifest.permissions).not.toContain("activeTab");
    expect(manifest.permissions).not.toContain("clipboardRead");
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
    // The preview renders cards from group.entries; copy/export text is
    // still built from the shared formattedText helper, never the old
    // toNumberedUrlLines.
    expect(source).toContain("group.entries");
    expect(source).toContain("group.formattedText");
    expect(source).toContain("formatGroupHeaderLine");
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
      "src/import.js",
      "src/storage.js",
      "src/open-links.js",
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

  test("import and storage modules never touch the tabs API", () => {
    for (const file of ["src/import.js", "src/storage.js"]) {
      const codeOnly = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(codeOnly).not.toContain("chrome.tabs");
      expect(codeOnly).not.toContain("tabs.create");
      expect(codeOnly).not.toContain("openLinkInBackground");
      expect(codeOnly).not.toContain("openLinksInBackground");
      expect(codeOnly).not.toContain(".create({ url");
    }
  });

  test("import uses direct paste (no Paste button, no clipboard-read module)", () => {
    const html = read("popup.html");
    const source = read("popup.js");
    expect(html).not.toContain('id="import-paste"');
    expect(html).not.toContain(">Paste</button>");
    expect(html).toContain('id="import-file"');
    // The textarea placeholder and hint direct users to Ctrl+V or .txt.
    expect(html).toContain("Ctrl+V");
    expect(html).toContain("choose a .txt file");
    expect(source).not.toContain("readClipboardText");
    expect(source).not.toContain("clipboardErrorMessage");
  });

  test("Save to Saved Links stays available while preview is collapsed and never opens tabs", () => {
    const html = read("popup.html");
    const source = read("popup.js");
    // Button + conflict bar sit outside the collapsible <details>.
    const detailsEnd = html.indexOf("</details>");
    expect(html.indexOf('id="save-saved"')).toBeGreaterThan(detailsEnd);
    expect(html.indexOf('id="save-conflict"')).toBeGreaterThan(detailsEnd);
    // Clear, labelled conflict actions.
    expect(html).toContain("Merge into existing group");
    expect(html).toContain("Save as a separate group");
    expect(html).toContain(">Cancel</button>");
    // The save flow reuses the import pipeline on storage only.
    const saveBlock = source.match(/async function saveSelectedGroup\(\) \{[\s\S]*?\n\}/);
    expect(saveBlock).not.toBeNull();
    expect(saveBlock[0]).toContain("applyImportToSavedGroups(saved, [{ name, entries }]");
    expect(saveBlock[0]).toContain("saveSavedGroups(result.groups)");
    expect(saveBlock[0]).toContain("buildImportSummary(result, { newVerb: \"Saved\" })");
    expect(saveBlock[0]).not.toContain("tabs.create");
    expect(saveBlock[0]).not.toContain("openLinksInBackground");
    // Conflict-bar Cancel resets without parsing, importing or saving.
    const cancelBlock = source.match(/el\.saveConflictCancel\.addEventListener\("click", \(\) => \{[\s\S]*?\}\);/);
    expect(cancelBlock).not.toBeNull();
    expect(cancelBlock[0]).toContain("hideSaveConflict()");
    expect(cancelBlock[0]).toContain("Save cancelled.");
    expect(cancelBlock[0]).not.toContain("saveSelectedGroup");
    expect(cancelBlock[0]).not.toContain("confirmImport");
  });

  test("main Import row has a single button; the conflict Cancel still cancels fully", () => {
    const html = read("popup.html");
    const source = read("popup.js");
    // The main Import action row no longer has a redundant Cancel button.
    expect(html).not.toContain('id="import-cancel"');
    expect(source).not.toContain("importCancel");
    const rowStart = html.indexOf('id="import-confirm"');
    const rowEnd = html.indexOf("</div>", rowStart);
    expect(html.slice(rowStart, rowEnd)).not.toContain("Cancel");
    // Conflict-bar Cancel still cancels the whole import instead of invoking
    // the old "skip conflicts" policy path.
    const conflictBlock = source.match(/el\.importConflictCancel\.addEventListener\("click", \(\) => \{[\s\S]*?\}\);/);
    expect(conflictBlock).not.toBeNull();
    expect(conflictBlock[0]).toContain("resetImportUI()");
    expect(conflictBlock[0]).not.toContain("confirmImport");
    expect(conflictBlock[0]).not.toContain("applyImportToSavedGroups");
  });

  test("duplicate-group conflict actions wrap instead of overflowing", () => {
    const html = read("popup.html");
    const css = read("popup.css");
    // Labels stay intact and readable.
    expect(html).toContain("Merge into existing group");
    expect(html).toContain("Import as a separate group");
    expect(html).toContain("Cancel");
    // Scoped layout fix: the conflict bar wraps and uses compact padding.
    expect(css).toMatch(/\.import-conflict \.actions[\s\S]*?flex-wrap: wrap/);
    expect(css).toMatch(/\.import-conflict \.action-secondary[\s\S]*?padding: 6px 10px/);
  });

  test("the export preview uses the import-style details/summary toggle", () => {
    const html = read("popup.html");
    const source = read("popup.js");
    // Same interaction pattern as the Import panel: a native <details>.
    expect(html).toMatch(/<details[^>]*class="preview-details"/);
    expect(html).toMatch(/<summary[^>]*id="preview-heading"/);
    expect(html).not.toContain('id="preview-toggle"');
    // Collapsed by default: the <details> has no `open` attribute and the
    // body inside it must not carry `hidden` (details manages visibility).
    expect(html.match(/<details[^>]*class="preview-details"[^>]*>/)[0]).not.toContain("open");
    expect(html.match(/<div id="preview-body">/)).not.toBeNull();
    // Export actions live outside the collapsible details, after it.
    const detailsEnd = html.indexOf("</details>");
    expect(html.indexOf("id=\"copy\"")).toBeGreaterThan(detailsEnd);
    expect(html.indexOf("id=\"export-txt\"")).toBeGreaterThan(detailsEnd);
    // No manual JS toggling is needed (native checkbox behavior); remaining
    // JS just renders content into the collapsed-at-first panels.
    expect(source).not.toContain("previewToggle");
    expect(source).toContain("el.copy.addEventListener(\"click\"");
    expect(source).toContain("el.exportTxt.addEventListener(\"click\"");
  });

  test("export preview entries are bordered cards like Import Preview entries", () => {
    const html = read("popup.html");
    const source = read("popup.js");
    const css = read("popup.css");
    // Header + card list live inside the collapsible preview body.
    expect(html).toContain('id="preview-header"');
    expect(html).toContain('id="preview-list"');
    // Cards are built from group.entries with separate title and URL spans.
    expect(source).toContain('className = "preview-entry"');
    expect(source).toContain('className = "preview-entry-title"');
    expect(source).toContain('className = "preview-entry-url"');
    // Same card recipe as .import-entry (surface chip with border).
    expect(css).toContain(".preview-entry {");
    expect(css).toContain("border-radius: 6px");
    expect(css).toContain("overflow-wrap: anywhere");
    // The old text-block preview classes are gone.
    expect(css).not.toContain(".preview-item");
    expect(source).not.toContain("preview-item--header");
  });

  test("Save button is compact with an icon and keeps a full accessible name", () => {
    const html = read("popup.html");
    const css = read("popup.css");
    expect(html).toContain('aria-label="Save to Saved Links"');
    expect(html).toMatch(/<button[^>]*id="save-saved"[^>]*>[\s\S]*?<svg/);
    expect(html).toMatch(/<svg[^>]*>[\s\S]*?<\/svg>[\s\S]*?<span>Save<\/span>/);
    expect(css).toMatch(/\.save-btn[\s\S]*?display: inline-flex/);
    expect(css).toMatch(/\.save-btn[\s\S]*?gap: 5px/);
    // No long visible label left behind.
    expect(html).not.toContain(">Save to Saved Links</button>");
  });

  test("Save conflict controls are hidden until a real name conflict exists", () => {
    const html = read("popup.html");
    const source = read("popup.js");
    // Hidden by default and scoped to the preview (Save) section.
    expect(html).toMatch(/<div id="save-conflict"[^>]*hidden/);
    expect(html.indexOf('id="save-conflict"')).toBeGreaterThan(html.indexOf('<section id="preview"'));
    expect(html.indexOf('id="save-conflict"')).toBeLessThan(html.indexOf('id="import-panel"'));
    // Shown only inside the conflict check; every re-render hides it again.
    expect(source).toMatch(/if \(conflicts\.length > 0 && !saveState\.policy\) \{/);
    expect(source).toMatch(/function renderPreview\(\) \{/);
    const previewFn = source.match(/function renderPreview\(\) \{[\s\S]*?\n\}/)[0];
    expect(previewFn).toContain("hideSaveConflict()");
  });

  test("Save feedback routes to the Save section and Import feedback to the Import section", () => {
    const html = read("popup.html");
    const source = read("popup.js");
    // Save status region lives inside section#preview; import status inside
    // the import panel.
    expect(html.indexOf('id="save-status"')).toBeGreaterThan(html.indexOf('<section id="preview"'));
    expect(html.indexOf('id="save-status"')).toBeLessThan(html.indexOf('id="import-panel"'));
    expect(html.indexOf('id="import-status"')).toBeGreaterThan(html.indexOf('id="import-panel"'));
    // The save flow writes only via setSaveStatus, never setStatus.
    const saveBlock = source.match(/async function saveSelectedGroup\(\) \{[\s\S]*?\n\}/)[0];
    expect(saveBlock).toContain("setSaveStatus(summary.kind, text)");
    expect(saveBlock).toContain("setSaveStatus(\"error\"");
    expect(saveBlock).not.toContain("setStatus(");
    expect(saveBlock).not.toContain("setImportStatus(");
    // Partial merges report added + skipped duplicates in the Save section.
    expect(saveBlock).toContain("const duplicates = Math.max(0, entries.length - mergedAdded)");
    expect(saveBlock).toContain("if (duplicates > 0)");
    expect(saveBlock).toContain("skipped.");
    // The import flow writes only via setImportStatus.
    const importBlock = source.match(/async function confirmImport\(\) \{[\s\S]*?\n\}/)[0];
    expect(importBlock).toContain("setImportStatus(");
    expect(importBlock).not.toContain("setStatus(");
    expect(importBlock).not.toContain("setSaveStatus(");
    // Conflict-bar Cancel clears the Save section, not the Import section.
    const saveCancelled = source.match(/el\.saveConflictCancel\.addEventListener\("click", \(\) => \{[\s\S]*?\}\);/)[0];
    expect(saveCancelled).toContain("hideSaveConflict()");
    expect(saveCancelled).toContain("setSaveStatus(\"info\", \"Save cancelled.\")");
  });

  test("saved groups have an explicit Open-all button beside Remove", () => {
    const source = read("popup.js");
    expect(source).toContain('openAllButton.dataset.action = "open-group"');
    expect(source).toContain('aria-label", "Open all links in this group"');
    // The per-group Open-all delegates to the shared grouping helper, which
    // opens the group's URLs and groups only the tabs it creates.
    expect(source).toContain("openSavedGroupInTabGroup(group)");
    expect(source).toContain("group.entries.length === 0");
    // Remove is relabelled and keeps its confirmation safeguard.
    expect(source).toContain('removeAllButton.textContent = "Remove"');
    expect(source).not.toContain('textContent = "Remove group"');
    expect(source).toMatch(/action === "remove-group"[\s\S]*?window\.confirm/);
  });

  test("global Open all groups each non-empty Saved Group via the shared helper", () => {
    const source = read("popup.js");
    expect(source).toContain("handleOpenAllClick");
    expect(source).toMatch(/saved\.filter\(\(group\) => \(group\?\.entries \?\? \[\]\)\.length > 0\)/);
    expect(source).toContain("openSavedGroupsInTabGroups(nonEmpty)");
    expect(source).toContain("groupsCreated");
    // No existing tab or group is ever touched; only the new helper is used.
    expect(source).not.toContain("tabs.group(");
    expect(source).not.toContain("tabGroups.update(");
  });

  test("every el.X reference in popup.js is initialized in the el object (ref audit)", () => {
    const source = read("popup.js");
    const elBlock = source.slice(source.indexOf("const el = {"), source.indexOf("};", source.indexOf("const el = {")));
    const refs = new Set([...elBlock.matchAll(/^\s*([A-Za-z0-9_]+):\s*document\.getElementById/gm)].map((m) => m[1]));
    // Element members accessed through a ref are fine without their own ref.
    const elementMembers = new Set([
      "className",
      "textContent",
      "hidden",
      "disabled",
      "value",
      "focus",
      "setAttribute",
      "removeAttribute",
      "addEventListener",
      "append",
      "appendChild",
      "replaceChildren",
      "classList",
      "dataset",
      "style",
      "click",
      "title",
      "innerHTML",
      "checked",
    ]);
    const used = new Set([...source.matchAll(/el\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((key) => !refs.has(key) && !elementMembers.has(key));
    expect(missing).toEqual([]);
  });

  test("Save/Import status regions exist in HTML and their JS refs are declared before use", () => {
    const html = read("popup.html");
    const source = read("popup.js");
    for (const id of ["status", "save-status", "import-status"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(source).toContain('saveStatus: document.getElementById("save-status")');
    expect(source).toContain('importStatus: document.getElementById("import-status")');
    // The helpers exist and the ref is declared before the helper can run.
    for (const fn of ["setSaveStatus", "clearSaveStatus", "setImportStatus", "clearImportStatus"]) {
      expect(source).toContain(`function ${fn}`);
    }
    expect(source.indexOf("saveStatus: document.getElementById")).toBeGreaterThan(-1);
    expect(source.indexOf("saveStatus: document.getElementById")).toBeLessThan(source.indexOf("function setSaveStatus"));
    expect(source.indexOf("importStatus: document.getElementById")).toBeLessThan(source.indexOf("function setImportStatus"));
    // The global status ref keeps working as before.
    expect(source).toContain('status: document.getElementById("status")');
  });

  test("loadGroups renders discovered groups and only clears them inside catch", () => {
    const source = read("popup.js");
    const fn = source.match(/async function loadGroups\(\) \{[\s\S]*?\n\}/)[0];
    // Happy path: fetched groups are stored before rendering…
    expect(fn.indexOf("state.groups = allGroups")).toBeGreaterThan(-1);
    expect(fn.indexOf("state.groups = allGroups")).toBeLessThan(fn.indexOf("renderPreview();"));
    // …and the empty-state reset only ever happens in the catch block.
    const catchStart = fn.indexOf("catch (error)");
    expect(fn.indexOf("state.groups = []")).toBeGreaterThan(catchStart);
  });

  test("conflict bars are hidden by default: CSS must not override the hidden attribute", () => {
    const html = read("popup.html");
    const css = read("popup.css");
    // Both conflict bars start hidden in the markup.
    expect(html).toContain('<div id="save-conflict" class="import-conflict" hidden>');
    expect(html).toContain('<div id="import-conflict" class="import-conflict" hidden>');
    // .import-conflict sets display:grid, which would defeat the UA [hidden] rule,
    // so an explicit [hidden] override must exist for both bars.
    expect(css).toContain(".import-conflict[hidden]");
    expect(css).toMatch(/\.import-conflict\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  test("only src/open-links.js can create tabs with URLs", () => {
    const openLinks = read("src/open-links.js");
    expect(openLinks).toContain("tabs.create");

    // The import pipeline must never require or call the tab-opening module.
    for (const file of ["src/import.js", "src/storage.js"]) {
      const source = read(file);
      expect(source).not.toContain("open-links");
    }

    // popup.js may only open tabs through the open-links helpers, never
    // directly through chrome.tabs.
    const popup = read("popup.js");
    expect(popup).toContain('from "./src/open-links.js"');
    expect(popup).not.toContain("chrome.tabs");
    expect(popup).not.toContain("tabs.create(");
  });
});