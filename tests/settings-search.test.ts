import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PERMISSION_MODULE_KEYS } from "@/lib/permissions";
import { searchSettings, settingsEntryHref } from "../src/app/(app)/settings/search";
import { buildSettingsIndex, SETTINGS_INDEX_ANCHORS } from "../src/app/(app)/settings/search-index";
import { TABS } from "../src/app/(app)/settings/tabs";

// The settings search is a hand-listed index (see search-index.ts for why), so
// most of what is tested here is that the list hasn't drifted from the page:
// every entry has to point at something that is really on a tab.

const SETTINGS_DIR = path.join(__dirname, "..", "src", "app", "(app)", "settings");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

const SOURCE = sourceFiles(SETTINGS_DIR)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("settings search index", () => {
  it("points every entry at an id that exists in the settings source", () => {
    const missing = SETTINGS_INDEX_ANCHORS.filter((anchor) => !SOURCE.includes(`id="${anchor}"`));
    expect(missing).toEqual([]);
  });

  it("has one row per permission module, and the permission rows carry the id it links to", () => {
    expect(SOURCE).toContain("id={`permission-${moduleKey}`}");
    const index = buildSettingsIndex({ kitchenEnabled: false });
    for (const moduleKey of PERMISSION_MODULE_KEYS) {
      expect(index.some((e) => e.anchor === `permission-${moduleKey}`)).toBe(true);
    }
  });

  it("reaches every tab, with no repeated anchor on a tab", () => {
    const index = buildSettingsIndex({ kitchenEnabled: true });
    for (const tab of TABS) {
      expect(index.some((e) => e.tab === tab.key)).toBe(true);
    }
    const seen = new Set<string>();
    for (const e of index) {
      const key = `${e.tab}#${e.anchor ?? ""}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(e.tabLabel).toBe(TABS.find((t) => t.key === e.tab)?.label);
    }
  });

  it("offers the Kitchen question card only while the Kitchen is on", () => {
    const off = buildSettingsIndex({ kitchenEnabled: false });
    const on = buildSettingsIndex({ kitchenEnabled: true });
    expect(off.some((e) => e.anchor === "kitchen-questions")).toBe(false);
    expect(on.some((e) => e.anchor === "kitchen-questions")).toBe(true);
  });
});

describe("searchSettings", () => {
  const index = buildSettingsIndex({ kitchenEnabled: true });

  it("returns nothing for an empty or blank query", () => {
    expect(searchSettings(index, "")).toEqual([]);
    expect(searchSettings(index, "   ")).toEqual([]);
  });

  it("finds a setting by a word that is only in its keywords", () => {
    expect(searchSettings(index, "colors")[0]?.anchor).toBe("branding");
    expect(searchSettings(index, "sso")[0]?.anchor).toBe("sso");
    expect(searchSettings(index, "vegan")[0]?.anchor).toBe("kitchen-questions");
  });

  it("ranks a title hit above a mention elsewhere", () => {
    expect(searchSettings(index, "doors")[0]?.anchor).toBe("doors");
  });

  it("matches word prefixes and ignores case and punctuation", () => {
    expect(searchSettings(index, "INVIT").length).toBeGreaterThan(0);
    expect(searchSettings(index, "single sign-on")[0]?.anchor).toBe("sso");
  });

  it("needs every word of the query to match", () => {
    expect(searchSettings(index, "doors zzzzqq")).toEqual([]);
  });

  it("finds a permission module by its own name", () => {
    expect(searchSettings(index, "programme owner")[0]?.anchor).toBe("permission-event_scheduling_owner");
  });

  it("builds a link to the tab and the block", () => {
    expect(settingsEntryHref({ tab: "general", anchor: "branding" })).toBe("/settings?tab=general#branding");
    expect(settingsEntryHref({ tab: "history", anchor: null })).toBe("/settings?tab=history");
  });
});
