import { describe, expect, it } from "vitest";
import type { WatchStatus } from "./api";
import {
  busyChoices,
  deviceNotifyOf,
  folderName,
  minPhotosOf,
  normaliseExtensions,
  parseFolders,
  samePath,
  versionLabel,
  watchSummary,
} from "./settingValues";

describe("versionLabel", () => {
  it("marks a pre-release build as beta", () => {
    expect(versionLabel("0.31.0-beta.3")).toBe("Version 0.31.0-beta.3 (beta)");
  });

  it("leaves a release, build metadata and all, unmarked", () => {
    expect(versionLabel("0.30.0")).toBe("Version 0.30.0");
    expect(versionLabel("0.30.0+win-x64")).toBe("Version 0.30.0+win-x64");
  });
});

describe("parseFolders", () => {
  it("reads a JSON list of paths", () => {
    expect(parseFolders('["C:\\\\Inbox","D:\\\\Scans"]')).toEqual(["C:\\Inbox", "D:\\Scans"]);
  });

  it("treats unset, empty or broken values as no folders", () => {
    expect(parseFolders(undefined)).toEqual([]);
    expect(parseFolders("  ")).toEqual([]);
    expect(parseFolders("C:\\Inbox")).toEqual([]);
    expect(parseFolders('{"a":1}')).toEqual([]);
    expect(parseFolders('["C:\\\\Inbox", 3]')).toEqual(["C:\\Inbox"]);
  });
});

describe("samePath", () => {
  it("ignores case and a trailing slash", () => {
    expect(samePath("C:\\Users\\Me\\Inbox\\", "c:\\users\\me\\inbox")).toBe(true);
    expect(samePath("C:\\Inbox", "C:\\Inbox2")).toBe(false);
  });
});

describe("folderName", () => {
  it("names a folder by its last part", () => {
    expect(folderName("C:\\Users\\Me\\OneDrive\\Pictures\\Camera Roll")).toBe("Camera Roll");
    expect(folderName("D:\\Scans\\")).toBe("Scans");
    expect(folderName("E:\\")).toBe("E:");
    expect(folderName("\\\\nas\\photos\\inbox")).toBe("inbox");
  });
});

describe("normaliseExtensions", () => {
  it("drops dots, case and repeats", () => {
    expect(normaliseExtensions(".ORF xyz,abc; .xyz")).toBe("orf, xyz, abc");
  });

  it("leaves nothing for blank input", () => {
    expect(normaliseExtensions(" , ")).toBe("");
  });
});

describe("device notifications", () => {
  it("defaults to once a day", () => {
    expect(deviceNotifyOf(null)).toBe("day");
    expect(deviceNotifyOf({ device_notify: "hourly" })).toBe("day");
  });

  it("keeps a saved choice", () => {
    expect(deviceNotifyOf({ device_notify: "never" })).toBe("never");
    expect(deviceNotifyOf({ device_notify: "always" })).toBe("always");
  });
});

describe("busy days", () => {
  it("uses the saved count or the default", () => {
    expect(minPhotosOf({ suggest_min_photos: "30" })).toBe(30);
    expect(minPhotosOf({})).toBe(15);
    expect(minPhotosOf({ suggest_min_photos: "lots" })).toBe(15);
    expect(minPhotosOf(null)).toBe(15);
  });

  it("offers a saved count that isn't a usual choice", () => {
    expect(busyChoices(15)).toEqual([5, 10, 15, 20, 30, 50]);
    expect(busyChoices(25)).toEqual([5, 10, 15, 20, 25, 30, 50]);
  });
});

describe("watchSummary", () => {
  /**
   * A watcher state with one inbox folder, with any fields overridden.
   * @param over - fields to override
   * @returns the state
   */
  const status = (over: Partial<WatchStatus>): WatchStatus => ({
    folders: ["C:\\Inbox"],
    missing: [],
    paused: false,
    waiting: 0,
    ...over,
  });

  it("says how many folders are watched and what's still copying", () => {
    expect(watchSummary(status({}))).toBe("Watching 1 folder.");
    expect(watchSummary(status({ folders: ["A", "B"], waiting: 1 }))).toBe(
      "Watching 2 folders. 1 file is still copying in.",
    );
    expect(watchSummary(status({ waiting: 3 }))).toBe(
      "Watching 1 folder. 3 files are still copying in.",
    );
  });

  it("explains a pause, missing folders and having none", () => {
    expect(watchSummary(status({ paused: true }))).toMatch(/^Paused\./);
    expect(watchSummary(status({ folders: [], missing: ["D:\\Gone"] }))).toBe(
      "The inbox folder can't be found.",
    );
    expect(watchSummary(status({ folders: [], missing: ["D:\\A", "E:\\B"] }))).toBe(
      "None of the inbox folders can be found.",
    );
    expect(watchSummary(status({ folders: [] }))).toBe("Add a folder to start watching.");
  });
});
