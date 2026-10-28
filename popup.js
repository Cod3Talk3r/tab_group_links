import {
  buildTabGroupList,
  buildUngroupedEntry,
  UNGROUPED_GROUP_ID,
  UNGROUPED_TITLE,
} from "./src/groups.js";
import { buildTxtExport } from "./src/export.js";

const GROUP_COLORS = {
  grey: "#8a94a6",
  blue: "#4c8bf5",
  red: "#e5484d",
  yellow: "#f5b83d",
  green: "#46a758",
  pink: "#e93d82",
  purple: "#8e4ec6",
  cyan: "#12a594",
  orange: "#f76b15",
};

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
  previewList: document.getElementById("preview-list"),
  previewEmpty: document.getElementById("preview-empty"),
  previewNote: document.getElementById("preview-note"),
  copy: document.getElementById("copy"),
  exportTxt: document.getElementById("export-txt"),
  status: document.getElementById("status"),
  refresh: document.getElementById("refresh"),
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

function groupColor(color) {
  return GROUP_COLORS[color] ?? GROUP_COLORS.grey;
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
    return;
  }

  el.preview.hidden = false;
  const urlCount = group.urls.length;
  el.previewMeta.textContent =
    urlCount === 0 ? "0 URLs" : `${urlCount} numbered ${plural(urlCount, "URL")}`;

  const lines = group.formattedLines;
  const fragment = document.createDocumentFragment();
  group.entries.forEach((_entry, position) => {
    const item = document.createElement("li");
    item.className = "preview-item";

    const body = document.createElement("span");
    body.className = "tab-body";

    const code = document.createElement("code");
    code.className = "tab-url";
    code.textContent = lines[position] ?? "";

    body.append(code);
    item.append(body);
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

void loadGroups();