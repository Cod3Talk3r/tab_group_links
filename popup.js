import {
  buildTabGroupList,
  buildUngroupedEntry,
  formatGroupHeaderLine,
  groupColor,
  UNGROUPED_GROUP_ID,
  UNGROUPED_TITLE,
} from "./src/groups.js";
import { buildTxtExport, savedGroupNameFor } from "./src/export.js";
import { buildImportSummary, countImportEntries, parseImportText } from "./src/import.js";
import {
  applyImportToSavedGroups,
  findNameConflicts,
  loadSavedGroups,
  sanitizeSavedGroupName,
  saveSavedGroups,
} from "./src/storage.js";
import {
  openLinkInBackground,
  openSavedGroupInTabGroup,
  openSavedGroupsInTabGroups,
} from "./src/open-links.js";

const state = {
  groups: [],
  selectedId: null,
  loading: false,
};

const el = {
  groupList: document.getElementById("group-list"),
  groupsEmpty: document.getElementById("groups-empty"),
  preview: document.getElementById("preview"),
  previewMeta: document.getElementById("preview-meta"),
  previewHeader: document.getElementById("preview-header"),
  previewList: document.getElementById("preview-list"),
  previewEmpty: document.getElementById("preview-empty"),
  previewNote: document.getElementById("preview-note"),
  saveSaved: document.getElementById("save-saved"),
  saveConflict: document.getElementById("save-conflict"),
  saveConflictNote: document.getElementById("save-conflict-note"),
  saveConflictMerge: document.getElementById("save-conflict-merge"),
  saveConflictRename: document.getElementById("save-conflict-rename"),
  saveConflictCancel: document.getElementById("save-conflict-cancel"),
  saveStatus: document.getElementById("save-status"),
  copy: document.getElementById("copy"),
  exportTxt: document.getElementById("export-txt"),
  status: document.getElementById("status"),
  refresh: document.getElementById("refresh"),

  // Import section
  importPanel: document.getElementById("import-panel"),
  importText: document.getElementById("import-text"),
  importFile: document.getElementById("import-file"),
  importFileInput: document.getElementById("import-file-input"),
  importPreview: document.getElementById("import-preview"),
  importStatus: document.getElementById("import-status"),
  importMeta: document.getElementById("import-meta"),
  importGroups: document.getElementById("import-groups"),
  importWarnings: document.getElementById("import-warnings"),
  importConflict: document.getElementById("import-conflict"),
  importConflictNote: document.getElementById("import-conflict-note"),
  importConflictMerge: document.getElementById("import-conflict-merge"),
  importConflictRename: document.getElementById("import-conflict-rename"),
  importConflictCancel: document.getElementById("import-conflict-cancel"),
  importConfirm: document.getElementById("import-confirm"),

  // Saved links section
  savedList: document.getElementById("saved-list"),
  savedEmpty: document.getElementById("saved-empty"),
  savedMeta: document.getElementById("saved-meta"),
};

const defaultGroupsEmptyText = el.groupsEmpty.textContent.trim();

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function describeError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown error";
}

function skippedNote(group) {
  return group.skippedCount
    ? ` Skipped ${group.skippedCount} ${plural(group.skippedCount, "tab")} with no accessible URL.`
    : "";
}

/**
 * Render the status line for a single Open-all operation that used
 * {@link openSavedGroupInTabGroup}. Keeps feedback consistent across the
 * per-group and global Open-all actions.
 *
 * - `opened === 0`: nothing could be opened.
 * - `grouped`: a new native tab group was created and named.
 * - `!grouped && groupError`: tabs opened but grouping failed.
 * - `!grouped && !groupError`: fallback, ungrouped background opening.
 *
 * @param {{ opened: number, failed: number, grouped: boolean, groupError: string | null }} result
 * @param {{ name?: string, emptyLabel?: string }} [options]
 */
function setOpenStatus(result, options = {}) {
  const failedNote =
    result.failed > 0
      ? ` ${result.failed} ${plural(result.failed, "link")} could not be opened.`
      : "";
  if (result.opened === 0) {
    setStatus(
      "error",
      `${options.emptyLabel ?? "Could not open any links."}${failedNote}`,
    );
    return;
  }
  if (result.grouped) {
    setStatus(
      "success",
      `Opened ${result.opened} ${plural(result.opened, "link")} in a new tab group “${options.name ?? ""}”.${failedNote}`,
    );
    return;
  }
  if (result.groupError) {
    setStatus(
      "error",
      `Opened ${result.opened} ${plural(result.opened, "link")}, but could not group them: ${result.groupError}.${failedNote}`,
    );
    return;
  }
  setStatus(
    "success",
    `Opened ${result.opened} ${plural(result.opened, "link")} in new background tabs.${failedNote}`,
  );
}

function isVirtualGroup(group) {
  return group && group.id === UNGROUPED_GROUP_ID;
}

function emptyStateMessage(groups) {
  const hasReal = groups.some((g) => !isVirtualGroup(g));
  const hasVirtual = groups.some((g) => isVirtualGroup(g));
  if (!hasReal && hasVirtual) {
    return "No tab groups in this window. Only the Ungrouped Tabs entry is available.";
  }
  return defaultGroupsEmptyText;
}

function selectedGroup() {
  return state.groups.find((group) => group.id === state.selectedId) ?? null;
}

function setStatus(kind, message) {
  el.status.hidden = false;
  el.status.className = `status status--${kind}`;
  el.status.textContent = message;
}

function clearStatus() {
  el.status.hidden = true;
  el.status.className = "status";
  el.status.textContent = "";
}

/* Section-scoped feedback: Save messages go to the preview (Save) section,
 * Import messages to the Import panel. The shared #status region is only
 * for general popup messages (copy, export, open, load errors). */

function setSaveStatus(kind, message) {
  el.saveStatus.hidden = false;
  el.saveStatus.className = `status status--${kind}`;
  el.saveStatus.textContent = message;
}

function clearSaveStatus() {
  el.saveStatus.hidden = true;
  el.saveStatus.className = "status";
  el.saveStatus.textContent = "";
}

function setImportStatus(kind, message) {
  el.importStatus.hidden = false;
  el.importStatus.className = `status status--${kind}`;
  el.importStatus.textContent = message;
}

function clearImportStatus() {
  el.importStatus.hidden = true;
  el.importStatus.className = "status";
  el.importStatus.textContent = "";
}

function selectGroup(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  clearStatus();
  renderGroups();
  renderPreview();
}

function renderGroups() {
  el.groupList.replaceChildren();
  el.groupsEmpty.hidden = state.groups.length > 0;
  el.groupsEmpty.textContent = emptyStateMessage(state.groups);

  const fragment = document.createDocumentFragment();
  for (const group of state.groups) {
    const selected = group.id === state.selectedId;
    const item = document.createElement("li");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-item";
    button.dataset.groupId = String(group.id);
    button.setAttribute("aria-pressed", String(selected));

    if (isVirtualGroup(group)) {
      const label = document.createElement("span");
      label.className = "virtual-group-label";
      label.textContent = group.title;
      button.append(label);
    } else {
      const dot = document.createElement("span");
      dot.className = "color-dot";
      dot.setAttribute("aria-hidden", "true");
      dot.style.background = groupColor(group.color);

      const name = document.createElement("span");
      name.className = "group-name";
      name.textContent = group.title;

      button.append(dot, name);
    }

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${group.tabCount} ${plural(group.tabCount, "tab")}`;

    button.append(count);
    item.append(button);
    fragment.append(item);
  }
  el.groupList.append(fragment);
}

function renderPreview() {
  const group = selectedGroup();
  if (!group) {
    el.preview.hidden = true;
    hideSaveConflict();
    clearSaveStatus();
    return;
  }

  hideSaveConflict();
  clearSaveStatus();
  el.preview.hidden = false;
  const urlCount = group.urls.length;
  el.previewMeta.textContent =
    urlCount === 0 ? "0 URLs" : `${urlCount} numbered ${plural(urlCount, "URL")}`;

  el.previewHeader.hidden = !group.hasTitle;
  if (group.hasTitle) {
    el.previewHeader.textContent = formatGroupHeaderLine(group.title);
  }

  const fragment = document.createDocumentFragment();
  group.entries.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "preview-entry";

    const title = document.createElement("span");
    title.className = "preview-entry-title";
    title.textContent = `${index + 1}. ${entry.title}`;

    const url = document.createElement("span");
    url.className = "preview-entry-url";
    url.textContent = entry.url;

    item.append(title, url);
    fragment.append(item);
  });
  el.previewList.replaceChildren(fragment);

  const noUrls = group.urls.length === 0;
  el.previewEmpty.hidden = !noUrls;
  if (noUrls) {
    el.previewEmpty.textContent =
      group.tabCount === 0
        ? "This group has no tabs."
        : "None of the tabs in this group expose a URL, so there is nothing to copy or export.";
  }

  el.previewNote.hidden = group.skippedCount === 0;
  el.previewNote.textContent = group.skippedCount
    ? `Skipped ${group.skippedCount} ${plural(group.skippedCount, "tab")} with no accessible URL.`
    : "";

  el.copy.disabled = noUrls;
  el.exportTxt.disabled = noUrls;
  el.saveSaved.disabled = noUrls;
  el.copy.textContent = noUrls
    ? "Copy URLs"
    : `Copy ${group.urls.length} ${plural(group.urls.length, "URL")}`;
}

async function loadGroups() {
  if (state.loading) return;
  state.loading = true;
  clearStatus();
  el.refresh.disabled = true;
  el.refresh.setAttribute("aria-busy", "true");
  el.groupsEmpty.textContent = defaultGroupsEmptyText;

  try {
    const api = globalThis.chrome;
    if (
      !api?.windows?.getCurrent ||
      !api?.tabGroups?.query ||
      !api?.tabs?.query
    ) {
      throw new Error("This browser does not expose the tab groups API.");
    }

    const currentWindow = await api.windows.getCurrent();
    if (!currentWindow || typeof currentWindow.id !== "number") {
      throw new Error("Could not determine the current window.");
    }

    const [groups, tabs] = await Promise.all([
      api.tabGroups.query({ windowId: currentWindow.id }),
      api.tabs.query({ windowId: currentWindow.id }),
    ]);

    const realGroups = buildTabGroupList(groups, tabs, currentWindow.id);
    const ungrouped = buildUngroupedEntry(tabs, currentWindow.id);
    const allGroups = [...realGroups];
    if (ungrouped) allGroups.push(ungrouped);

    state.groups = allGroups;
    const stillExists = state.groups.some((group) => group.id === state.selectedId);
    if (!stillExists) {
      state.selectedId = state.groups.length > 0 ? state.groups[0].id : null;
    }

    renderGroups();
    renderPreview();
  } catch (error) {
    state.groups = [];
    state.selectedId = null;
    renderGroups();
    renderPreview();
    el.groupsEmpty.hidden = false;
    el.groupsEmpty.textContent = "Could not read tab groups from this window.";
    setStatus("error", `Could not load tab groups: ${describeError(error)}.`);
  } finally {
    state.loading = false;
    el.refresh.disabled = false;
    el.refresh.removeAttribute("aria-busy");
  }
}

function copyWithTextarea(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.append(area);

  const previousFocus = document.activeElement;
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    area.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
}

async function writeToClipboard(text) {
  let clipboardError = null;
  const clipboard = globalThis.navigator?.clipboard;

  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  if (copyWithTextarea(text)) return;

  throw clipboardError instanceof Error
    ? clipboardError
    : new Error("The browser blocked clipboard access");
}

async function copySelected() {
  const group = selectedGroup();
  if (!group) {
    setStatus("error", "Select a tab group first.");
    return;
  }
  if (group.urls.length === 0) {
    setStatus("error", "This group has no URLs to copy.");
    return;
  }

  const text = group.formattedText;
  el.copy.disabled = true;
  try {
    await writeToClipboard(text);
    setStatus(
      "success",
      `Copied ${group.urls.length} numbered ${plural(group.urls.length, "URL")} from “${group.title}”.${skippedNote(group)}`,
    );
  } catch (error) {
    setStatus(
      "error",
      `Could not copy the URLs: ${describeError(error)}. You can still select them in the preview.`,
    );
  } finally {
    el.copy.disabled = group.urls.length === 0;
  }
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  link.hidden = true;

  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to start reading the Blob before revoking it.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function exportedFilename(group) {
  const name = isVirtualGroup(group) ? UNGROUPED_TITLE : group.title;
  return buildTxtExport(name, group.formattedText).filename;
}

function exportSelected() {
  const group = selectedGroup();
  if (!group) {
    setStatus("error", "Select a tab group first.");
    return;
  }
  if (group.urls.length === 0) {
    setStatus("error", "This group has no URLs to export.");
    return;
  }

  const name = isVirtualGroup(group) ? UNGROUPED_TITLE : group.title;
  const { filename, content } = buildTxtExport(name, group.formattedText);
  el.exportTxt.disabled = true;
  try {
    downloadTextFile(filename, content);
    setStatus(
      "success",
      `Download started: ${filename} (${group.urls.length} numbered ${plural(group.urls.length, "URL")}).${skippedNote(group)} Check your browser downloads.`,
    );
  } catch (error) {
    setStatus(
      "error",
      `Could not export the TXT file: ${describeError(error)}.`,
    );
  } finally {
    el.exportTxt.disabled = group.urls.length === 0;
  }
}

el.groupList.addEventListener("click", (event) => {
  const target = event.target;
  const button = target instanceof Element ? target.closest("button[data-group-id]") : null;
  if (!button) return;
  const id = Number(button.dataset.groupId);
  if (Number.isFinite(id)) selectGroup(id);
});

el.refresh.addEventListener("click", () => {
  void loadGroups();
});

el.copy.addEventListener("click", () => {
  void copySelected();
});

el.exportTxt.addEventListener("click", () => {
  exportSelected();
});

el.saveSaved.addEventListener("click", () => {
  void saveSelectedGroup();
});

el.saveConflictMerge.addEventListener("click", () => {
  saveState.policy = "merge";
  void saveSelectedGroup();
});

el.saveConflictRename.addEventListener("click", () => {
  saveState.policy = "rename";
  void saveSelectedGroup();
});

// Conflict-bar Cancel leaves saved data untouched and never shows
// validation errors.
el.saveConflictCancel.addEventListener("click", () => {
  hideSaveConflict();
  setSaveStatus("info", "Save cancelled.");
});

/* ── Import: saved links ─────────────────────────────────────────────
 *
 * Importing never opens a website: parsed links are only previewed in the
 * DOM and, after confirmation, written to chrome.storage.local. The only
 * code that can turn a link into a tab is src/open-links.js, called from
 * explicit "Open" buttons below.
 */

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

const importState = {
  /** @type {{ groups: Array<{ name: string | null, entries: Array<{ title: string, url: string }> }>, warnings: string[] } | null} */
  parsed: null,
  /** Conflict policy chosen by the user for name collisions, or null. */
  conflictPolicy: null,
};

function resetImportUI() {
  importState.parsed = null;
  importState.conflictPolicy = null;
  el.importText.value = "";
  el.importPreview.hidden = true;
  el.importConflict.hidden = true;
  el.importGroups.replaceChildren();
  el.importWarnings.hidden = true;
  el.importWarnings.textContent = "";
  el.importConfirm.disabled = true;
  clearImportStatus();
}

function readEditedGroupNames() {
  return importState.parsed.groups.map((group, index) => {
    const input = el.importGroups.querySelector(`input[data-group-index="${index}"]`);
    return sanitizeSavedGroupName(input instanceof HTMLInputElement ? input.value : "");
  });
}

function renderImportPreview(parsed) {
  el.importGroups.replaceChildren();
  el.importConflict.hidden = true;
  importState.conflictPolicy = null;

  const total = countImportEntries(parsed.groups);
  const fragment = document.createDocumentFragment();

  parsed.groups.forEach((group, index) => {
    const item = document.createElement("div");
    item.className = "import-group";

    const head = document.createElement("div");
    head.className = "import-group-head";

    const label = document.createElement("label");
    label.textContent = "Group name";
    label.setAttribute("for", `import-group-name-${index}`);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.id = `import-group-name-${index}`;
    nameInput.className = "import-group-name";
    nameInput.dataset.groupIndex = String(index);
    nameInput.value = group.name ?? "";
    nameInput.placeholder = "Group name (required)";
    nameInput.setAttribute("aria-invalid", group.name ? "false" : "true");
    nameInput.maxLength = 200;

    const count = document.createElement("span");
    count.className = "import-group-count";
    count.textContent = `${group.entries.length} ${plural(group.entries.length, "link")}`;

    head.append(label, nameInput, count);

    const list = document.createElement("ol");
    list.className = "import-entries";
    for (const entry of group.entries) {
      const li = document.createElement("li");
      li.className = "import-entry";
      const title = document.createElement("span");
      title.className = "import-entry-title";
      title.textContent = entry.title || entry.url;
      const url = document.createElement("code");
      url.className = "import-entry-url";
      url.textContent = entry.url;
      li.append(title, url);
      list.append(li);
    }

    item.append(head, list);
    fragment.append(item);
  });

  el.importGroups.append(fragment);
  el.importMeta.textContent =
    total === 0
      ? "No importable links found."
      : `${parsed.groups.length} ${plural(parsed.groups.length, "group")} · ${total} ${plural(total, "link")} · nothing will be opened`;

  if (parsed.warnings.length > 0) {
    el.importWarnings.hidden = false;
    el.importWarnings.replaceChildren();
    for (const warning of parsed.warnings) {
      const line = document.createElement("div");
      line.textContent = warning;
      el.importWarnings.append(line);
    }
  } else {
    el.importWarnings.hidden = true;
    el.importWarnings.replaceChildren();
  }

  el.importPreview.hidden = false;
  el.importConfirm.disabled = total === 0;
}

function refreshImportPreview() {
  const text = el.importText.value;
  if (!text.trim()) {
    resetImportUI();
    return;
  }
  const parsed = parseImportText(text);
  importState.parsed = parsed;
  renderImportPreview(parsed);
}

async function loadImportFile(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    setImportStatus("error", `“${file.name}” is too large (max 5 MB).`);
    return;
  }
  el.importFile.disabled = true;
  try {
    const text = await file.text();
    el.importText.value = text;
    refreshImportPreview();
    el.importPanel.open = true;
    if (!text.trim()) {
      setImportStatus("info", `“${file.name}” is empty.`);
    } else {
      setImportStatus("success", `Loaded “${file.name}”. Review the preview, then press Import.`);
    }
  } catch (error) {
    setImportStatus("error", `Could not read “${file.name}”: ${describeError(error)}.`);
  } finally {
    el.importFile.disabled = false;
  }
}

async function confirmImport() {
  if (!importState.parsed) return;

  const names = readEditedGroupNames();
  const namedGroups = [];
  for (let index = 0; index < importState.parsed.groups.length; index += 1) {
    const name = names[index];
    if (!name) {
      setImportStatus("error", "Enter a name for every group before importing.");
      const input = el.importGroups.querySelector(`input[data-group-index="${index}"]`);
      if (input instanceof HTMLInputElement) {
        input.setAttribute("aria-invalid", "true");
        input.focus();
      }
      return;
    }
    namedGroups.push({ name, entries: importState.parsed.groups[index].entries });
  }

  if (namedGroups.length === 0) {
    setImportStatus("info", "Nothing to import — this text has no links.");
    return;
  }

  el.importConfirm.disabled = true;
  try {
    const saved = await loadSavedGroups();
    const conflicts = findNameConflicts(namedGroups, saved);

    if (conflicts.length > 0 && !importState.conflictPolicy) {
      const names = conflicts.map((name) => `“${name}”`).join(", ");
      el.importConflictNote.textContent =
        `${names} ${conflicts.length === 1 ? "already exists" : "already exist"}. Choose how to import:`;
      el.importConflict.hidden = false;
      el.importConfirm.disabled = false;
      return;
    }

    const policy = conflicts.length > 0 ? importState.conflictPolicy : "merge";
    const result = applyImportToSavedGroups(saved, namedGroups, { policy });
    await saveSavedGroups(result.groups);

    const summary = buildImportSummary(result);
    await refreshSavedGroups();
    resetImportUI();
    setImportStatus(summary.kind, summary.text);
  } catch (error) {
    setImportStatus("error", `Import failed: ${describeError(error)}. Your saved links are unchanged.`);
    el.importConfirm.disabled = false;
  }
}

const saveState = { policy: null };

function hideSaveConflict() {
  el.saveConflict.hidden = true;
  el.saveConflictNote.textContent = "";
  saveState.policy = null;
}

/**
 * Save the currently selected export group into Saved Links.
 *
 * Reuses the import pipeline's storage machinery: `findNameConflicts` and
 * `applyImportToSavedGroups` (merge / rename policies) with the same
 * duplicate-URL rules. It only touches extension storage — it never opens
 * websites or creates tabs.
 */
async function saveSelectedGroup() {
  const group = selectedGroup();
  if (!group || group.urls.length === 0) return;

  const name = savedGroupNameFor(group);
  const entries = group.entries.map((entry) => ({ title: entry.title, url: entry.url }));

  el.saveSaved.disabled = true;
  try {
    const saved = await loadSavedGroups();
    const conflicts = findNameConflicts([{ name, entries }], saved);

    if (conflicts.length > 0 && !saveState.policy) {
      el.saveConflictNote.textContent = `“${name}” already exists. Choose how to save:`;
      el.saveConflict.hidden = false;
      el.saveSaved.disabled = false;
      return;
    }

    const policy = conflicts.length > 0 ? saveState.policy : "merge";
    const result = applyImportToSavedGroups(saved, [{ name, entries }], { policy });
    await saveSavedGroups(result.groups);

    const summary = buildImportSummary(result, { newVerb: "Saved" });
    let text = summary.text;
    // A partial merge reports both the added links and the duplicates that
    // were skipped (all-duplicate merges already surface as a no-op info).
    if (result.merged.length > 0) {
      const mergedAdded = result.merged.reduce((sum, entry) => sum + entry.addedCount, 0);
      const duplicates = Math.max(0, entries.length - mergedAdded);
      if (duplicates > 0) {
        text += ` ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped.`;
      }
    }
    await refreshSavedGroups();
    hideSaveConflict();
    setSaveStatus(summary.kind, text);
  } catch (error) {
    setSaveStatus("error", `Could not save: ${describeError(error)}. Your saved links are unchanged.`);
    hideSaveConflict();
  } finally {
    el.saveSaved.disabled = false;
  }
}

async function refreshSavedGroups() {
  try {
    const saved = await loadSavedGroups();
    renderSavedGroups(saved);
    el.savedEmpty.hidden = saved.length > 0;
    el.savedMeta.textContent = `${saved.length} ${plural(saved.length, "group")} stored in this extension`;
    el.savedList.hidden = saved.length === 0;
  } catch (error) {
    el.savedEmpty.hidden = false;
    el.savedEmpty.textContent = `Could not load saved links: ${describeError(error)}`;
    el.savedMeta.textContent = "";
    el.savedList.hidden = true;
  }
}

function renderSavedGroups(saved) {
  const fragment = document.createDocumentFragment();
  for (const group of saved) {
    const li = document.createElement("li");
    li.className = "saved-group";
    li.dataset.groupId = group.id;

    const head = document.createElement("div");
    head.className = "saved-head";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "saved-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", `saved-detail-${group.id}`);

    const caret = document.createElement("span");
    caret.className = "saved-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▸";

    const name = document.createElement("span");
    name.className = "saved-name";
    name.textContent = group.name || "Untitled";

    const count = document.createElement("span");
    count.className = "saved-count";
    count.textContent = `${group.entries.length} ${plural(group.entries.length, "link")}`;

    toggle.append(caret, name, count);

    const detail = document.createElement("div");
    detail.className = "saved-detail";
    detail.id = `saved-detail-${group.id}`;
    detail.hidden = true;

    const ol = document.createElement("ol");
    ol.className = "saved-entries";
    for (const [entryIndex, entry] of group.entries.entries()) {
      const entryLi = document.createElement("li");
      entryLi.className = "saved-entry";

      const textPart = document.createElement("div");
      textPart.className = "saved-entry-text";
      const entryTitle = document.createElement("span");
      entryTitle.className = "import-entry-title";
      entryTitle.textContent = entry.title || entry.url;
      const entryUrl = document.createElement("code");
      entryUrl.className = "import-entry-url";
      entryUrl.textContent = entry.url;
      textPart.append(entryTitle, entryUrl);

      const actionPart = document.createElement("div");
      actionPart.className = "saved-entry-actions";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "mini-btn";
      openButton.textContent = "Open";
      openButton.title = "Open this link in a new background tab (the site will load)";
      openButton.dataset.action = "open";
      openButton.dataset.groupId = group.id;
      openButton.dataset.entryIndex = String(entryIndex);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mini-btn mini-btn--danger";
      removeButton.textContent = "Remove";
      removeButton.title = "Remove this link from the saved group";
      removeButton.dataset.action = "remove";
      removeButton.dataset.groupId = group.id;
      removeButton.dataset.entryIndex = String(entryIndex);

      actionPart.append(openButton, removeButton);
      entryLi.append(textPart, actionPart);
      ol.append(entryLi);
    }

    const headActions = document.createElement("div");
    headActions.className = "saved-entry-actions";
    const openAllButton = document.createElement("button");
    openAllButton.type = "button";
    openAllButton.className = "mini-btn save-group-open";
    openAllButton.setAttribute("aria-label", "Open all links in this group");
    openAllButton.title = "Open all links in this group in new background tabs (the sites will load)";
    openAllButton.dataset.action = "open-group";
    openAllButton.dataset.groupId = group.id;
    openAllButton.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 3H2.5v6.5H9V6M9.5 2.5 6 6M9.5 2.5V5M9.5 2.5H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const removeAllButton = document.createElement("button");
    removeAllButton.type = "button";
    removeAllButton.className = "mini-btn mini-btn--danger";
    removeAllButton.textContent = "Remove";
    removeAllButton.title = "Remove this whole saved group (links are not opened)";
    removeAllButton.dataset.action = "remove-group";
    removeAllButton.dataset.groupId = group.id;
    headActions.append(openAllButton, removeAllButton);

    head.append(toggle, headActions);
    detail.append(ol);
    li.append(head, detail);
    fragment.append(li);
  }
  el.savedList.replaceChildren(fragment);
}

async function handleSavedClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const toggle = target.closest(".saved-toggle");
  if (toggle) {
    const li = toggle.closest(".saved-group");
    const detail = li?.querySelector(".saved-detail");
    if (!(detail instanceof HTMLElement)) return;
    const expanded = detail.hidden;
    detail.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    return;
  }

  const actionButton = target.closest("button[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  const groupId = actionButton.dataset.groupId;
  const entryIndex = Number(actionButton.dataset.entryIndex);

  try {
    const saved = await loadSavedGroups();
    if (action === "open") {
      const entry = saved.find((group) => group.id === groupId)?.entries?.[entryIndex];
      if (!entry) {
        setStatus("error", "That link no longer exists — refresh the list.");
        return;
      }
      try {
        await openLinkInBackground(entry.url);
        setStatus("success", `Opened “${entry.title || entry.url}” in a new background tab.`);
      } catch (error) {
        setStatus("error", `Could not open the link: ${describeError(error)}`);
      }
      return;
    }

    if (action === "remove") {
      const group = saved.find((item) => item.id === groupId);
      if (!group) {
        setStatus("error", "That group no longer exists — refresh the list.");
        return;
      }
      if (entryIndex >= 0 && entryIndex < group.entries.length) {
        group.entries.splice(entryIndex, 1);
        await saveSavedGroups(saved);
        await refreshSavedGroups();
        setStatus("success", "Link removed.");
      }
      return;
    }

    if (action === "open-group") {
      const group = saved.find((item) => item.id === groupId);
      if (!group) {
        setStatus("error", "That group no longer exists — refresh the list.");
        return;
      }
      if (group.entries.length === 0) {
        setStatus("info", "This group has no links to open.");
        return;
      }
      try {
        const result = await openSavedGroupInTabGroup(group);
        setOpenStatus(result, { name: group.name, emptyLabel: "Could not open any links in this group." });
      } catch (error) {
        setStatus("error", `Could not open the links: ${describeError(error)}`);
      }
      return;
    }

    if (action === "remove-group") {
      const index = saved.findIndex((item) => item.id === groupId);
      if (index < 0) {
        setStatus("error", "That group no longer exists — refresh the list.");
        return;
      }
      if (!window.confirm(`Remove the saved group and all its links? No website will be opened.`)) {
        return;
      }
      saved.splice(index, 1);
      await saveSavedGroups(saved);
      await refreshSavedGroups();
      setStatus("success", "Saved group removed. No website was opened.");
    }
  } catch (error) {
    setStatus("error", `Could not update saved links: ${describeError(error)}`);
  }
}

async function handleOpenAllClick(event) {
  const button = event.target;
  if (!(button instanceof Element) || !button.closest("#open-all-btn")) return;
  const saved = await loadSavedGroups();
  const nonEmpty = saved.filter((group) => (group?.entries ?? []).length > 0);
  const total = nonEmpty.reduce((sum, group) => sum + group.entries.length, 0);
  if (total === 0) {
    setStatus("info", "There are no saved links to open.");
    return;
  }
  const confirmed = window.confirm(
    `Open all ${total} saved ${plural(total, "link")} in new background tabs? These sites will load normally.`,
  );
  if (!confirmed) return;
  try {
    // Each non-empty Saved Group becomes its own native tab group, in order.
    const result = await openSavedGroupsInTabGroups(nonEmpty);
    const failedNote =
      result.failed > 0
        ? ` ${result.failed} ${plural(result.failed, "link")} could not be opened.`
        : "";
    if (result.opened === 0) {
      setStatus("error", `Could not open any saved links.${failedNote}`);
      return;
    }
    if (result.groupsCreated > 0) {
      const groupNote = result.groupErrors.length
        ? ` ${result.groupErrors.length} ${plural(result.groupErrors.length, "group")} could not be grouped.`
        : "";
      setStatus(
        "success",
        `Opened ${result.opened} ${plural(result.opened, "link")} in ${result.groupsCreated} new tab ${plural(result.groupsCreated, "group")}.${groupNote}${failedNote}`,
      );
      return;
    }
    if (result.groupErrors.length) {
      setStatus(
        "error",
        `Opened ${result.opened} ${plural(result.opened, "link")}, but could not group them: ${result.groupErrors.join("; ")}.${failedNote}`,
      );
      return;
    }
    setStatus(
      "success",
      `Opened ${result.opened} ${plural(result.opened, "link")} in new background tabs.${failedNote}`,
    );
  } catch (error) {
    setStatus("error", `Could not open the links: ${describeError(error)}`);
  }
}

el.importText.addEventListener("input", () => {
  refreshImportPreview();
});

el.importFile.addEventListener("click", () => {
  el.importFileInput.click();
});

el.importFileInput.addEventListener("change", () => {
  const file = el.importFileInput.files?.[0] ?? null;
  el.importFileInput.value = "";
  void loadImportFile(file);
});

el.importGroups.addEventListener("input", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.classList.contains("import-group-name")) {
    const invalid = target.value.trim().length === 0;
    target.setAttribute("aria-invalid", String(invalid));
    el.importConfirm.disabled = importState.parsed ? countImportEntries(importState.parsed.groups) === 0 : true;
  }
});

el.importConflictMerge.addEventListener("click", () => {
  importState.conflictPolicy = "merge";
  void confirmImport();
});

el.importConflictRename.addEventListener("click", () => {
  importState.conflictPolicy = "rename";
  void confirmImport();
});

// The conflict-bar Cancel cancels the whole import: it must not parse,
// validate, import, modify saved groups or open anything.
el.importConflictCancel.addEventListener("click", () => {
  resetImportUI();
  setStatus("info", "Import cancelled.");
});

el.importConfirm.addEventListener("click", () => {
  void confirmImport();
});

el.savedList.addEventListener("click", (event) => {
  void handleSavedClick(event);
});

el.savedList.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    const target = event.target;
    if (target instanceof Element && target.classList.contains("saved-toggle")) {
      event.preventDefault();
      target.click();
    }
  }
});

const openAllButtonElement = document.getElementById("open-all-btn");
if (openAllButtonElement) {
  openAllButtonElement.addEventListener("click", (event) => {
    void handleOpenAllClick(event);
  });
}

void loadGroups();
void refreshSavedGroups();