import { describe, expect, test } from "bun:test";
import {
  MAX_SAVED_ENTRIES,
  MAX_SAVED_GROUPS,
  SAVED_GROUPS_KEY,
  SAVED_GROUPS_VERSION,
  applyImportToSavedGroups,
  buildSavedGroup,
  buildUniqueGroupName,
  findNameConflicts,
  findSavedGroupByName,
  loadSavedGroups,
  makeGroupId,
  mergeEntriesIntoGroup,
  nameKey,
  saveSavedGroups,
  sanitizeSavedGroupName,
} from "../src/storage.js";

/**
 * Minimal in-memory fake of `chrome.storage.local`.
 * `failWith` makes the next `set` reject, simulating quota/IO failures.
 */
function fakeStorage() {
  const bag = new Map();
  const storage = {
    failWith: null,
    setCount: 0,
    async get(key) {
      return bag.has(key) ? { [key]: bag.get(key) } : {};
    },
    async set(patch) {
      storage.setCount += 1;
      if (storage.failWith) {
        const error = storage.failWith;
        storage.failWith = null;
        throw error;
      }
      for (const [key, value] of Object.entries(patch)) bag.set(key, value);
    },
  };
  return { storage, bag };
}

function withChrome(storage, body) {
  globalThis.chrome = { storage: { local: storage } };
  return Promise.resolve(body()).finally(() => {
    delete globalThis.chrome;
  });
}

const entries = [
  { title: "One", url: "https://a.test/" },
  { title: "Two", url: "https://b.test/" },
];

describe("makeGroupId", () => {
  test("uses crypto.randomUUID when available", () => {
    expect(makeGroupId({ randomUUID: () => "uuid-1" })).toBe("uuid-1");
  });

  test("falls back to a timestamp-based id", () => {
    expect(makeGroupId({})).toMatch(/^group-\d+-\d+$/);
  });
});

describe("sanitizeSavedGroupName / nameKey", () => {
  test("cleans whitespace and control characters and clamps length", () => {
    expect(sanitizeSavedGroupName("  A \n B\tC \u0000 ")).toBe("A B C");
    expect(sanitizeSavedGroupName("x".repeat(500)).length).toBe(200);
    expect(sanitizeSavedGroupName(42)).toBe("");
  });

  test("nameKey is case-insensitive", () => {
    expect(nameKey("Work")).toBe(nameKey("  WORK "));
  });
});

describe("buildSavedGroup", () => {
  test("builds a normalised record", () => {
    const group = buildSavedGroup(" Work ", entries, "fixed-id");
    expect(group.id).toBe("fixed-id");
    expect(group.name).toBe("Work");
    expect(group.entries).toEqual(entries);
    expect(typeof group.savedAt).toBe("number");
  });

  test("generates an id when none is given and tolerates bad entries", () => {
    const group = buildSavedGroup("G", [null, { url: "https://a.test/" }, { title: "T" }]);
    // Bun and browsers expose crypto.randomUUID; the fallback is `group-…`.
    expect(group.id.length).toBeGreaterThan(8);
    expect(group.entries).toEqual([
      { title: "", url: "" },
      { title: "", url: "https://a.test/" },
      { title: "T", url: "" },
    ]);
  });
});

describe("conflict helpers", () => {
  test("findSavedGroupByName matches case-insensitively", () => {
    const saved = [buildSavedGroup("Work", entries, "id-1")];
    expect(findSavedGroupByName(saved, " work ").id).toBe("id-1");
    expect(findSavedGroupByName(saved, "Other")).toBeNull();
    expect(findSavedGroupByName(saved, "")).toBeNull();
  });

  test("findNameConflicts reports only conflicting names, once each", () => {
    const saved = [buildSavedGroup("Work", entries, "id-1")];
    const imported = [
      { name: "work", entries },
      { name: "Fresh", entries },
      { name: "WORK", entries },
    ];
    expect(findNameConflicts(imported, saved)).toEqual(["work"]); // deduped, first spelling wins
    expect(findNameConflicts([], saved)).toEqual([]);
  });

  test("mergeEntriesIntoGroup appends only new URLs and returns the count", () => {
    const group = buildSavedGroup("G", [{ title: "Old", url: "https://old.test/" }], "id");
    const added = mergeEntriesIntoGroup(group, [
      { title: "Old dup", url: "https://old.test/" },
      { title: "New", url: "https://new.test/" },
      null,
      { title: "No url", url: "" },
    ]);
    expect(added).toBe(1);
    expect(group.entries).toHaveLength(2);
  });

  test("buildUniqueGroupName picks the next free numeric suffix", () => {
    const saved = [buildSavedGroup("Work", entries, "id-1")];
    expect(buildUniqueGroupName("Work", saved)).toBe("Work (2)");
    const taken = new Set([nameKey("Work (2)")]);
    expect(buildUniqueGroupName("Work", saved, taken)).toBe("Work (3)");
    expect(buildUniqueGroupName("", saved)).toBe("Imported");
  });

  test("buildUniqueGroupName skips numeric suffixes that already exist", () => {
    const saved = [
      buildSavedGroup("Games", entries, "id-1"),
      buildSavedGroup("Games (2)", entries, "id-2"),
      buildSavedGroup("Games (3)", entries, "id-3"),
    ];
    expect(buildUniqueGroupName("Games", saved)).toBe("Games (4)");
  });

  test("buildUniqueGroupName leaves an unused name unchanged", () => {
    const saved = [buildSavedGroup("Games", entries, "id-1")];
    expect(buildUniqueGroupName("Work", saved)).toBe("Work");
    // A name that already ends in a suffix is also reused verbatim when free.
    expect(buildUniqueGroupName("Games (2)", saved)).toBe("Games (2)");
  });

  test("buildUniqueGroupName matches conflicts case-insensitively", () => {
    const saved = [buildSavedGroup("GAMES", entries, "id-1"), buildSavedGroup("games (2)", entries, "id-2")];
    expect(buildUniqueGroupName("Games", saved)).toBe("Games (3)");
  });

  test("buildUniqueGroupName is deterministic", () => {
    const saved = [buildSavedGroup("Work", entries, "id-1")];
    const first = buildUniqueGroupName("Work", saved);
    const second = buildUniqueGroupName("Work", saved);
    expect(first).toBe(second);
    expect(first).toBe("Work (2)");
  });
});

describe("applyImportToSavedGroups", () => {
  const saved = [buildSavedGroup("Work", [{ title: "Old", url: "https://old.test/" }], "saved-1")];
  const imported = [
    { name: "Work", entries: [{ title: "New", url: "https://new.test/" }, { title: "Dup", url: "https://old.test/" }] },
    { name: "Fresh", entries },
    { name: "", entries: [{ title: "X", url: "https://x.test/" }] },
  ];

  test("non-conflicting groups are always imported", () => {
    const result = applyImportToSavedGroups(saved, imported, { policy: "merge" });
    expect(result.added.map((entry) => entry.name)).toEqual(["Fresh"]);
    expect(result.merged).toEqual([
      { name: "Work", id: "saved-1", addedCount: 1 },
    ]);
    expect(result.skipped).toEqual(["Unnamed group (no name was provided)"]);
    expect(result.groups).toHaveLength(2);
  });

  test("merge appends links into the existing group without duplicates", () => {
    const { groups } = applyImportToSavedGroups(saved, imported, { policy: "merge" });
    const work = groups.find((group) => group.name === "Work");
    expect(work.entries.map((entry) => entry.url)).toEqual([
      "https://old.test/",
      "https://new.test/",
    ]);
  });

  test("rename stores the imported group under a fresh name", () => {
    const { groups } = applyImportToSavedGroups(saved, imported, { policy: "rename" });
    const names = groups.map((group) => group.name);
    expect(names).toContain("Work"); // untouched original
    expect(names).toContain("Work (2)");
    const original = groups.find((group) => group.name === "Work");
    expect(original.entries).toHaveLength(1); // never overwritten
  });

  test("cancel skips conflicting groups and keeps the saved data intact", () => {
    const { groups, skipped } = applyImportToSavedGroups(saved, imported, { policy: "cancel" });
    expect(skipped).toContain("Work");
    expect(groups.find((group) => group.name === "Work").entries).toHaveLength(1);
    expect(groups.find((group) => group.name === "Fresh").entries).toHaveLength(2);
  });

  test("never mutates the input array", () => {
    const snapshot = JSON.stringify(saved);
    applyImportToSavedGroups(saved, imported, { policy: "merge" });
    expect(JSON.stringify(saved)).toBe(snapshot);
  });

  test("handles empty inputs", () => {
    const result = applyImportToSavedGroups([], [], { policy: "merge" });
    expect(result.groups).toEqual([]);
    expect(result.added).toEqual([]);
    expect(applyImportToSavedGroups(null, undefined, { policy: "merge" }).groups).toEqual([]);
  });
});

describe("loadSavedGroups / saveSavedGroups (chrome.storage.local)", () => {
  test("round-trips saved groups", async () => {
    const { storage } = fakeStorage();
    await withChrome(storage, async () => {
      const groups = [buildSavedGroup("Work", entries, "id-1")];
      await saveSavedGroups(groups);
      await expect(loadSavedGroups()).resolves.toEqual(groups);
    });
  });

  test("stores data under the versioned key", async () => {
    const { storage, bag } = fakeStorage();
    await withChrome(storage, async () => {
      await saveSavedGroups([buildSavedGroup("G", entries, "id-1")]);
      expect(bag.get(SAVED_GROUPS_KEY)).toEqual({
        version: SAVED_GROUPS_VERSION,
        groups: [buildSavedGroup("G", entries, "id-1")],
      });
    });
  });

  test("returns an empty array when nothing is stored", async () => {
    const { storage } = fakeStorage();
    await withChrome(storage, async () => {
      await expect(loadSavedGroups()).resolves.toEqual([]);
    });
  });

  test("drops malformed records instead of failing the whole load", async () => {
    const { storage, bag } = fakeStorage();
    bag.set(SAVED_GROUPS_KEY, {
      version: SAVED_GROUPS_VERSION,
      groups: [
        buildSavedGroup("Good", entries, "id-1"),
        null,
        { id: "bad", name: "No entries" },
        { id: "bad2", name: "Bad entries", entries: "nope" },
      ],
    });
    await withChrome(storage, async () => {
      const groups = await loadSavedGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe("Good");
    });
  });

  test("accepts a bare array without the version envelope", async () => {
    const { storage, bag } = fakeStorage();
    bag.set(SAVED_GROUPS_KEY, [buildSavedGroup("Legacy", entries, "id-1")]);
    await withChrome(storage, async () => {
      await expect(loadSavedGroups()).resolves.toHaveLength(1);
    });
  });

  test("save failures surface as readable errors", async () => {
    const { storage } = fakeStorage();
    await withChrome(storage, async () => {
      storage.failWith = new Error("QUOTA_BYTES quota exceeded");
      await expect(
        saveSavedGroups([buildSavedGroup("Work", entries, "id-1")]),
      ).rejects.toThrow("Could not save the imported groups: QUOTA_BYTES quota exceeded");
    });
  });

  test("rejects oversized payloads before touching storage", async () => {
    const { storage } = fakeStorage();
    await withChrome(storage, async () => {
      const many = Array.from({ length: MAX_SAVED_ENTRIES + 1 }, (_, index) => ({
        title: `T${index}`,
        url: `https://x-${index}.test/`,
      }));
      await expect(
        saveSavedGroups([buildSavedGroup("Big", many, "id-big")]),
      ).rejects.toThrow("Storage limit reached");

      const manyGroups = Array.from({ length: MAX_SAVED_GROUPS + 1 }, (_, index) =>
        buildSavedGroup(`G${index}`, [{ title: "T", url: `https://${index}.test/` }], `id-${index}`),
      );
      await expect(saveSavedGroups(manyGroups)).rejects.toThrow("Storage limit reached");
      expect(storage.setCount).toBe(0);
    });
  });

  test("throws a readable error when the storage API is unavailable", async () => {
    delete globalThis.chrome;
    await expect(loadSavedGroups()).rejects.toThrow("chrome.storage.local is unavailable");
    await expect(saveSavedGroups([])).rejects.toThrow("chrome.storage.local is unavailable");
  });
});
